'use strict';
const assert=require('node:assert/strict');
const {displayBetRunners}=require('../shared/bet-presentation');
const {buildLlmCopyInput}=require('../lambda/scene-planner/llm-copy-input');
const {buildRecap}=require('../lambda/builder-recap/recap-builder');
const {buildDeterministicScenePlan}=require('../lambda/scene-planner/scene-planner');
const {buildFallbackCopy}=require('../lambda/scene-planner/llm-copy-fallback');
const {mergeCopyIntoPlan}=require('../lambda/scene-planner/llm-copy-merge');
const fs=require('node:fs');
const path=require('node:path');
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/bettings-2026-09-19-trifecta.json'),'utf8'));

const sample={betType:'TRIFECTA',result:'WIN',selectedRunners:[
 {runnerNumber:10,runnerName:'FOURTH HORSE',finishingPosition:4},
 {runnerNumber:7,runnerName:'THIRD HORSE',finishingPosition:3},
 {runnerNumber:3,runnerName:'WINNING HORSE',finishingPosition:1},
 {runnerNumber:8,runnerName:'SECOND HORSE',finishingPosition:2}
]};
assert.equal(displayBetRunners(sample),'WINNING HORSE · SECOND HORSE · THIRD HORSE');
assert.equal(displayBetRunners({...sample,result:'LOSS'}),'FOURTH HORSE · THIRD HORSE · WINNING HORSE');
assert.equal(displayBetRunners({...sample,selectedRunners:sample.selectedRunners.map(x=>({...x,finishingPosition:0}))}),'FOURTH HORSE · THIRD HORSE · WINNING HORSE');
assert.equal(displayBetRunners({betType:'WIN',runnerName:'ORDINARY HORSE'}),'ORDINARY HORSE');

// Turn a real losing Trifecta into a settled winner while preserving valid accounting.
const data=structuredClone(baseline);
const bet=data.bets.find(b=>b.betType==='TRIFECTA');
bet.result='WIN';
bet.return=500;
bet.profitLoss=bet.return-bet.stake;
bet.selectedRunners=sample.selectedRunners;
let running=0;
for(const b of data.bets){running+=b.profitLoss;b.runningPnl=Number(running.toFixed(2));}
data.summary.wins++;
data.summary.losses--;
data.summary.totalReturned=Number(data.bets.reduce((x,b)=>x+b.return,0).toFixed(2));
data.summary.finalPnl=Number(running.toFixed(2));
data.summary.biggestWinSequence=bet.sequence;
const deterministic=buildDeterministicScenePlan(data);
const copy=buildLlmCopyInput(data,deterministic);
assert.equal(copy.factCatalog['B'+bet.sequence+'_RUNNER'],'WINNING HORSE · SECOND HORSE · THIRD HORSE');
assert.equal(copy.factCatalog['B'+bet.sequence+'_BET_RESULT'],'WIN');
assert.equal(data.summary.highestOddsWinnerSequence,6, 'priced winning WIN still owns highest odds');
const finalPlan=mergeCopyIntoPlan(deterministic,buildFallbackCopy(copy));
const recap=buildRecap({bettings:data,scenePlan:finalPlan});
assert.equal(recap.betCount,9);
assert.equal(recap.finalPnl,data.summary.finalPnl);
assert.match(recap.html,/WINNING HORSE · SECOND HORSE · THIRD HORSE/);
assert.doesNotMatch(recap.html,/TRIFECTA @/);
assert.match(recap.html,/TRIFECTA/);
assert.equal(finalPlan.scenes.find(s=>s.sceneType===6)?.standoutHighlightType !== undefined,true);
console.log('Winning boxed Trifecta identity and LLM presentation facts passed.');
