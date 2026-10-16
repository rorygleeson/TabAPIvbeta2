'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildDeterministicScenePlan } = require('../lambda/scene-planner/scene-planner');
const { buildLlmCopyInput, buildLlmModelPayload } = require('../lambda/scene-planner/llm-copy-input');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/bettings-5.json'), 'utf8'));
const basePlan = buildDeterministicScenePlan(fixture);
const baseCopy = buildLlmCopyInput(fixture, basePlan);
const bettings = structuredClone(fixture);
const bet = bettings.bets[0];
bet.betType = 'TRIFECTA';
bet.runnerId = undefined;
bet.runnerNumber = null;
bet.runnerName = null;
bet.odds = null;
bet.finishingPosition = null;
bet.selectedRunners = [
  {runnerNumber:2,runnerName:'RUNNER TWO',finishingPosition:0},
  {runnerNumber:8,runnerName:'RUNNER EIGHT',finishingPosition:2},
  {runnerNumber:11,runnerName:'RUNNER ELEVEN',finishingPosition:0},
  {runnerNumber:14,runnerName:'RUNNER FOURTEEN',finishingPosition:0}
];
const plan = buildDeterministicScenePlan(bettings);
const copy = buildLlmCopyInput(bettings, plan);
const atoms = copy.factCatalog;
assert.equal(atoms.B1_RUNNER, 'RUNNER TWO · RUNNER EIGHT · RUNNER ELEVEN');
assert.equal('B1_DECIMAL_ODDS' in atoms, false, 'no invented Trifecta odds');
assert.equal('B1_FINISH' in atoms, false, 'no invented single-runner finishing position');
assert.equal(atoms.B1_BET_TYPE, 'TRIFECTA');
assert.equal(atoms.B1_BET_RESULT, 'LOSS');
assert.equal(atoms.B1_STAKE, baseCopy.factCatalog.B1_STAKE);
assert.equal(atoms.B2_RUNNER, baseCopy.factCatalog.B2_RUNNER, 'ordinary bets unchanged');
assert.equal(atoms.B2_DECIMAL_ODDS, baseCopy.factCatalog.B2_DECIMAL_ODDS);
assert.equal(atoms.B2_FINISH, baseCopy.factCatalog.B2_FINISH);
assert.equal(copy.protectedTerms.includes('RUNNER TWO · RUNNER EIGHT · RUNNER ELEVEN'), true);
assert.equal(buildLlmModelPayload(copy).scenes.length, copy.scenes.length);
const covered = plan.scenes.flatMap(s=>s.sceneType===2?[s.betSequence]:[5,8].includes(s.sceneType)?s.betSequences:[]);
assert.deepEqual(covered,[1,2,3,4,5]);

// No false same-runner grouping: two Trifectas share the same race and null identities.
const repeated = structuredClone(bettings);
repeated.bets[1] = { ...structuredClone(bet), sequence:2, betTime:fixture.bets[1].betTime, profitLoss:fixture.bets[1].profitLoss, runningPnl:fixture.bets[1].runningPnl, stake:fixture.bets[1].stake, replayUrl:fixture.bets[1].replayUrl };
assert.doesNotThrow(()=>buildDeterministicScenePlan(repeated));
console.log('Trifecta planner and LLM grounding regression passed.');
