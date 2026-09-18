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

function assertGroundingScopes(payload) {
  for (const scene of payload.scenes) {
    assert.ok(scene.context.factAtomsByPhase);
    assert.ok(Array.isArray(scene.context.protectedTerms));

    if (scene.sceneType === 2) {
      const pre = scene.context.factAtomsByPhase.PRE_RESULT;
      const post = scene.context.factAtomsByPhase.POST_RESULT;
      const prefix = 'B' + scene.betSequence + '_';
      assert.ok(pre[prefix + 'RUNNER']);
      assert.strictEqual(prefix + 'FINISH' in pre, false);
      assert.ok(post[prefix + 'FINISH']);
      assert.ok(post[prefix + 'PROFIT_LOSS']);
    }

    if (scene.sceneType === 5) {
      const pre = scene.context.factAtomsByPhase.PRE_RESULT_BLOCK;
      const post = scene.context.factAtomsByPhase.POST_RESULT_BLOCK;
      assert.ok(pre.BLOCK_TOTAL_STAKE);
      assert.strictEqual('BLOCK_PROFIT_LOSS' in pre, false);
      assert.ok(post.BLOCK_PROFIT_LOSS);
    }

    if (scene.sceneType === 8) {
      const pre = scene.context.factAtomsByPhase.PRE_RESULT_BLOCK;
      const byBet = scene.context.factAtomsByPhase.POST_RESULT_BY_BET;
      assert.ok(pre.BLOCK_TOTAL_STAKE);
      assert.ok(Array.isArray(byBet));
      assert.strictEqual(byBet.length, scene.betSequences.length);
      byBet.forEach((atoms, index) => {
        const prefix = 'B' + scene.betSequences[index] + '_';
        assert.ok(atoms[prefix + 'FINISH']);
        assert.ok(atoms[prefix + 'PROFIT_LOSS']);
      });
    }
  }
}

for (const totalBets of [5, 8, 16, 32, 75]) {
  const bettings = readJson('bettings-' + totalBets + '.json');
  const deterministicPlan = buildDeterministicScenePlan(bettings);
  const payload = buildLlmCopyInput(bettings, deterministicPlan);

  assert.strictEqual(payload.copyInputVersion, '2.1');
  assert.strictEqual(payload.groundingProtocol, 'FACT_PARTS_V2');
  assert.strictEqual(payload.scenes.length, deterministicPlan.scenes.length);
  assertNoForbiddenFields(payload);
  assertGroundingScopes(payload);

  payload.scenes.forEach((scene, index) => {
    assert.strictEqual(scene.sceneIndex, index);
    assert.strictEqual(scene.sceneType, deterministicPlan.scenes[index].sceneType);
    assert.ok(Object.keys(scene.requiredFields).length > 0, 'Scene ' + index + ' must request LLM fields');
    for (const rule of Object.values(scene.requiredFields)) {
      assert.ok(['parts', 'partsArray', 'enum'].includes(rule.responseType), 'Every LLM field must declare responseType');
    }
  });

  const scene8s = payload.scenes.filter(scene => scene.sceneType === 8);
  if (totalBets <= 16) {
    assert.strictEqual(scene8s.length, 0, totalBets + '-bet payload must not contain Scene 8');
  }

  console.log(
    'OK grounded LLM copy input ' + totalBets + ': scenes=' + payload.scenes.length + ' scene8=' + scene8s.length
  );
}

{
  const bettings = readJson('bettings-8.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));

  const group67 = payload.scenes.find(scene =>
    scene.sceneType === 5 &&
    JSON.stringify(scene.betSequences) === JSON.stringify([6, 7])
  );
  assert.ok(group67, '8-bet fixture must contain Scene 5 for bets 6 and 7');
  const post = group67.context.factAtomsByPhase.POST_RESULT_BLOCK;
  assert.strictEqual(post.B6_FINISH, 'GIN AND BARE IT finished 4th');
  assert.strictEqual(post.B7_FINISH, 'INSAIN CHAOS finished 2nd');
  assert.strictEqual(post.BLOCK_PROFIT_LOSS, 'the block lost $85');

  const dayScene = payload.scenes.find(scene => scene.sceneType === 6);
  const day = dayScene.context.factAtomsByPhase.POST_DAY;
  assert.strictEqual(day.DAY_WINNING_BETS, '3 winning bets');
  assert.strictEqual(day.DAY_RACE_WINNERS, '2 backed runners won their races');
}

console.log('FACT_PARTS_V2 LLM copy input regression tests passed.');
