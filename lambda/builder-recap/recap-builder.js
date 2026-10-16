'use strict';

const fs = require('fs');
const { displayBetRunners } = require('./bet-presentation');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const canonicalValidatorModule = fs.existsSync(path.join(__dirname, 'canonical-bettings-validator.js'))
  ? './canonical-bettings-validator'
  : '../../shared/canonical-bettings-validator';
const { validateCanonicalBettingsSemantics } = require(canonicalValidatorModule);

const ROOT = __dirname;
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = p => JSON.parse(read(p));

const bettingsSchema = json('contracts/bettings.schema.json');
const planSchema = json('contracts/scene-plan.schema.json');
const sceneContracts = json('contracts/scene-contracts.json');
const runtimeContract = json('contracts/runtime-contract.json');
const shellTemplate = read('runtime/main-shell-template.html');
const runtimeJs = read('runtime/recap-runtime.js');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateBettingsSchema = ajv.compile(bettingsSchema);
const validatePlanSchema = ajv.compile(planSchema);

class BuildError extends Error {
  constructor(stage, message) { super(message); this.name = 'BuildError'; this.stage = stage; }
}
const fail = (stage, message) => { throw new BuildError(stage, message); };
const signClass = n => Number(n) > 0 ? 'positive' : Number(n) < 0 ? 'negative' : 'zero';
const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fmtNum = n => Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
const currency = n => `$${fmtNum(Math.abs(Number(n)))}`;
const pnl = n => Number(n)>0 ? `+$${fmtNum(n)}` : Number(n)<0 ? `−$${fmtNum(Math.abs(n))}` : '$0';
const odds = n => fmtNum(n);
const ordinal = n => { n=Number(n); const m=n%100; const s=(m>=11&&m<=13)?'TH':({1:'ST',2:'ND',3:'RD'}[n%10]||'TH'); return `${n}${s}`; };
const finishingPositionText = n => Number(n)===0 ? 'UNPLACED' : ordinal(n);

const dateDisplay = iso => { const [y,m,d]=iso.split('-').map(Number); const mons=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']; return `${d} ${mons[m-1]} ${y}`; };
const raceTimeDisplay = (iso,timeZone) => new Intl.DateTimeFormat('en-AU',{timeZone,hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(iso));

const validHttps = u => { try { const x=new URL(u); return x.protocol==='https:'; } catch { return false; } };

function schemaCheck(validate, value, stage) {
  if (validate(value)) return;
  const msg = validate.errors.map(e => `${e.instancePath || '/'} ${e.message}`).join('; ');
  fail(stage, msg);
}

function validateSource(b) {
  validateCanonicalBettingsSemantics(
    b,
    message => fail('BETTINGS_SEMANTICS', message)
  );
}
function earliestMax(xs,key){ if(!xs.length)return null; return xs.reduce((a,b)=>Number(b[key])>Number(a[key])?b:a); }
function earliestMin(xs,key){ if(!xs.length)return null; return xs.reduce((a,b)=>Number(b[key])<Number(a[key])?b:a); }

function validatePlan(b,p) {
  const scenes=p.scenes, total=b.summary.totalBets;
  if(scenes[0]?.sceneType!==1 || scenes.filter(x=>x.sceneType===1).length!==1) fail('SCENE_PLAN_SEMANTICS','Scene 1 must be first exactly once.');
  if(scenes.at(-2)?.sceneType!==6 || scenes.filter(x=>x.sceneType===6).length!==1) fail('SCENE_PLAN_SEMANTICS','Scene 6 must be second-last exactly once.');
  if(scenes.at(-1)?.sceneType!==7 || scenes.filter(x=>x.sceneType===7).length!==1) fail('SCENE_PLAN_SEMANTICS','Scene 7 must be last exactly once.');
  if(scenes.filter(x=>x.sceneType===4).length>1) fail('SCENE_PLAN_SEMANTICS','Scene 4 may appear at most once.');
  const coverage=[];
  const seenReplayUrls=new Set();
  scenes.forEach((s,i)=>{
    if(s.sceneType===2) coverage.push(s.betSequence);
    if(s.sceneType===5){ if(s.betSequences.some((x,j)=>j&&x!==s.betSequences[j-1]+1)) fail('SCENE_PLAN_SEMANTICS',`Scene array item ${i+1} (sceneType 5): sequences must be consecutive.`); coverage.push(...s.betSequences); }
    if(s.sceneType===8){ if(s.betSequences.some((x,j)=>j&&x!==s.betSequences[j-1]+1)) fail('SCENE_PLAN_SEMANTICS',`Scene array item ${i+1} (sceneType 8): sequences must be consecutive.`); if(s.comments.length!==s.betSequences.length) fail('SCENE_PLAN_SEMANTICS',`Scene array item ${i+1} (sceneType 8): comments.length must equal betSequences.length.`); coverage.push(...s.betSequences); }
    if(s.sceneType===3){ const prev=scenes[i-1], bet=b.bets[s.betSequence-1]; const attached=prev&&(prev.sceneType===2?prev.betSequence===s.betSequence:prev.sceneType===5&&prev.betSequences.includes(s.betSequence)); if(!attached) fail('SCENE_PLAN_SEMANTICS',`Scene array item ${i+1} (sceneType 3): replay must immediately follow Scene 2 or Scene 5 containing the same bet.`); if(!bet||!bet.replayUrl||!validHttps(bet.replayUrl)) fail('SCENE_PLAN_SEMANTICS',`Scene array item ${i+1} (sceneType 3): bet ${s.betSequence} is not replay eligible.`); if(seenReplayUrls.has(bet.replayUrl)) fail('SCENE_PLAN_SEMANTICS',`Scene array item ${i+1} (sceneType 3): replay URL may appear at most once.`); seenReplayUrls.add(bet.replayUrl); }
  });
  if(coverage.length!==total || coverage.some((x,i)=>x!==i+1)) fail('SCENE_PLAN_SEMANTICS','Primary bet coverage must be exactly 1..totalBets once, in order.');
  validateMidpoint(scenes,total);
  validatePlanDuration(p);
  validateHighlights(b,p);
}
function primaryContributionScene(s){ if(s.sceneType===2)return 1; if(s.sceneType===5||s.sceneType===8)return s.betSequences.length; return 0; }
function validateMidpoint(scenes,total){ const idx=scenes.findIndex(x=>x.sceneType===4); if(idx<0)return; const before=scenes.slice(0,idx).reduce((n,s)=>n+primaryContributionScene(s),0); const boundaries=[]; let c=0; for(const s of scenes){ c+=primaryContributionScene(s); if([2,5,8].includes(s.sceneType))boundaries.push(c); } const best=boundaries.reduce((a,x)=>Math.abs(x/total-.5)<Math.abs(a/total-.5)?x:a,boundaries[0]); if(before!==best) fail('SCENE_PLAN_SEMANTICS',`Scene 4 checkpoint must follow ${best} completed primary bets, not ${before}.`); }
function sceneDurationMs(scene,conservative=false){ const t=runtimeContract.timeline,type=scene.sceneType,hold=Number(t[`scene${type}`]?.endHoldMs||0); if(type===1)return t.scene1.durationMs; if(type===2)return Number(t.scene2.durationMs)+hold; if(type===3){const replay=Number(t.scene3.plannedPlaybackMs)+Number(t.scene3.exitFadeMs);return conservative?replay+t.scene3.metadataTimeoutMs+t.scene3.playTimeoutMs:replay;} if(type===4)return Number(t.scene4.durationMs)+hold; if(type===5)return Number(t.scene5.durationMsByRaceCount[String(scene.betSequences?.length)]||0)+hold; if(type===6)return Number(t.scene6.durationMs)+hold; if(type===7)return 0; if(type===8)return Number(t.scene8.durationMsByBetCount[String(scene.betSequences?.length)]||0)+hold; return 0;}
function calculatePlanDurationMs(plan,{conservative=false}={}){return plan.scenes.reduce((n,s)=>n+sceneDurationMs(s,conservative),0)+Math.max(0,plan.scenes.length-1)*runtimeContract.shell.sceneTransition.durationMs;}
function durationWithinHardMaxMs(ms){return Number(ms)<=runtimeContract.durationPolicy.hardMaxSeconds*1000;}
function validatePlanDuration(plan){const ms=calculatePlanDurationMs(plan,{conservative:false});if(!durationWithinHardMaxMs(ms))fail('SCENE_PLAN_SEMANTICS',`Planned duration ${Math.ceil(ms/1000)}s exceeds hard maximum ${runtimeContract.durationPolicy.hardMaxSeconds}s.`);}
function validateHighlights(b,p){ const s6=p.scenes.find(x=>x.sceneType===6), s7=p.scenes.find(x=>x.sceneType===7), wins=b.bets.filter(x=>x.result==='WIN'), positiveWins=wins.filter(x=>x.profitLoss>0); if(s6.standoutHighlightType==='biggestWin'&&!positiveWins.length)fail('SCENE_PLAN_SEMANTICS','Scene 6 biggestWin highlight is ineligible.'); if(s6.standoutHighlightType==='highestOddsWinner'&&!eligibleHighestOddsWins(b.bets).length)fail('SCENE_PLAN_SEMANTICS','Scene 6 highestOddsWinner highlight is ineligible.'); if(s6.standoutHighlightType==='biggestRecovery'&&!b.bets.some(x=>x.profitLoss>0))fail('SCENE_PLAN_SEMANTICS','Scene 6 biggestRecovery highlight is ineligible.'); if(s6.standoutHighlightType==='longestLosingStreak'&&!b.bets.some(x=>x.result==='LOSS'))fail('SCENE_PLAN_SEMANTICS','Scene 6 longestLosingStreak highlight is ineligible.'); if(s7.selectedFinalHighlights.includes('biggestWin')&&!positiveWins.length)fail('SCENE_PLAN_SEMANTICS','Scene 7 biggestWin highlight is ineligible.'); if(s7.selectedFinalHighlights.includes('highestOddsWinner')&&!eligibleHighestOddsWins(b.bets).length)fail('SCENE_PLAN_SEMANTICS','Scene 7 highestOddsWinner highlight is ineligible.'); }

function extractTemplate(sceneType){ const p=sceneContracts.scenes[String(sceneType)].template.replace(/^templates\//,'templates/'), src=read(p); const css=extractOne(src,'SCENE_PRODUCTION_CSS_START','SCENE_PRODUCTION_CSS_END',p); const markup=extractOne(src,'SCENE_PRODUCTION_MARKUP_START','SCENE_PRODUCTION_MARKUP_END',p); if(/crossorigin\s*=\s*["']anonymous/i.test(markup))fail('TEMPLATE_GATE',`${p}: crossorigin=anonymous is forbidden.`); if(/\bis-active\b/.test(markup))fail('TEMPLATE_GATE',`${p}: production markup must not hardcode is-active.`); return {css,markup}; }
function extractOne(src,start,end,p){ const a=`/* ${start} */`, b=`/* ${end} */`, ah=`<!-- ${start} -->`, bh=`<!-- ${end} -->`; const sm=src.includes(a)?a:ah, em=src.includes(b)?b:bh; if((src.split(sm).length-1)!==1||(src.split(em).length-1)!==1)fail('TEMPLATE_GATE',`${p}: expected exactly one ${start}/${end} pair.`); const i=src.indexOf(sm)+sm.length,j=src.indexOf(em,i); if(j<i)fail('TEMPLATE_GATE',`${p}: invalid production marker order.`); return src.slice(i,j).trim(); }
function validateScene8RuntimeContract(){ const t=runtimeContract.timeline.scene8, marks=t.resultRevealMs; if(!Array.isArray(marks)||marks.length<5)fail('RUNTIME_CONTRACT','Scene 8 requires at least five reveal marks.'); for(let count=2;count<=5;count++){ const duration=Number(t.durationMsByBetCount[String(count)]); if(!Number.isFinite(duration)||duration<=0)fail('RUNTIME_CONTRACT',`Scene 8 duration missing for ${count} bets.`); const used=marks.slice(0,count).map(Number); if(used.some((x,i)=>!Number.isFinite(x)||x<0||(i&&x<=used[i-1])))fail('RUNTIME_CONTRACT',`Scene 8 reveal marks invalid for ${count} bets.`); if(used.at(-1)>=duration)fail('RUNTIME_CONTRACT',`Scene 8 final reveal must occur before scene end for ${count} bets.`); } }
function templateGate(){ validateScene8RuntimeContract(); for(let i=1;i<=8;i++)extractTemplate(i); ['{{SCENE_CSS}}','{{SCENE_MARKUP}}','{{RUNTIME_MANIFEST}}','{{RUNTIME_JS}}'].forEach(x=>{if(!shellTemplate.includes(x))fail('TEMPLATE_GATE',`Shell missing ${x}.`);}); }

function fxForBet(bet,all){ if(bet.result==='LOSS')return 'lossTreatment lossEmotion'; const fx=['greenSweep','winEmotion']; const max=Math.max(...all.filter(x=>x.result==='WIN'&&x.profitLoss>0).map(x=>x.profitLoss),-Infinity); if(bet.profitLoss===max)fx.push('bigWinEmphasis'); const prev=bet.sequence===1?0:all[bet.sequence-2].runningPnl; if(prev<0&&bet.runningPnl>0)fx.push('comebackEmphasis'); return fx.join(' '); }
function isTrifecta(bet){return bet.betType==='TRIFECTA';}
function betDisplayName(bet){return displayBetRunners(bet);}
function betDisplayOddsSuffix(bet){return isTrifecta(bet)?'':` @ ${odds(bet.odds)}`;}
function betDisplayFinish(bet){return isTrifecta(bet)?'':`FINISHED ${finishingPositionText(bet.finishingPosition)}`;}
function biggestWinLabel(bet){return isTrifecta(bet)?'TRIFECTA':bet.runnerName;}
function biggestWinSummaryLabel(bet){return isTrifecta(bet)?'TRIFECTA':`${bet.runnerName} @ ${odds(bet.odds)}`;}
function eligibleHighestOddsWins(bets){return bets.filter(x=>x.result==='WIN'&&typeof x.odds==='number'&&Number.isFinite(x.odds)&&x.odds>0);}
function betFields(bet,b){ const prev=bet.sequence===1?0:b.bets[bet.sequence-2].runningPnl,name=betDisplayName(bet),horseNameClass=isTrifecta(bet)?'trifecta-selection':(!/\s/u.test(name)&&name.length>12?'long-single-word':''); return {meetingRace:`${bet.meeting} • R${bet.raceNumber}`,raceTimeDisplay:raceTimeDisplay(bet.raceTime,b.day.timezone),userName:b.user.firstName,horseName:name,horseNameClass,stakeDisplay:currency(bet.stake),betType:bet.betType,oddsDisplay:isTrifecta(bet)?'':odds(bet.odds),oddsSuffix:betDisplayOddsSuffix(bet),finishLabel:betDisplayFinish(bet),finishingPositionText:isTrifecta(bet)?'':finishingPositionText(bet.finishingPosition),betResult:bet.result,runningPnl:bet.runningPnl,previousRunningPnl:prev,runningPnlDisplay:pnl(bet.runningPnl),resultKind:bet.result,pnlSignClass:signClass(bet.runningPnl),fxPackage:fxForBet(bet,b.bets)}; }
function resolveScene(s,b,instance,completedBefore){ const common={sceneInstanceId:instance}; if(s.sceneType===1){ const meetings=[...new Set(b.bets.map(x=>x.meeting))]; return {...common,dateDisplay:dateDisplay(b.day.date),userName:b.user.firstName,totalBets:b.summary.totalBets,totalStakedDisplay:currency(b.summary.totalStaked),meetingCount:meetings.length,meetingJourney:meetings.join(' → '),openingTeaser:s.openingTeaser,closingHook:sceneContracts.controlledValues.scene1ClosingHook,sceneDurationMs:runtimeContract.timeline.scene1.durationMs}; }
  if(s.sceneType===2){ const bet=b.bets[s.betSequence-1]; return {...common,...betFields(bet,b),tensionLine:s.tensionLine,reactionLine:s.reactionLine,sceneDurationMs:runtimeContract.timeline.scene2.durationMs}; }
  if(s.sceneType===3){ const bet=b.bets[s.betSequence-1]; return {...common,...betFields(bet,b),replayLabel:s.replayLabel,replayStartMode:runtimeContract.timeline.scene3.replayStartMode,replayStartRatio:runtimeContract.timeline.scene3.replayStartRatio,replayClipSeconds:runtimeContract.timeline.scene3.replayClipSeconds,_runtime:{replayUrl:bet.replayUrl,replayComments:s.replayComments,replayResult:bet.result,replayBetType:bet.betType}}; }
  if(s.sceneType===4){ const done=b.bets.slice(0,completedBefore), last=done.at(-1), wins=done.filter(x=>x.result==='WIN'), best=earliestMax(wins.filter(x=>x.profitLoss>0),'profitLoss'); return {...common,userName:b.user.firstName,checkpointTime:raceTimeDisplay(last.raceTime,b.day.timezone),checkpointPnlDisplay:`$${Math.abs(Number(last.runningPnl)||0).toFixed(2).replace(/\.00$/,'')}`,checkpointDirection:Number(last.runningPnl)>0?'UP':Number(last.runningPnl)<0?'DOWN':'EVEN',totalBets:b.summary.totalBets,betsCompleted:completedBefore,currentRunningPnlDisplay:pnl(last.runningPnl),pnlSignClass:signClass(last.runningPnl),winnersSoFar:wins.length,bestWinSummarySoFar:best?`${pnl(best.profitLoss)} • ${biggestWinLabel(best)}`:'NO WINNERS YET',lookingBackStory:s.lookingBackStory,lookingAheadTeaser:s.lookingAheadTeaser}; }
  if(s.sceneType===5){ const bets=s.betSequences.map(n=>b.bets[n-1]), first=bets[0],last=bets.at(-1), prev=first.sequence===1?0:b.bets[first.sequence-2].runningPnl; return {...common,raceCount:bets.length,setupKicker:s.setupKicker,setupHeadline:s.setupHeadline,payoffHeadline:s.payoffHeadline,contextLine:s.contextLine,races:bets.map((x,i)=>({...betFields(x,b),outcomeClass:x.result.toLowerCase(),raceIndex:i+1,meetingName:x.meeting,raceNumber:x.raceNumber,returnText:x.return>0?` • RETURN ${currency(x.return)}`:'',betProfitLossDisplay:pnl(x.profitLoss)})),runningPnlAfterGroup:last.runningPnl,previousRunningPnlBeforeGroup:prev,runningPnlDisplay:pnl(last.runningPnl),pnlSignClass:signClass(last.runningPnl)}; }
  if(s.sceneType===8){ const bets=s.betSequences.map(n=>b.bets[n-1]), timing=runtimeContract.timeline.scene8, reveal=timing.resultRevealMs.slice(0,bets.length),wins=bets.filter(x=>x.result==='WIN').length,losses=bets.length-wins,groupPnl=bets.reduce((n,x)=>n+Number(x.profitLoss||0),0),summaryParts=[]; if(wins)summaryParts.push(`${wins} ${wins===1?'WIN':'WINS'}`); if(losses)summaryParts.push(`${losses} ${losses===1?'LOSS':'LOSSES'}`); summaryParts.push(pnl(groupPnl)); return {...common,betCount:bets.length,headline:s.headline,blockReaction:s.blockReaction||'That run of results changed the shape of the day.',blockSummaryLine:summaryParts.join(' • '),sceneDurationMs:timing.durationMsByBetCount[String(bets.length)],resultRevealMs:reveal.join(','),races:bets.map((x,i)=>({...betFields(x,b),outcomeClass:x.result.toLowerCase(),raceIndex:i+1,meetingName:x.meeting,raceNumber:x.raceNumber,returnText:x.return>0?` • RETURN ${currency(x.return)}`:'',betProfitLossDisplay:pnl(x.profitLoss),runningPnl:x.runningPnl,runningPnlDisplay:pnl(x.runningPnl),comment:s.comments[i]}))}; }
  if(s.sceneType===6){ const bw=earliestMax(b.bets.filter(x=>x.result==='WIN'&&x.profitLoss>0),'profitLoss'); return {...common,userName:b.user.firstName,totalBets:b.summary.totalBets,totalStakedDisplay:currency(b.summary.totalStaked),totalReturnedDisplay:currency(b.summary.totalReturned),finalPnlDisplay:pnl(b.summary.finalPnl),winsLossesDisplay:`${b.summary.wins} ${b.summary.wins===1?'winner':'winners'} • ${b.summary.losses} ${b.summary.losses===1?'loss':'losses'}`,biggestWinSummary:bw?biggestWinSummaryLabel(bw):'NO WINNERS TODAY',finalPnlSignClass:signClass(b.summary.finalPnl),dayVerdict:s.dayVerdict,standoutCopy:s.standoutCopy}; }
  if(s.sceneType===7){ const map=finalHighlightMap(b); return {...common,userName:b.user.firstName,userNameUpper:b.user.firstName.toUpperCase(),heroOutcomeClass:b.summary.finalPnl>0?'positive':b.summary.finalPnl<0?'negative':'break-even',finalHeroText:b.summary.finalPnl>0?`FINISHED ${pnl(b.summary.finalPnl)}`:b.summary.finalPnl<0?`FINISHED ${pnl(b.summary.finalPnl)}`:'FINISHED EVEN',resolvedFinalHighlights:s.selectedFinalHighlights.map(k=>({text:map[k]})),finalSummary:s.finalSummary,_runtime:{shareCaption:s.shareCaption}}; }
  fail('BUILD',`Unsupported scene type ${s.sceneType}.`); }
function finalHighlightMap(b){ const bw=earliestMax(b.bets.filter(x=>x.result==='WIN'&&x.profitLoss>0),'profitLoss'), ho=earliestMax(eligibleHighestOddsWins(b.bets),'odds'); return {totalBets:`${b.summary.totalBets} BETS`,wins:`${b.summary.wins} ${b.summary.wins===1?'WIN':'WINS'}`,losses:`${b.summary.losses} ${b.summary.losses===1?'LOSS':'LOSSES'}`,totalStaked:`${currency(b.summary.totalStaked)} STAKED`,totalReturned:`${currency(b.summary.totalReturned)} RETURNED`,finalPnl:`${pnl(b.summary.finalPnl)} P&L`,biggestWin:bw?`${biggestWinLabel(bw)} ${pnl(bw.profitLoss)} BIGGEST WIN`:'',highestOddsWinner:ho?`${ho.runnerName} @ ${odds(ho.odds)} HIGHEST-ODDS WIN`:''}; }

function render(markup,data){ let out=markup; out=renderLoop(out,'races',data.races||[]); out=renderLoop(out,'resolvedFinalHighlights',data.resolvedFinalHighlights||[]); out=out.replace(/{{([A-Za-z0-9_]+)}}/g,(m,k)=>Object.prototype.hasOwnProperty.call(data,k)?esc(data[k]):fail('BUILD',`Unresolved template placeholder ${m}.`)); if(/{{[#/]?[^}]+}}/.test(out))fail('BUILD','Unresolved template section remains.'); return out; }
function renderLoop(src,name,items){ const re=new RegExp(`{{#${name}}}([\\s\\S]*?){{\\/${name}}}`,'g'); return src.replace(re,(_,body)=>items.map(item=>body.replace(/{{([A-Za-z0-9_]+)}}/g,(m,k)=>Object.prototype.hasOwnProperty.call(item,k)?esc(item[k]):m)).join('')); }

function buildRecap({bettings,scenePlan}){
  schemaCheck(validateBettingsSchema,bettings,'BETTINGS_SCHEMA');
  validateSource(bettings);
  schemaCheck(validatePlanSchema,scenePlan,'SCENE_PLAN_SCHEMA');
  validatePlan(bettings,scenePlan);
  templateGate();
  const cssByType=new Map(), rendered=[], sceneRuntimeData={}; let completed=0,replays=0;
  scenePlan.scenes.forEach((s,i)=>{ const id=`scene-${i+1}-type-${s.sceneType}`; const t=extractTemplate(s.sceneType); if(!cssByType.has(s.sceneType))cssByType.set(s.sceneType,t.css); const data=resolveScene(s,bettings,id,completed); rendered.push(render(t.markup,data)); if(data._runtime){sceneRuntimeData[id]=data._runtime;if(s.sceneType===3)replays++;} if(s.sceneType===2)completed++; else if(s.sceneType===5||s.sceneType===8)completed+=s.betSequences.length; });
  const manifest=JSON.stringify({manifestVersion:'1.0',sceneRuntimeData}).replace(/</g,'\\u003c');

  const html=shellTemplate.replace('{{USER_NAME}}',()=>esc(bettings.user.firstName).toUpperCase()).replace('/* {{SCENE_CSS}} */',()=>[...cssByType.values()].join('\n')).replace('{{SCENE_MARKUP}}',()=>rendered.join('\n')).replace('{{RUNTIME_MANIFEST}}',()=>manifest).replace('/* {{RUNTIME_JS}} */',()=>runtimeJs);  if(/{{SCENE_CSS}}|{{SCENE_MARKUP}}|{{RUNTIME_MANIFEST}}|{{RUNTIME_JS}}/.test(html))fail('BUILD','Shell assembly left unresolved builder placeholders.');

  return {html,sceneCount:scenePlan.scenes.length,betCount:bettings.bets.length,replayCount:replays,finalPnl:bettings.summary.finalPnl};
}

module.exports={buildRecap,BuildError,__test:{calculatePlanDurationMs,durationWithinHardMaxMs,validateScene8RuntimeContract}};
