'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {buildRecap,BuildError,__test}=require('./recap-builder');

function makeBettings(total){
  let running=0;
  const bets=Array.from({length:total},(_,i)=>{const win=i%3===0,stake=10,ret=win?25:0,profitLoss=ret-stake;running+=profitLoss;return {sequence:i+1,betTime:`2026-09-12T00:${String(i%60).padStart(2,'0')}:00+00:00`,raceTime:`2026-09-12T01:${String(i%60).padStart(2,'0')}:00+00:00`,raceId:`R${i+1}`,raceName:`Race ${i+1}`,meeting:'TEST',state:'VIC',raceNumber:(i%12)+1,runnerId:`RUN${i+1}`,runnerNumber:(i%20)+1,runnerName:`RUNNER WITH A DELIBERATELY LONG NAME ${i+1}`,betType:'WIN',stake,odds:2.5,result:win?'WIN':'LOSS',finishingPosition:win?1:(i%2===1?0:4),return:ret,profitLoss,runningPnl:running,replayUrl:null};});
  const wins=bets.filter(x=>x.result==='WIN'),losses=bets.filter(x=>x.result==='LOSS');
  const bw=wins.reduce((a,b)=>(!a||b.profitLoss>a.profitLoss)?b:a,null);
  const bl=losses.reduce((a,b)=>(!a||b.profitLoss<a.profitLoss)?b:a,null);
  const ho=wins.reduce((a,b)=>(!a||b.odds>a.odds)?b:a,null);
  return {schemaVersion:'1.0',user:{firstName:'Rory'},day:{date:'2026-09-12',timezone:'Australia/Melbourne'},bets,summary:{totalBets:total,totalStaked:bets.reduce((n,x)=>n+x.stake,0),totalReturned:bets.reduce((n,x)=>n+x.return,0),wins:wins.length,losses:losses.length,finalPnl:running,meetings:1,biggestStake:10,biggestWinSequence:bw?.sequence??null,biggestLossSequence:bl?.sequence??null,highestOddsWinnerSequence:ho?.sequence??null}};
}
function edgeScenes(){return [{sceneType:1,openingTeaser:'A racing story is ready to unfold today.'},{sceneType:6,dayVerdict:'The day moved around before reaching its final shape.',standoutHighlightType:'strongestFinish',standoutCopy:'The closing stretch completed the story.'},{sceneType:7,selectedFinalHighlights:['totalBets','wins','finalPnl'],finalSummary:'The full racing day is wrapped with every bet accounted for.',shareCaption:'My racing day recap covered every bet from start to finish.'}];}
function fastPlan(total,groupSize=5){const [s1,s6,s7]=edgeScenes(),scenes=[s1];let n=1;while(total-n+1>=2){const remaining=total-n+1,size=Math.min(groupSize,remaining===6?4:remaining);if(size<2)break;scenes.push({sceneType:8,betSequences:Array.from({length:size},(_,i)=>n+i),headline:'Quick results ahead',comments:Array.from({length:size},()=> 'On we go'),blockReaction:'That run of results had some bite.'});n+=size;}if(n<=total)scenes.push({sceneType:2,betSequence:n,tensionLine:'One runner remains before the finish.',reactionLine:'That completes the final result.'});scenes.push(s6,s7);return {planVersion:'2.0',scenes};}

for(const count of [4,5]){const bettings=makeBettings(count),plan=fastPlan(count,count),out=buildRecap({bettings,scenePlan:plan});assert.match(out.html,new RegExp(`data-bet-count=\"${count}\"`));assert.match(out.html,new RegExp(`NEXT ${count}`));assert.match(out.html,/data-result-reveal-ms=/);assert.match(out.html,/data-scene-duration-ms=/);}
const unplacedOut=buildRecap({bettings:makeBettings(5),scenePlan:fastPlan(5,5)});
assert.match(unplacedOut.html,/That run of results had some bite\./);
assert.match(unplacedOut.html,/2 WINS • 3 LOSSES • \$0/);
assert.match(unplacedOut.html,/UNPLACED/);
assert.doesNotMatch(unplacedOut.html,/0TH/i);
assert.match(unplacedOut.html,/1ST/);
assert.match(unplacedOut.html,/4TH/);

const optionalIdBettings=makeBettings(5);
optionalIdBettings.bets.forEach(bet=>{delete bet.raceId;delete bet.runnerId;});
const optionalIdOut=buildRecap({bettings:optionalIdBettings,scenePlan:fastPlan(5,5)});
assert.match(optionalIdOut.html,/data-bet-count="5"/);
for(const total of [50,100]){const out=buildRecap({bettings:makeBettings(total),scenePlan:fastPlan(total,5)});assert.match(out.html,/data-scene-type="8"/);}
const template=fs.readFileSync(path.resolve(__dirname,'templates/scene-8-fast-results-template.html'),'utf8');
assert.match(template,/\.s8-bet\{[^}]*opacity:0;[^}]*transform:translateY\(7px\)/);
assert.match(template,/\.scene-type-8\.play \.s8-bet\{animation:s8rowin/);
assert.match(template,/\.s8-bet:nth-child\(5\)\{animation-delay:5\.55s\}/);
assert.match(template,/\.s8-result\{[^}]*opacity:0;visibility:hidden/);
assert.match(template,/\.s8-bet\.is-resolved \.s8-result\{opacity:1;visibility:visible/);
assert.match(template,/\.s8-horse\{[^}]*white-space:normal;[^}]*text-overflow:clip/);
assert.match(template,/\.s8-wrap\{[^}]*display:grid;[^}]*grid-template-rows:auto auto minmax\(0,1fr\);[^}]*align-content:start/);
assert.match(template,/\.s8-footer\{[^}]*align-self:end/);
assert.match(template,/\.scene-type-8\[data-bet-count="5"\] \.s8-bet\{min-height:42px\}/);
assert.match(template,/@media\(orientation:portrait\)\{[^]*\.scene-type-8\[data-bet-count="5"\] \.s8-bet\{min-height:46px\}/);
assert.match(template,/@media\(orientation:landscape\) and \(max-height:900px\)\{[^]*\.scene-type-8\[data-bet-count="5"\] \.s8-bet\{min-height:30px\}/);
assert.doesNotMatch(template,/s8-emoji/);
assert.match(template,/data-role="s8-footer"/);
assert.match(template,/\{\{blockReaction\}\}/);
assert.match(template,/\{\{blockSummaryLine\}\}/);
assert.match(template,/NEXT \{\{betCount\}\}/);
const scene3Template=fs.readFileSync(path.resolve(__dirname,'templates/scene-3-race-replay-template.html'),'utf8');
for(const style of ['slam','zoom','swipe','pulse','burst']) assert.match(scene3Template,new RegExp('\\.s3-comment\\.is-visible\\.style-'+style+'\\{animation:s3Comment[A-Za-z]+ 1\\.5s'));
assert.match(scene3Template,/@keyframes s3CommentSlam\{[^]*82%\{opacity:1/);
assert.match(scene3Template,/@keyframes s3CommentZoom\{[^]*82%\{opacity:1/);
assert.match(scene3Template,/@keyframes s3CommentSwipe\{[^]*82%\{opacity:1/);
assert.match(scene3Template,/@keyframes s3CommentPulse\{[^]*82%\{opacity:1/);
assert.match(scene3Template,/@keyframes s3CommentBurst\{[^]*82%\{opacity:1/);
assert.match(scene3Template,/\.s3-horse\{[^}]*overflow-wrap:normal;word-break:normal/);
assert.match(scene3Template,/\.s3-horse\.long-single-word\{[^}]*overflow-wrap:anywhere;word-break:break-word/);
assert.match(scene3Template,/@media\(orientation:portrait\)\{[^]*\.s3-identity\{top:23px;left:20px;max-width:50%\}/);
assert.match(scene3Template,/@media\(orientation:portrait\)\{[^]*\.s3-horse\{font-size:clamp\(26px,8vw,38px\)\}/);
assert.match(scene3Template,/class="s3-horse \{\{horseNameClass\}\}"/);
const scene7Template=fs.readFileSync(path.resolve(__dirname,'templates/scene-7-final-share-template.html'),'utf8');
assert.match(scene7Template,/Gamble responsibly\. Call Gambling Help on 1800 858 858 or visit gamblinghelponline\.org\.au/);
assert.match(scene7Template,/\.scene-type-7 \.s7-safe\{position:absolute;[^}]*bottom:12px;[^}]*font-size:10px/);
assert.match(scene7Template,/@media\(max-width:620px\)\{[^]*\.scene-type-7 \.s7-safe\{left:5vw;right:5vw;bottom:9px;font-size:9px\}/);
assert.match(scene7Template,/@media\(orientation:landscape\) and \(max-height:900px\)\{/);
assert.match(scene7Template,/\.scene-type-7\{align-items:flex-start;padding:12px 5vw 48px\}/);
assert.match(scene7Template,/\.scene-type-7 \.s7-hero\{margin-top:8px;font-size:clamp\(40px,5vw,66px\);line-height:\.92\}/);
assert.match(scene7Template,/\.scene-type-7 \.s7-summary\{margin-top:14px;max-width:760px;font-size:clamp\(15px,1\.55vw,21px\);line-height:1\.16\}/);
assert.match(scene7Template,/\.scene-type-7 \.s7-safe\{left:8vw;right:8vw;bottom:9px;font-size:9px;line-height:1\.15\}/);
const scene6Template=fs.readFileSync(path.resolve(__dirname,'templates/scene-6-daily-summary-template.html'),'utf8');
assert.match(scene6Template,/@media \(orientation:portrait\) and \(max-width:640px\)\{/);
assert.match(scene6Template,/\.scene-type-6\{align-items:flex-start;justify-content:center;padding:18px 6vw 22px\}/);
assert.match(scene6Template,/\.scene-type-6 \.s6-hero\{margin-top:7px;font-size:clamp\(34px,9\.2vw,46px\);line-height:\.94\}/);
assert.match(scene6Template,/\.scene-type-6 \.s6-tile\{padding:10px 12px;min-height:82px;border-radius:16px\}/);
assert.match(scene6Template,/\.scene-type-6 \.s6-verdict\{margin-top:10px;font-size:clamp\(19px,5\.2vw,26px\);line-height:1\.08\}/);
const runtime=fs.readFileSync(path.resolve(__dirname,'runtime/recap-runtime.js'),'utf8');
const soundtrackCorsIndex=runtime.indexOf("audio.crossOrigin='anonymous';");
const soundtrackSrcIndex=runtime.indexOf('audio.src=CONTRACT.soundtrack;');
assert.ok(soundtrackCorsIndex>=0,'Soundtrack audio must opt into anonymous CORS mode.');
assert.ok(soundtrackSrcIndex>soundtrackCorsIndex,'Soundtrack crossOrigin must be set before soundtrack src.');
assert.doesNotMatch(runtime,/durations=\{2:5000,3:6500,4:8000,5:9500\}/);
assert.doesNotMatch(runtime,/marks=\[900,2200,3500,4800,6100\]/);
assert.match(runtime,/root\.dataset\.resultRevealMs/);
assert.match(runtime,/data-role="s8-footer"/);
assert.match(runtime,/marks\.at\(-1\)\+550/);
assert.match(runtime,/function scene8ResultFx\(bet,outcomeIndex\)/);
assert.match(runtime,/coinFx\(22\)/);
assert.match(runtime,/emojiFx\(\['🎉','🏆','🙌','🔥','✨'\],10,'burst'\)/);
assert.match(runtime,/const lossIcons=\['😩','😬','🤦‍♂️','🙈','💔','😖','🫣'\];if\(n%2===0\)reactionFx/);
assert.doesNotMatch(runtime,/scene8ResultFx[^\n]*lossStampFx/);
assert.doesNotMatch(runtime,/emojiFx\(lossIcons/);
assert.doesNotMatch(runtime,/scene8ResultFx[^\n]*💸/);
assert.match(runtime,/let winFxIndex=0,lossFxIndex=0/);
assert.match(runtime,/scene8ResultFx\(bet,fxIndex\)/);
assert.match(runtime,/function beginScene\(i,cls='is-active'\)\{[^\n]*resetGlobalFx\(\)/);
assert.strictEqual(__test.durationWithinHardMaxMs(330000),true);
assert.strictEqual(__test.durationWithinHardMaxMs(330001),false);
__test.validateScene8RuntimeContract();
const bad=fastPlan(5,5);bad.scenes.find(x=>x.sceneType===8).comments=['one'];
assert.throws(()=>buildRecap({bettings:makeBettings(5),scenePlan:bad}),e=>e instanceof BuildError&&(/comments.length/.test(e.message)||e.stage==='SCENE_PLAN_SCHEMA'));
const tolerantBettings=makeBettings(5);
const tolerantPlan=fastPlan(5,5);
tolerantPlan.scenes[0].openingTeaser='<b>'+('Very long but harmless recap prose '.repeat(30))+'</b>';
tolerantPlan.scenes.find(x=>x.sceneType===8).headline='Odds @ 3, $20 in play, <script>not executable</script> '+('extra words '.repeat(30));
tolerantPlan.scenes.find(x=>x.sceneType===8).comments=tolerantPlan.scenes.find(x=>x.sceneType===8).comments.map((_,i)=>'Result '+(i+1)+' <em>display only</em> '+('long copy '.repeat(20)));
const tolerantOut=buildRecap({bettings:tolerantBettings,scenePlan:tolerantPlan});
assert.match(tolerantOut.html,/&lt;b&gt;Very long but harmless recap prose/);
assert.match(tolerantOut.html,/&lt;script&gt;not executable&lt;\/script&gt;/);
assert.match(tolerantOut.html,/&lt;em&gt;display only&lt;\/em&gt;/);
assert.doesNotMatch(tolerantOut.html,/<script>not executable<\/script>/);


function replayPlan(total,replaySequences){
  const [s1,s6,s7]=edgeScenes(),scenes=[s1],selected=new Set(replaySequences);
  for(let n=1;n<=total;n++){
    scenes.push({sceneType:2,betSequence:n,tensionLine:'Next bet ready.',reactionLine:'Result recorded.'});
    if(selected.has(n)) scenes.push({sceneType:3,betSequence:n,replayLabel:'RACE REPLAY',replayComments:['Result in','Race complete']});
  }
  scenes.push(s6,s7);
  return {planVersion:'2.0',scenes};
}

// Scene 3 runner-name layout keeps normal names on natural word boundaries and
// only enables mid-word breaking for genuinely long single-word names.
{
  const normal=makeBettings(5);
  normal.bets[0].runnerName='JETT SMASH';
  normal.bets[0].replayUrl='https://example.com/jett-smash.mp4';
  const normalOut=buildRecap({bettings:normal,scenePlan:replayPlan(5,[1])});
  assert.match(normalOut.html,/class="s3-horse ">JETT SMASH<\/div>/);

  const longSingle=makeBettings(5);
  longSingle.bets[0].runnerName='SUPERCALIFRAGILISTIC';
  longSingle.bets[0].replayUrl='https://example.com/long-runner.mp4';
  const longSingleOut=buildRecap({bettings:longSingle,scenePlan:replayPlan(5,[1])});
  assert.match(longSingleOut.html,/class="s3-horse long-single-word">SUPERCALIFRAGILISTIC<\/div>/);
}

// Scene 3 eligibility is footage-based, not WIN-only. A losing bet with HTTPS footage is valid.
{
  const bettings=makeBettings(5);
  bettings.bets[1].replayUrl='https://example.com/loss-replay.mp4';
  assert.strictEqual(bettings.bets[1].result,'LOSS');
  const out=buildRecap({bettings,scenePlan:replayPlan(5,[2])});
  assert.match(out.html,/"replayResult":"LOSS"/);
  assert.match(out.html,/"replayBetType":"WIN"/);
  assert.match(out.html,/if\(data\.replayResult==='WIN'\)replayCelebrationFx\(root,data\.replayBetType\);else replayLossFx\(root\)/);
  assert.match(out.html,/replayLossPayoffFx\(root\)/);
  assert.match(out.html,/replayCoinExplosion\(root,42\)/);
  assert.match(out.html,/NOOOO!/);
  assert.match(out.html,/PATHETIC!/);
}

// A winning PLACE wager must celebrate the wager outcome without implying the runner won the race.
{
  const bettings=makeBettings(5);
  bettings.bets[0].betType='PLACE';
  bettings.bets[0].finishingPosition=2;
  bettings.bets[0].replayUrl='https://example.com/place-win-replay.mp4';
  const out=buildRecap({bettings,scenePlan:replayPlan(5,[1])});
  assert.match(out.html,/"replayResult":"WIN"/);
  assert.match(out.html,/"replayBetType":"PLACE"/);
  assert.match(out.html,/PLACE BET WON!/);
  assert.match(out.html,/type==='PLACE'\?\['PLACE BET WON!'\]/);
}

// The Builder independently protects the planner invariant that one video cannot appear twice.
{
  const bettings=makeBettings(5);
  const shared='https://example.com/shared-replay.mp4';
  bettings.bets[0].replayUrl=shared;
  bettings.bets[1].replayUrl=shared;
  assert.throws(
    ()=>buildRecap({bettings,scenePlan:replayPlan(5,[1,2])}),
    e=>e instanceof BuildError&&/replay URL may appear at most once/.test(e.message)
  );
}


// Scene 3 may follow a Scene 5 when its representative bet is contained in that group.
{
  const bettings=makeBettings(5);
  bettings.bets[0].runnerName='VERZAIN';
  bettings.bets[0].betType='WIN';
  bettings.bets[0].replayUrl='https://example.com/verzain-replay.mp4';
  bettings.bets[1].raceId=bettings.bets[0].raceId;
  bettings.bets[1].raceName=bettings.bets[0].raceName;
  bettings.bets[1].meeting=bettings.bets[0].meeting;
  bettings.bets[1].state=bettings.bets[0].state;
  bettings.bets[1].raceNumber=bettings.bets[0].raceNumber;
  bettings.bets[1].raceTime=bettings.bets[0].raceTime;
  bettings.bets[1].runnerId=bettings.bets[0].runnerId;
  bettings.bets[1].runnerNumber=bettings.bets[0].runnerNumber;
  bettings.bets[1].runnerName='VERZAIN';
  bettings.bets[1].betType='PLACE';

  const [s1,s6,s7]=edgeScenes();
  const scene5={
    sceneType:5,
    betSequences:[1,2],
    setupKicker:'NEXT UP',
    setupHeadline:'Two bets on one runner',
    payoffHeadline:'Those results are in',
    contextLine:'The day keeps moving.'
  };
  const plan={planVersion:'2.0',scenes:[
    s1,
    scene5,
    {sceneType:3,betSequence:1,replayLabel:'RACE REPLAY',replayComments:['Result in','Race complete']},
    {sceneType:5,betSequences:[3,4],setupKicker:'NEXT UP',setupHeadline:'Two more bets',payoffHeadline:'Those results are in',contextLine:'The day keeps moving.'},
    {sceneType:2,betSequence:5,tensionLine:'Final bet ready.',reactionLine:'Result recorded.'},
    s6,
    s7
  ]};

  const out=buildRecap({bettings,scenePlan:plan});
  assert.strictEqual(out.replayCount,1);
  assert.match(out.html,/VERZAIN/);
  assert.match(out.html,/WIN/);
  assert.match(out.html,/PLACE/);

  const bad=JSON.parse(JSON.stringify(plan));
  bad.scenes[2].betSequence=3;
  bettings.bets[2].replayUrl='https://example.com/wrong-replay.mp4';
  assert.throws(
    ()=>buildRecap({bettings,scenePlan:bad}),
    e=>e instanceof BuildError&&/replay must immediately follow Scene 2 or Scene 5 containing the same bet/.test(e.message)
  );
}

const runtimeContract=JSON.parse(fs.readFileSync(path.resolve(__dirname,'contracts/runtime-contract.json'),'utf8'));
assert.strictEqual(runtimeContract.timeline.scene1.durationMs,14000);
assert.strictEqual(runtimeContract.timeline.scene2.durationMs,9000);
assert.strictEqual(runtimeContract.timeline.scene2.endHoldMs,1000);
assert.strictEqual(runtimeContract.timeline.scene4.durationMs,8000);
assert.strictEqual(runtimeContract.timeline.scene4.endHoldMs,2000);
assert.deepStrictEqual(runtimeContract.timeline.scene5.durationMsByRaceCount,{2:10400,3:13300});
assert.strictEqual(runtimeContract.timeline.scene5.endHoldMs,2000);
assert.strictEqual(runtimeContract.timeline.scene6.durationMs,9500);
assert.strictEqual(runtimeContract.timeline.scene6.endHoldMs,3000);
assert.deepStrictEqual(runtimeContract.timeline.scene8.durationMsByBetCount,{2:5000,3:6500,4:8000,5:9500});
assert.strictEqual(runtimeContract.timeline.scene8.endHoldMs,2000);
assert.strictEqual(
  __test.calculatePlanDurationMs(fastPlan(5,5)),
  38900,
  'Builder duration must include configured scene end holds'
);
assert.match(runtime,/const END_HOLD_MS=\{2:1000,4:2000,5:2000,6:3000,8:2000\}/);
assert.strictEqual((runtime.match(/tasks\.push\(\{at:d\+\(END_HOLD_MS\[type\]\|\|0\),fn:next\}\)/g)||[]).length,2);
assert.deepStrictEqual(runtimeContract.timeline.scene2.actionsRatio,{
  race:0,
  bet:0.09,
  tension:0.22,
  dot1:0.25,
  dot2:0.278,
  dot3:0.306,
  dot4:0.333,
  dot5:0.361,
  finish:0.394,
  verdict:0.428,
  fxStart:0.461,
  reaction:0.583,
  pnl:0.711
});
assert.match(runtime,/\['finish',\.394\]/);
assert.match(runtime,/\['reaction',\.583\]/);
assert.match(runtime,/\['pnl',\.711\]/);
assert.match(runtime,/\[\.25,\.278,\.306,\.333,\.361\]/);
assert.match(runtime,/at:\.461\*d/);

assert.strictEqual(runtimeContract.timeline.scene3.replayClipSeconds,17);
assert.strictEqual(runtimeContract.timeline.scene3.replayStartSecondsBeforeEnd,48);
assert.strictEqual(runtimeContract.timeline.scene3.replayEndSecondsBeforeEnd,31);
assert.strictEqual(runtimeContract.timeline.scene3.plannedPlaybackMs,17000);
assert.strictEqual(runtimeContract.timeline.scene3.exitFadeMs,550);
assert.strictEqual(runtimeContract.timeline.scene3.outcomeFxAtMs,12400);
assert.strictEqual(runtimeContract.timeline.scene3.secondaryLossFxAtMs,13550);
assert.match(runtime,/at:12400,fn:\(\)=>\{if\(data\.replayResult==='WIN'\)replayCelebrationFx\(root,data\.replayBetType\);else replayLossFx\(root\)\}/);
assert.match(runtime,/function replayPayoffFx\(root,betType='WIN'\)/);
assert.match(runtime,/PLACE BET WON!/);
assert.match(runtime,/at:13550,fn:\(\)=>\{if\(data\.replayResult==='LOSS'\)replayLossPayoffFx\(root\)\}/);

function setLosingTrifecta(bettings,index) {
  const bet=bettings.bets[index];
  assert.equal(bet.result,'LOSS');
  delete bet.runnerId;
  bet.runnerName=null;
  bet.runnerNumber=null;
  bet.finishingPosition=null;
  bet.odds=null;
  bet.betType='TRIFECTA';
  bet.selectedRunners=[
    {runnerNumber:2,runnerName:'HORSE TWO',finishingPosition:0},
    {runnerNumber:8,runnerName:'HORSE EIGHT',finishingPosition:2},
    {runnerNumber:11,runnerName:'HORSE ELEVEN',finishingPosition:0},
    {runnerNumber:14,runnerName:'HORSE FOURTEEN',finishingPosition:0}
  ];
  return bettings;
}
{
  // Scene 8: exact three backed names and no fake price or single-runner finish.
  const bettings=setLosingTrifecta(makeBettings(5),1);
  const out=buildRecap({bettings,scenePlan:fastPlan(5,5)});
  assert.match(out.html,/HORSE TWO · HORSE EIGHT · HORSE ELEVEN/);
  assert.doesNotMatch(out.html,/TRIFECTA @/);
  assert.match(out.html,/TRIFECTA • \$10/);
}
{
  // Scene 2: the final single-card bet is a Trifecta, while regular bets remain.
  const bettings=setLosingTrifecta(makeBettings(5),4);
  const out=buildRecap({bettings,scenePlan:fastPlan(5,4)});
  assert.match(out.html,/\$10 TRIFECTA/);
  assert.doesNotMatch(out.html,/TRIFECTA @/);
  assert.match(out.html,/HORSE TWO · HORSE EIGHT · HORSE ELEVEN/);
}


{
  // Trifecta replay: preserves playback and substitutes grounded multi-runner identity.
  const data=setLosingTrifecta(makeBettings(5),1);
  data.bets[1].replayUrl='https://example.com/trifecta-race-replay.mp4';
  const result=buildRecap({bettings:data,scenePlan:replayPlan(5,[2])});
  assert.strictEqual(result.replayCount,1);
  assert.match(result.html,/class="s3-horse trifecta-selection">HORSE TWO · HORSE EIGHT · HORSE ELEVEN<\/div>/);
  assert.match(result.html,/\$10 TRIFECTA<\/strong>/);
  assert.doesNotMatch(result.html,/TRIFECTA @/);
}
{
  // Trifecta grouped card with an ordinary WIN; both render in their own roles.
  const data=setLosingTrifecta(makeBettings(5),1);
  const [s1,s6,s7]=edgeScenes();
  const plan={planVersion:'2.0',scenes:[
    s1,
    {sceneType:5,betSequences:[1,2],setupKicker:'NEXT UP',setupHeadline:'Two bets',
      payoffHeadline:'Those results are in',contextLine:'The day keeps moving.'},
    {sceneType:5,betSequences:[3,4],setupKicker:'NEXT UP',setupHeadline:'Two more bets',
      payoffHeadline:'Those results are in',contextLine:'The day keeps moving.'},
    {sceneType:2,betSequence:5,tensionLine:'Final bet ready.',reactionLine:'Result recorded.'},
    s6,s7
  ]};
  const result=buildRecap({bettings:data,scenePlan:plan});
  assert.match(result.html,/class="s5-horse trifecta-selection">HORSE TWO · HORSE EIGHT · HORSE ELEVEN<\/div>/);
  assert.match(result.html,/TRIFECTA • \$10/);
  assert.doesNotMatch(result.html,/TRIFECTA • \$10 @/);
  assert.match(result.html,/class="s5-horse ">RUNNER WITH A DELIBERATELY LONG NAME 1<\/div>/);
}

console.log('Builder Scene 8 and Trifecta regression tests passed.');

// Long-name support is shared at runtime; original laptop CSS remains intact.
{
 const bettings=makeBettings(5);
 bettings.bets[0].runnerName='FIFTYFIVECHEVY';
 bettings.bets[0].replayUrl='https://example.com/fiftyfivechevy.mp4';
 const html=buildRecap({bettings,scenePlan:replayPlan(5,[1])}).html;
 assert.match(html,/class="s2-horse s2-reveal long-single-word"[^>]*>FIFTYFIVECHEVY<\/div>/);
 assert.match(html,/class="s3-horse long-single-word">FIFTYFIVECHEVY<\/div>/);
 for(const n of [2,3,5,8])assert.match(html,new RegExp(n+':\\\\{selector:'));
 assert.match(html,/function fitHorseNames\\(\\)/);
}
