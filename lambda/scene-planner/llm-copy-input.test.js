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

  assert.strictEqual(payload.copyInputVersion, '2.3');
  assert.strictEqual(payload.groundingProtocol, 'FACT_PARTS_V2_2');
  assert.strictEqual(payload.scenes.length, deterministicPlan.scenes.length);
  assert.ok(payload.factCatalog && typeof payload.factCatalog === 'object');
  assert.ok(Array.isArray(payload.protectedTerms));
  assertNoForbiddenFields(payload);
  assertGroundingScopes(payload);
  for (const scene of payload.scenes) {
    assert.ok(scene.context.allowedGlobalFactIdsByPhase, 'Every scene must carry deterministic allowed global fact scopes');
  }

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
  assert.strictEqual(post.B6_FINISH, 'GIN AND BARE IT finished 4th.');
  assert.strictEqual(post.B7_FINISH, 'INSAIN CHAOS finished 2nd.');
  assert.strictEqual(post.BLOCK_PROFIT_LOSS, 'The block lost $85.');

  const dayScene = payload.scenes.find(scene => scene.sceneType === 6);
  const day = dayScene.context.factAtomsByPhase.POST_DAY;
  assert.strictEqual(day.DAY_WINNING_BETS, '3 winning bets');
  assert.strictEqual(day.DAY_RACE_WINNERS, '2 backed runners won their races.');
}


{
  const bettings = readJson('bettings-8.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));

  assert.strictEqual(payload.factCatalog.B8_RUNNER, 'LE PLUS RAPIDE');
  assert.strictEqual(payload.factCatalog.B8_RESULT_SUMMARY, 'LE PLUS RAPIDE finished 1st and the bet made $70 profit.');

  const opening = payload.scenes.find(scene => scene.sceneType === 1);
  const openingScope = new Set(opening.context.allowedGlobalFactIdsByPhase.PRE_RESULT_DAY);
  assert.ok(openingScope.has('B8_RUNNER'));
  assert.ok(openingScope.has('B8_BET_SETUP'));
  assert.strictEqual(openingScope.has('B8_FINISH'), false, 'Opening must not expose result facts');

  const bet3 = payload.scenes.find(scene => scene.sceneType === 2 && scene.betSequence === 3);
  const bet3Pre = new Set(bet3.context.allowedGlobalFactIdsByPhase.PRE_RESULT);
  const bet3Post = new Set(bet3.context.allowedGlobalFactIdsByPhase.POST_RESULT);
  assert.ok(bet3Pre.has('B1_FINISH'), 'Bet 3 pre-result may reference already-completed bet 1');
  assert.ok(bet3Pre.has('B8_RUNNER'), 'Future pre-result facts remain usable');
  assert.strictEqual(bet3Pre.has('B3_FINISH'), false, 'Current bet result must not leak pre-result');
  assert.strictEqual(bet3Pre.has('B8_FINISH'), false, 'Future result must not leak pre-result');
  assert.ok(bet3Post.has('B3_FINISH'), 'Current result becomes available post-result');
  assert.strictEqual(bet3Post.has('B4_FINISH'), false, 'Later result must remain unavailable');

  const midpoint = payload.scenes.find(scene => scene.sceneType === 4);
  const checkpoint = midpoint.checkpointAfterBetSequence;
  const midpointBack = new Set(midpoint.context.allowedGlobalFactIdsByPhase.POST_COMPLETED_BETS);
  assert.ok(midpointBack.has('B' + checkpoint + '_FINISH'));
  assert.strictEqual(midpointBack.has('B' + (checkpoint + 1) + '_FINISH'), false);
  assert.ok(midpointBack.has('B8_RUNNER'), 'Midpoint may mention future pre-result facts without outcomes');

  const group67 = payload.scenes.find(scene =>
    scene.sceneType === 5 &&
    JSON.stringify(scene.betSequences) === JSON.stringify([6, 7])
  );
  const group67Pre = new Set(group67.context.allowedGlobalFactIdsByPhase.PRE_RESULT_BLOCK);
  const group67Post = new Set(group67.context.allowedGlobalFactIdsByPhase.POST_RESULT_BLOCK);
  assert.ok(group67Pre.has('B5_FINISH'));
  assert.strictEqual(group67Pre.has('B6_FINISH'), false);
  assert.ok(group67Post.has('B6_FINISH'));
  assert.ok(group67Post.has('B7_FINISH'));
  assert.strictEqual(group67Post.has('B8_FINISH'), false);

  for (const sceneType of [6, 7]) {
    const scene = payload.scenes.find(item => item.sceneType === sceneType);
    const postDay = new Set(scene.context.allowedGlobalFactIdsByPhase.POST_DAY);
    assert.ok(postDay.has('B1_RUNNER'));
    assert.ok(postDay.has('B8_RUNNER'));
    assert.ok(postDay.has('B1_RESULT_SUMMARY'));
    assert.ok(postDay.has('B8_RESULT_SUMMARY'));
    assert.ok(postDay.has('DAY_FINAL_PNL'));
  }
}

{
  const bettings = readJson('bettings-75.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));
  const finalScene = payload.scenes.find(scene => scene.sceneType === 7);
  const postDay = new Set(finalScene.context.allowedGlobalFactIdsByPhase.POST_DAY);
  assert.ok(postDay.has('B1_RUNNER'));
  assert.ok(postDay.has('B38_RESULT_SUMMARY'));
  assert.ok(postDay.has('B75_RUNNER'));
  assert.ok(postDay.has('B75_RESULT_SUMMARY'));
  assert.ok(payload.factCatalog.B75_RUNNER, '75-bet catalog must include final bet');
}

console.log('FACT_PARTS_V2_2 LLM copy input regression tests passed.');
