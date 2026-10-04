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
assert.match(runtime,/const lossIcons=\['😩','😬','🤦‍♂️','🙈','💔','😖','🫣'\]/);
assert.doesNotMatch(runtime,/scene8ResultFx[^\n]*💸/);
assert.match(runtime,/let winFxIndex=0,lossFxIndex=0/);
assert.match(runtime,/scene8ResultFx\(bet,fxIndex\)/);
assert.strictEqual(__test.durationWithinHardMaxMs(300000),true);
assert.strictEqual(__test.durationWithinHardMaxMs(300001),false);
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
assert.strictEqual(runtimeContract.timeline.scene2.durationMs,9000);
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
console.log('Builder Scene 8 audit regression tests passed.');