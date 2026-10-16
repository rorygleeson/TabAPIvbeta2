'use strict';
const assert=require('node:assert/strict');
const {displayBetRunners}=require('../shared/bet-presentation');
const {buildLlmCopyInput}=require('../lambda/scene-planner/llm-copy-input');
const {buildRecap}=require('../lambda/builder-recap/recap-builder');
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
bet.return=200;
bet.profitLoss=bet.return-bet.stake;
bet.selectedRunners=sample.selectedRunners;
let running=0;
for(const b of data.bets){running+=b.profitLoss;b.runningPnl=Number(running.toFixed(2));}
data.summary.wins++;
data.summary.losses--;
data.summary.totalReturned=Number(data.bets.reduce((x,b)=>x+b.return,0).toFixed(2));
data.summary.finalPnl=Number(running.toFixed(2));
data.summary.biggestWinSequence=bet.sequence;
const scenePlan={
 planVersion:'2.0',
 scenes:[
 {sceneType:1,openingTeaser:'A racing day gets underway.'},
 {sceneType:2,betSequence:1,tensionLine:'The opening result is close.',reactionLine:'The first bet is settled.'},
 {sceneType:5,betSequences:[2,3,4],setupKicker:'Next up',setupHeadline:'More bets',payoffHeadline:'Results in',contextLine:'Onwards'},
 {sceneType:5,betSequences:[5,6],setupKicker:'Next up',setupHeadline:'More bets',payoffHeadline:'Results in',contextLine:'Onwards'},
 {sceneType:8,betSequences:[7,8,9],headline:'Fast results',headlineCategory:'MIXED',comments:['One.','Two.','Three.'],blockReaction:'The day moves forward.'},
 {sceneType:6,dayVerdict:'The day had a notable result.',standoutHighlightType:'biggestWin',standoutCopy:'One result stood out.'},
 {sceneType:7,selectedFinalHighlights:['totalBets','wins','finalPnl'],finalSummary:'The results are in.',shareCaption:'My recap'}
 ]
};
// Focus first on shared runner facts, not on this hand-built plan's policy eligibility.
const fact={artifactType:'deterministicScenePlan',artifactVersion:'1.0',scenes:[{sceneType:2,betSequence:bet.sequence}]};
const copy=buildLlmCopyInput(data,fact);
assert.equal(copy.factCatalog['B'+bet.sequence+'_RUNNER'],'WINNING HORSE · SECOND HORSE · THIRD HORSE');
assert.equal(copy.factCatalog['B'+bet.sequence+'_BET_RESULT'],'WIN');
console.log('Winning boxed Trifecta identity and LLM presentation facts passed.');
