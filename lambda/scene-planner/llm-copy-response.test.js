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
assert.doesNotThrow(() => validateCopyResponse(input, parsed));

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

console.log('LLM copy response validation tests passed.');
