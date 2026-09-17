'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildDeterministicScenePlan } = require('./scene-planner');
const { buildLlmCopyInput } = require('./llm-copy-input');
const { parseJsonObject, validateCopyResponse } = require('./llm-copy-response');

const ROOT = path.join(__dirname, '..', '..');
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'bettings-8.json'), 'utf8'));
const plan = buildDeterministicScenePlan(fixture);
const input = buildLlmCopyInput(fixture, plan);

function goodResponse() {
  return {
    scenes: input.scenes.map(scene => {
      const out = { sceneIndex: scene.sceneIndex };
      for (const [field, rule] of Object.entries(scene.requiredFields)) {
        if (field === 'standoutHighlightType') out[field] = scene.context.standoutOptions[0].type;
        else if (field === 'selectedFinalHighlights') out[field] = scene.context.availableFinalHighlights.slice(0, 3).map(x => x.type);
        else if (field === 'headlineCategory') out[field] = rule.enum[0];
        else if (field === 'replayComments') out[field] = ['Go now', 'Get there'];
        else if (field === 'comments') out[field] = scene.betSequences.map(() => 'Result in');
        else out[field] = 'Clean recap copy';
      }
      return out;
    })
  };
}

const parsed = parseJsonObject(JSON.stringify(goodResponse()));
const normalized = validateCopyResponse(input, parsed);
assert.strictEqual(normalized.scenes.length, input.scenes.length);

const unexpected = goodResponse();
unexpected.scenes[0].sceneType = 1;
assert.throws(() => validateCopyResponse(input, unexpected), /unexpected field sceneType/);

const missing = goodResponse();
delete missing.scenes[0].openingTeaser;
assert.throws(() => validateCopyResponse(input, missing), /missing field openingTeaser/);

const wordTargetOvershoot = goodResponse();
wordTargetOvershoot.scenes[0].openingTeaser = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen';
assert.doesNotThrow(() => validateCopyResponse(input, wordTargetOvershoot));

const replayIndex = input.scenes.findIndex(scene => scene.sceneType === 3);
assert.ok(replayIndex >= 0, '8-bet fixture must contain a replay scene');

const withinCharTolerance = goodResponse();
withinCharTolerance.scenes[replayIndex].replayLabel = 'x'.repeat(71);
assert.doesNotThrow(() => validateCopyResponse(input, withinCharTolerance));

const overCharTolerance = goodResponse();
overCharTolerance.scenes[replayIndex].replayLabel = 'x'.repeat(72);
assert.throws(() => validateCopyResponse(input, overCharTolerance), /hard maxChars tolerance/);

const withinItemCharTolerance = goodResponse();
withinItemCharTolerance.scenes[replayIndex].replayComments[0] = 'x'.repeat(71);
assert.doesNotThrow(() => validateCopyResponse(input, withinItemCharTolerance));

const overItemCharTolerance = goodResponse();
overItemCharTolerance.scenes[replayIndex].replayComments[0] = 'x'.repeat(72);
assert.throws(() => validateCopyResponse(input, overItemCharTolerance), /hard itemMaxChars tolerance/);

const badIndex = goodResponse();
badIndex.scenes[1].sceneIndex = 99;
assert.throws(() => validateCopyResponse(input, badIndex), /sceneIndex mismatch/);

const group67Index = input.scenes.findIndex(scene =>
  scene.sceneType === 5 &&
  JSON.stringify(scene.betSequences) === JSON.stringify([6, 7])
);
assert.ok(group67Index >= 0);

const groundedGroup = goodResponse();
groundedGroup.scenes[group67Index].payoffHeadline = '{{B6_FINISH}}, while {{B7_FINISH}}';
groundedGroup.scenes[group67Index].contextLine = '{{BLOCK_PROFIT_LOSS}} and the pressure was building.';
const groundedGroupNormalized = validateCopyResponse(input, groundedGroup);
assert.strictEqual(groundedGroupNormalized.scenes[group67Index].payoffHeadline, 'GIN AND BARE IT finished 4th, while INSAIN CHAOS finished 2nd');
assert.strictEqual(groundedGroupNormalized.scenes[group67Index].contextLine, 'the block lost $85 and the pressure was building.');

const falseCollectiveFinish = goodResponse();
falseCollectiveFinish.scenes[group67Index].payoffHeadline = 'Both runners second';
assert.throws(() => validateCopyResponse(input, falseCollectiveFinish), /concrete fact outside a fact atom/);

const dayIndex = input.scenes.findIndex(scene => scene.sceneType === 6);
const ambiguousWinners = goodResponse();
ambiguousWinners.scenes[dayIndex].dayVerdict = 'Three winners shaped the day';
assert.throws(() => validateCopyResponse(input, ambiguousWinners), /concrete fact outside a fact atom/);

const groundedWinningBets = goodResponse();
groundedWinningBets.scenes[dayIndex].dayVerdict = '{{DAY_WINNING_BETS}} shaped the day.';
const groundedDayNormalized = validateCopyResponse(input, groundedWinningBets);
assert.strictEqual(groundedDayNormalized.scenes[dayIndex].dayVerdict, '3 winning bets shaped the day.');

const bet3SceneIndex = input.scenes.findIndex(scene => scene.sceneType === 2 && scene.betSequence === 3);
const protectedRunner = goodResponse();
protectedRunner.scenes[bet3SceneIndex].tensionLine = 'ROCEM is ready to go';
assert.throws(() => validateCopyResponse(input, protectedRunner), /protected factual text outside a fact atom/);

const groundedRunner = goodResponse();
groundedRunner.scenes[bet3SceneIndex].tensionLine = '{{B3_RUNNER}} is ready to go';
const groundedRunnerNormalized = validateCopyResponse(input, groundedRunner);
assert.strictEqual(groundedRunnerNormalized.scenes[bet3SceneIndex].tensionLine, 'ROCEM is ready to go');

const wrongPhaseAtom = goodResponse();
wrongPhaseAtom.scenes[bet3SceneIndex].tensionLine = '{{B3_FINISH}} is the story';
assert.throws(() => validateCopyResponse(input, wrongPhaseAtom), /unknown or wrong-phase fact atom B3_FINISH/);

console.log('Grounded LLM copy response validation tests passed.');
