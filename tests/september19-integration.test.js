'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.STORAGE_BUCKET='local-test';
process.env.JOBS_TABLE='local-test';
process.env.PLANNING_QUEUE_URL='https://sqs.ap-southeast-2.amazonaws.com/123456789012/local-test';

const bets=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/bettings-2026-09-19-trifecta.json'),'utf8'));
const {__test:orchestrator}=require('../lambda/orchestrator/index');
const {buildDeterministicScenePlan}=require('../lambda/scene-planner/scene-planner');
const {buildLlmCopyInput,buildLlmModelPayload}=require('../lambda/scene-planner/llm-copy-input');
const {buildFallbackCopy}=require('../lambda/scene-planner/llm-copy-fallback');
const {mergeCopyIntoPlan}=require('../lambda/scene-planner/llm-copy-merge');
const {buildRecap}=require('../lambda/builder-recap/recap-builder');

assert.equal(bets.bets.length,9);
assert.equal(bets.bets.filter(b=>b.betType==='TRIFECTA').length,3);
const admitted=orchestrator.parseCanonicalBettings({httpMethod:'POST',resource:'/jobs',body:JSON.stringify(bets),isBase64Encoded:false});
assert.equal(admitted.betCount,9);
const deterministic=buildDeterministicScenePlan(admitted.bettings);
const copyInput=buildLlmCopyInput(admitted.bettings,deterministic);
const modelInput=buildLlmModelPayload(copyInput);
assert.equal(modelInput.scenes.length,deterministic.scenes.length);
const fallback=buildFallbackCopy(copyInput);
const scenePlan=mergeCopyIntoPlan(deterministic,fallback);
const out=buildRecap({bettings:admitted.bettings,scenePlan});
const coverage=scenePlan.scenes.flatMap(s=>s.sceneType===2?[s.betSequence]:[5,8].includes(s.sceneType)?s.betSequences:[]);
assert.deepEqual(coverage,[1,2,3,4,5,6,7,8,9]);
for(const tri of bets.bets.filter(b=>b.betType==='TRIFECTA')){
 const label=tri.selectedRunners.slice(0,3).map(r=>r.runnerName).join(' · ');
 assert.ok(out.html.includes(label),'Missing selected runner label: '+label);
}
assert.doesNotMatch(out.html,/TRIFECTA\s*@\s*(?:0|<)/i);
assert.equal(out.betCount,9);
assert.equal(out.finalPnl,bets.summary.finalPnl);
const artifacts=path.join(__dirname,'results');
fs.mkdirSync(artifacts,{recursive:true});
fs.writeFileSync(path.join(artifacts,'september19-recap.html'),out.html);
fs.writeFileSync(path.join(artifacts,'september19-scene-plan.json'),JSON.stringify(scenePlan,null,2));
console.log(JSON.stringify({status:'PASS',admitted:admitted.betCount,trifectas:3,sceneCount:out.sceneCount,replayCount:out.replayCount,finalPnl:out.finalPnl,sceneTypes:scenePlan.scenes.map(s=>s.sceneType),htmlBytes:Buffer.byteLength(out.html)},null,2));
