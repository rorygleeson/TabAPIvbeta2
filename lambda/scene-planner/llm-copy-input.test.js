'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildDeterministicScenePlan } = require('./scene-planner');
const { buildLlmCopyInput } = require('./llm-copy-input');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures');
const FORBIDDEN_KEYS = new Set([
  'raceId',
  'runnerId',
  'runnerNumber',
  'replayUrl',
  'betTime',
  'raceTime',
  'schemaVersion',
  'timezone',
  'jobId',
  's3Key',
  'durationMs',
  'sceneDurationMs'
]);

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

function walk(value, visit) {
  if (Array.isArray(value)) return value.forEach(item => walk(item, visit));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    visit(key, child);
    walk(child, visit);
  }
}

function assertNoForbiddenFields(payload) {
  walk(payload, key => {
    assert.strictEqual(
      FORBIDDEN_KEYS.has(key),
      false,
      'LLM payload must not contain forbidden field ' + key
    );
  });
}

function assertSceneTimingScopes(payload) {
  for (const scene of payload.scenes) {
    if (scene.sceneType === 2) {
      assert.ok(scene.context.preResultFacts);
      assert.ok(scene.context.postResultFacts);
      assert.strictEqual('result' in scene.context.preResultFacts, false);
      assert.strictEqual('profitLoss' in scene.context.preResultFacts, false);
      assert.ok('result' in scene.context.postResultFacts);
      assert.ok('profitLoss' in scene.context.postResultFacts);
    }

    if (scene.sceneType === 5 || scene.sceneType === 8) {
      assert.ok(scene.context.preResultBlockFacts);
      const serializedPre = JSON.stringify(scene.context.preResultBlockFacts);
      assert.doesNotMatch(serializedPre, /"result"|"profitLoss"|"finishingPosition"|"return"/);
    }

    if (scene.sceneType === 3) {
      assert.strictEqual('replayUrl' in scene.context.replayFacts, false);
    }
  }
}

for (const totalBets of [5, 8, 16, 32, 75]) {
  const bettings = readJson('bettings-' + totalBets + '.json');
  const deterministicPlan = buildDeterministicScenePlan(bettings);
  const payload = buildLlmCopyInput(bettings, deterministicPlan);

  assert.strictEqual(payload.copyInputVersion, '1.0');
  assert.strictEqual(payload.scenes.length, deterministicPlan.scenes.length);
  assertNoForbiddenFields(payload);
  assertSceneTimingScopes(payload);

  payload.scenes.forEach((scene, index) => {
    assert.strictEqual(scene.sceneIndex, index);
    assert.strictEqual(scene.sceneType, deterministicPlan.scenes[index].sceneType);
    assert.ok(Object.keys(scene.requiredFields).length > 0, 'Scene ' + index + ' must request LLM fields');
  });

  const scene8s = payload.scenes.filter(scene => scene.sceneType === 8);
  if (totalBets <= 16) {
    assert.strictEqual(scene8s.length, 0, totalBets + '-bet payload must not contain Scene 8');
  }

  console.log(
    'OK LLM copy input ' + totalBets + ': scenes=' + payload.scenes.length + ' scene8=' + scene8s.length
  );
}

console.log('LLM copy input regression tests passed.');
