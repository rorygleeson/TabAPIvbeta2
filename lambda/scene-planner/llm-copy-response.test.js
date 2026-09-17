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

const tooLong = goodResponse();
tooLong.scenes[0].openingTeaser = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen';
assert.throws(() => validateCopyResponse(input, tooLong), /maxWords/);

const badIndex = goodResponse();
badIndex.scenes[1].sceneIndex = 99;
assert.throws(() => validateCopyResponse(input, badIndex), /sceneIndex mismatch/);

console.log('LLM copy response validation tests passed.');
