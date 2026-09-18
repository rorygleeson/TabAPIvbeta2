'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildDeterministicScenePlan } = require('./scene-planner');
const { buildLlmCopyInput, buildLlmModelPayload } = require('./llm-copy-input');

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
  const modelPayload = buildLlmModelPayload(payload);

  assert.strictEqual(payload.copyInputVersion, '2.3');
  assert.strictEqual(modelPayload.modelPayloadVersion, '1.0');
  assert.strictEqual(modelPayload.groundingProtocol, 'FACT_PARTS_COMPACT_V1');
  assert.strictEqual(modelPayload.scenes.length, deterministicPlan.scenes.length);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(modelPayload, 'factCatalog'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(modelPayload, 'protectedTerms'), false);
  assert.strictEqual(payload.groundingProtocol, 'FACT_PARTS_V2_2');
  assert.strictEqual(payload.scenes.length, deterministicPlan.scenes.length);
  assert.ok(payload.factCatalog && typeof payload.factCatalog === 'object');
  assert.ok(Array.isArray(payload.protectedTerms));
  assertNoForbiddenFields(payload);
  assertGroundingScopes(payload);
  for (const scene of payload.scenes) {
    assert.ok(scene.context.allowedGlobalFactIdsByPhase, 'Local validation input keeps deterministic global scopes');
  }
  for (const scene of modelPayload.scenes) {
    assert.ok(scene.context.factAtomsByPhase, 'Model payload keeps only scene-local phase facts');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(scene.context, 'allowedGlobalFactIdsByPhase'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(scene.context, 'protectedTerms'), false);
  }
  assertNoForbiddenFields(modelPayload);

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

  const grouped = payload.scenes.find(scene => scene.sceneType === 5 && scene.betSequences.length >= 2);
  assert.ok(grouped, '8-bet fixture must contain at least one Scene 5 group');

  const post = grouped.context.factAtomsByPhase.POST_RESULT_BLOCK;
  const firstSequence = grouped.betSequences[0];
  const secondSequence = grouped.betSequences[1];
  assert.ok(post['B' + firstSequence + '_FINISH']);
  assert.ok(post['B' + secondSequence + '_FINISH']);
  assert.ok(post.BLOCK_PROFIT_LOSS);

  for (const atoms of [grouped.context.factAtomsByPhase.PRE_RESULT_BLOCK, post]) {
    for (const [id, value] of Object.entries(atoms)) {
      if (id.startsWith('BLOCK_')) {
        assert.strictEqual(/\\bblock\\b/iu.test(String(value)), false, id + ' must not leak internal block terminology');
      }
    }
  }

  const dayScene = payload.scenes.find(scene => scene.sceneType === 6);
  const day = dayScene.context.factAtomsByPhase.POST_DAY;
  assert.ok(day.DAY_WINNING_BETS, 'Post-day facts must expose winning-bet count');
  assert.ok(day.DAY_RACE_WINNERS, 'Post-day facts must expose backed race-winner count');

  const meetingCount = new Set(bettings.bets.map(bet => bet.meeting)).size;
  assert.strictEqual(day.DAY_TOTAL_BETS, String(bettings.bets.length));
  assert.strictEqual(day.DAY_MEETING_COUNT, String(meetingCount));
  assert.match(day.DAY_WINNING_BETS, /^\d+$/u);
  assert.match(day.DAY_RACE_WINNERS, /^\d+$/u);
  assert.match(day.DAY_FINAL_PNL, /^(?:[+-]\$|\$0$)/u);

  const firstBet = bettings.bets[0];
  const firstPrefix = 'B' + firstBet.sequence + '_';
  assert.strictEqual(payload.factCatalog[firstPrefix + 'BET_TYPE'], firstBet.betType);
  assert.strictEqual(payload.factCatalog[firstPrefix + 'STAKE'].startsWith('

{
  const bettings = readJson('bettings-8.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));

  const finalBet = bettings.bets[bettings.bets.length - 1];
  const finalPrefix = 'B' + finalBet.sequence + '_';
  assert.strictEqual(payload.factCatalog[finalPrefix + 'RUNNER'], finalBet.runnerName);
  assert.ok(payload.factCatalog[finalPrefix + 'FINISH']);
  assert.ok(payload.factCatalog[finalPrefix + 'PROFIT_LOSS']);

  const opening = payload.scenes.find(scene => scene.sceneType === 1);
  const openingScope = new Set(opening.context.allowedGlobalFactIdsByPhase.PRE_RESULT_DAY);
  assert.ok(openingScope.has(finalPrefix + 'RUNNER'));
  assert.ok(openingScope.has(finalPrefix + 'STAKE'));
  assert.ok(openingScope.has(finalPrefix + 'ODDS'));
  assert.strictEqual(openingScope.has(finalPrefix + 'FINISH'), false, 'Opening must not expose result facts');

  const firstFeatured = payload.scenes.find(scene => scene.sceneType === 2);
  assert.ok(firstFeatured, '8-bet fixture must contain a Scene 2');
  const currentPrefix = 'B' + firstFeatured.betSequence + '_';
  const pre = new Set(firstFeatured.context.allowedGlobalFactIdsByPhase.PRE_RESULT);
  const post = new Set(firstFeatured.context.allowedGlobalFactIdsByPhase.POST_RESULT);

  if (firstFeatured.betSequence > 1) {
    assert.ok(pre.has('B1_FINISH'), 'Featured pre-result scope may reference already-completed results');
  }
  assert.ok(pre.has(finalPrefix + 'RUNNER'), 'Future pre-result facts remain usable');
  assert.strictEqual(pre.has(currentPrefix + 'FINISH'), false, 'Current bet result must not leak pre-result');
  if (finalBet.sequence > firstFeatured.betSequence) {
    assert.strictEqual(pre.has(finalPrefix + 'FINISH'), false, 'Future result must not leak pre-result');
  }
  assert.ok(post.has(currentPrefix + 'FINISH'), 'Current result becomes available post-result');

  const midpoint = payload.scenes.find(scene => scene.sceneType === 4);
  const checkpoint = midpoint.checkpointAfterBetSequence;
  const midpointBack = new Set(midpoint.context.allowedGlobalFactIdsByPhase.POST_COMPLETED_BETS);
  assert.ok(midpointBack.has('B' + checkpoint + '_FINISH'));
  assert.strictEqual(midpointBack.has('B' + (checkpoint + 1) + '_FINISH'), false);
  assert.ok(midpointBack.has(finalPrefix + 'RUNNER'), 'Midpoint may mention future pre-result facts without outcomes');

  const grouped = payload.scenes.find(scene => scene.sceneType === 5 && scene.betSequences.length >= 2);
  assert.ok(grouped, '8-bet fixture must contain a grouped Scene 5');
  const groupPre = new Set(grouped.context.allowedGlobalFactIdsByPhase.PRE_RESULT_BLOCK);
  const groupPost = new Set(grouped.context.allowedGlobalFactIdsByPhase.POST_RESULT_BLOCK);
  const firstGroupSequence = grouped.betSequences[0];
  const lastGroupSequence = grouped.betSequences[grouped.betSequences.length - 1];

  if (firstGroupSequence > 1) {
    assert.ok(groupPre.has('B' + (firstGroupSequence - 1) + '_FINISH'));
  }
  assert.strictEqual(groupPre.has('B' + firstGroupSequence + '_FINISH'), false);
  assert.ok(groupPost.has('B' + firstGroupSequence + '_FINISH'));
  assert.ok(groupPost.has('B' + lastGroupSequence + '_FINISH'));
  if (lastGroupSequence < bettings.bets.length) {
    assert.strictEqual(groupPost.has('B' + (lastGroupSequence + 1) + '_FINISH'), false);
  }

  for (const sceneType of [6, 7]) {
    const scene = payload.scenes.find(item => item.sceneType === sceneType);
    const postDay = new Set(scene.context.allowedGlobalFactIdsByPhase.POST_DAY);
    assert.ok(postDay.has('B1_RUNNER'));
    assert.ok(postDay.has(finalPrefix + 'RUNNER'));
    assert.ok(postDay.has('B1_FINISH'));
    assert.ok(postDay.has('B1_PROFIT_LOSS'));
    assert.ok(postDay.has(finalPrefix + 'FINISH'));
    assert.ok(postDay.has(finalPrefix + 'PROFIT_LOSS'));
    assert.ok(postDay.has('DAY_FINAL_PNL'));
  }
}


{
  const bettings = readJson('bettings-75.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));
  const modelPayload = buildLlmModelPayload(payload);
  const richBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const compactBytes = Buffer.byteLength(JSON.stringify(modelPayload), 'utf8');
  assert.ok(compactBytes < richBytes * 0.5, '75-bet model payload must be less than half the rich validation input');
  assert.ok(compactBytes < richBytes, 'Compact model payload must be smaller than rich validation input');
  const finalScene = payload.scenes.find(scene => scene.sceneType === 7);
  const postDay = new Set(finalScene.context.allowedGlobalFactIdsByPhase.POST_DAY);
  assert.ok(postDay.has('B1_RUNNER'));
  assert.ok(postDay.has('B38_FINISH'));
  assert.ok(postDay.has('B38_PROFIT_LOSS'));
  assert.ok(postDay.has('B75_RUNNER'));
  assert.ok(postDay.has('B75_FINISH'));
  assert.ok(postDay.has('B75_PROFIT_LOSS'));
  assert.ok(payload.factCatalog.B75_RUNNER, '75-bet catalog must include final bet');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(modelPayload, 'factCatalog'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(modelPayload.scenes[0].context, 'allowedGlobalFactIdsByPhase'), false);
  console.log('75-bet payload bytes: rich=' + richBytes + ' compact=' + compactBytes);
}

console.log('FACT_PARTS_V2_2 local validation input + FACT_PARTS_COMPACT_V1 Bedrock payload regression tests passed.');
), true);
  assert.match(payload.factCatalog[firstPrefix + 'ODDS'], /^\d+(?:\.\d+)?$/u);
  assert.match(payload.factCatalog[firstPrefix + 'FINISH'], /^\d+(?:st|nd|rd|th)$/u);
  assert.ok(['WIN', 'LOSS'].includes(payload.factCatalog[firstPrefix + 'BET_RESULT']));
  assert.match(payload.factCatalog[firstPrefix + 'PROFIT_LOSS'], /^(?:[+-]\$|\$0$)/u);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payload.factCatalog, firstPrefix + 'BET_SETUP'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payload.factCatalog, firstPrefix + 'RESULT_SUMMARY'), false);

  assert.match(post.BLOCK_BET_COUNT, /^\d+$/u);
  assert.strictEqual(post.BLOCK_TOTAL_STAKE.startsWith('

{
  const bettings = readJson('bettings-8.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));

  const finalBet = bettings.bets[bettings.bets.length - 1];
  const finalPrefix = 'B' + finalBet.sequence + '_';
  assert.strictEqual(payload.factCatalog[finalPrefix + 'RUNNER'], finalBet.runnerName);
  assert.ok(payload.factCatalog[finalPrefix + 'FINISH']);
  assert.ok(payload.factCatalog[finalPrefix + 'PROFIT_LOSS']);

  const opening = payload.scenes.find(scene => scene.sceneType === 1);
  const openingScope = new Set(opening.context.allowedGlobalFactIdsByPhase.PRE_RESULT_DAY);
  assert.ok(openingScope.has(finalPrefix + 'RUNNER'));
  assert.ok(openingScope.has(finalPrefix + 'STAKE'));
  assert.ok(openingScope.has(finalPrefix + 'ODDS'));
  assert.strictEqual(openingScope.has(finalPrefix + 'FINISH'), false, 'Opening must not expose result facts');

  const firstFeatured = payload.scenes.find(scene => scene.sceneType === 2);
  assert.ok(firstFeatured, '8-bet fixture must contain a Scene 2');
  const currentPrefix = 'B' + firstFeatured.betSequence + '_';
  const pre = new Set(firstFeatured.context.allowedGlobalFactIdsByPhase.PRE_RESULT);
  const post = new Set(firstFeatured.context.allowedGlobalFactIdsByPhase.POST_RESULT);

  if (firstFeatured.betSequence > 1) {
    assert.ok(pre.has('B1_FINISH'), 'Featured pre-result scope may reference already-completed results');
  }
  assert.ok(pre.has(finalPrefix + 'RUNNER'), 'Future pre-result facts remain usable');
  assert.strictEqual(pre.has(currentPrefix + 'FINISH'), false, 'Current bet result must not leak pre-result');
  if (finalBet.sequence > firstFeatured.betSequence) {
    assert.strictEqual(pre.has(finalPrefix + 'FINISH'), false, 'Future result must not leak pre-result');
  }
  assert.ok(post.has(currentPrefix + 'FINISH'), 'Current result becomes available post-result');

  const midpoint = payload.scenes.find(scene => scene.sceneType === 4);
  const checkpoint = midpoint.checkpointAfterBetSequence;
  const midpointBack = new Set(midpoint.context.allowedGlobalFactIdsByPhase.POST_COMPLETED_BETS);
  assert.ok(midpointBack.has('B' + checkpoint + '_FINISH'));
  assert.strictEqual(midpointBack.has('B' + (checkpoint + 1) + '_FINISH'), false);
  assert.ok(midpointBack.has(finalPrefix + 'RUNNER'), 'Midpoint may mention future pre-result facts without outcomes');

  const grouped = payload.scenes.find(scene => scene.sceneType === 5 && scene.betSequences.length >= 2);
  assert.ok(grouped, '8-bet fixture must contain a grouped Scene 5');
  const groupPre = new Set(grouped.context.allowedGlobalFactIdsByPhase.PRE_RESULT_BLOCK);
  const groupPost = new Set(grouped.context.allowedGlobalFactIdsByPhase.POST_RESULT_BLOCK);
  const firstGroupSequence = grouped.betSequences[0];
  const lastGroupSequence = grouped.betSequences[grouped.betSequences.length - 1];

  if (firstGroupSequence > 1) {
    assert.ok(groupPre.has('B' + (firstGroupSequence - 1) + '_FINISH'));
  }
  assert.strictEqual(groupPre.has('B' + firstGroupSequence + '_FINISH'), false);
  assert.ok(groupPost.has('B' + firstGroupSequence + '_FINISH'));
  assert.ok(groupPost.has('B' + lastGroupSequence + '_FINISH'));
  if (lastGroupSequence < bettings.bets.length) {
    assert.strictEqual(groupPost.has('B' + (lastGroupSequence + 1) + '_FINISH'), false);
  }

  for (const sceneType of [6, 7]) {
    const scene = payload.scenes.find(item => item.sceneType === sceneType);
    const postDay = new Set(scene.context.allowedGlobalFactIdsByPhase.POST_DAY);
    assert.ok(postDay.has('B1_RUNNER'));
    assert.ok(postDay.has(finalPrefix + 'RUNNER'));
    assert.ok(postDay.has('B1_FINISH'));
    assert.ok(postDay.has('B1_PROFIT_LOSS'));
    assert.ok(postDay.has(finalPrefix + 'FINISH'));
    assert.ok(postDay.has(finalPrefix + 'PROFIT_LOSS'));
    assert.ok(postDay.has('DAY_FINAL_PNL'));
  }
}


{
  const bettings = readJson('bettings-75.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));
  const modelPayload = buildLlmModelPayload(payload);
  const richBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const compactBytes = Buffer.byteLength(JSON.stringify(modelPayload), 'utf8');
  assert.ok(compactBytes < richBytes * 0.5, '75-bet model payload must be less than half the rich validation input');
  assert.ok(compactBytes < richBytes, 'Compact model payload must be smaller than rich validation input');
  const finalScene = payload.scenes.find(scene => scene.sceneType === 7);
  const postDay = new Set(finalScene.context.allowedGlobalFactIdsByPhase.POST_DAY);
  assert.ok(postDay.has('B1_RUNNER'));
  assert.ok(postDay.has('B38_FINISH'));
  assert.ok(postDay.has('B38_PROFIT_LOSS'));
  assert.ok(postDay.has('B75_RUNNER'));
  assert.ok(postDay.has('B75_FINISH'));
  assert.ok(postDay.has('B75_PROFIT_LOSS'));
  assert.ok(payload.factCatalog.B75_RUNNER, '75-bet catalog must include final bet');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(modelPayload, 'factCatalog'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(modelPayload.scenes[0].context, 'allowedGlobalFactIdsByPhase'), false);
  console.log('75-bet payload bytes: rich=' + richBytes + ' compact=' + compactBytes);
}

console.log('FACT_PARTS_V2_2 local validation input + FACT_PARTS_COMPACT_V1 Bedrock payload regression tests passed.');
), true);
  assert.match(post.BLOCK_PROFIT_LOSS, /^(?:[+-]\$|\$0$)/u);
  assert.match(post.BLOCK_WINNING_BETS, /^\d+$/u);
  assert.match(post.BLOCK_RACE_WINNERS, /^\d+$/u);
}


{
  const bettings = readJson('bettings-8.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));

  const finalBet = bettings.bets[bettings.bets.length - 1];
  const finalPrefix = 'B' + finalBet.sequence + '_';
  assert.strictEqual(payload.factCatalog[finalPrefix + 'RUNNER'], finalBet.runnerName);
  assert.ok(payload.factCatalog[finalPrefix + 'FINISH']);
  assert.ok(payload.factCatalog[finalPrefix + 'PROFIT_LOSS']);

  const opening = payload.scenes.find(scene => scene.sceneType === 1);
  const openingScope = new Set(opening.context.allowedGlobalFactIdsByPhase.PRE_RESULT_DAY);
  assert.ok(openingScope.has(finalPrefix + 'RUNNER'));
  assert.ok(openingScope.has(finalPrefix + 'STAKE'));
  assert.ok(openingScope.has(finalPrefix + 'ODDS'));
  assert.strictEqual(openingScope.has(finalPrefix + 'FINISH'), false, 'Opening must not expose result facts');

  const firstFeatured = payload.scenes.find(scene => scene.sceneType === 2);
  assert.ok(firstFeatured, '8-bet fixture must contain a Scene 2');
  const currentPrefix = 'B' + firstFeatured.betSequence + '_';
  const pre = new Set(firstFeatured.context.allowedGlobalFactIdsByPhase.PRE_RESULT);
  const post = new Set(firstFeatured.context.allowedGlobalFactIdsByPhase.POST_RESULT);

  if (firstFeatured.betSequence > 1) {
    assert.ok(pre.has('B1_FINISH'), 'Featured pre-result scope may reference already-completed results');
  }
  assert.ok(pre.has(finalPrefix + 'RUNNER'), 'Future pre-result facts remain usable');
  assert.strictEqual(pre.has(currentPrefix + 'FINISH'), false, 'Current bet result must not leak pre-result');
  if (finalBet.sequence > firstFeatured.betSequence) {
    assert.strictEqual(pre.has(finalPrefix + 'FINISH'), false, 'Future result must not leak pre-result');
  }
  assert.ok(post.has(currentPrefix + 'FINISH'), 'Current result becomes available post-result');

  const midpoint = payload.scenes.find(scene => scene.sceneType === 4);
  const checkpoint = midpoint.checkpointAfterBetSequence;
  const midpointBack = new Set(midpoint.context.allowedGlobalFactIdsByPhase.POST_COMPLETED_BETS);
  assert.ok(midpointBack.has('B' + checkpoint + '_FINISH'));
  assert.strictEqual(midpointBack.has('B' + (checkpoint + 1) + '_FINISH'), false);
  assert.ok(midpointBack.has(finalPrefix + 'RUNNER'), 'Midpoint may mention future pre-result facts without outcomes');

  const grouped = payload.scenes.find(scene => scene.sceneType === 5 && scene.betSequences.length >= 2);
  assert.ok(grouped, '8-bet fixture must contain a grouped Scene 5');
  const groupPre = new Set(grouped.context.allowedGlobalFactIdsByPhase.PRE_RESULT_BLOCK);
  const groupPost = new Set(grouped.context.allowedGlobalFactIdsByPhase.POST_RESULT_BLOCK);
  const firstGroupSequence = grouped.betSequences[0];
  const lastGroupSequence = grouped.betSequences[grouped.betSequences.length - 1];

  if (firstGroupSequence > 1) {
    assert.ok(groupPre.has('B' + (firstGroupSequence - 1) + '_FINISH'));
  }
  assert.strictEqual(groupPre.has('B' + firstGroupSequence + '_FINISH'), false);
  assert.ok(groupPost.has('B' + firstGroupSequence + '_FINISH'));
  assert.ok(groupPost.has('B' + lastGroupSequence + '_FINISH'));
  if (lastGroupSequence < bettings.bets.length) {
    assert.strictEqual(groupPost.has('B' + (lastGroupSequence + 1) + '_FINISH'), false);
  }

  for (const sceneType of [6, 7]) {
    const scene = payload.scenes.find(item => item.sceneType === sceneType);
    const postDay = new Set(scene.context.allowedGlobalFactIdsByPhase.POST_DAY);
    assert.ok(postDay.has('B1_RUNNER'));
    assert.ok(postDay.has(finalPrefix + 'RUNNER'));
    assert.ok(postDay.has('B1_FINISH'));
    assert.ok(postDay.has('B1_PROFIT_LOSS'));
    assert.ok(postDay.has(finalPrefix + 'FINISH'));
    assert.ok(postDay.has(finalPrefix + 'PROFIT_LOSS'));
    assert.ok(postDay.has('DAY_FINAL_PNL'));
  }
}


{
  const bettings = readJson('bettings-75.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));
  const modelPayload = buildLlmModelPayload(payload);
  const richBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const compactBytes = Buffer.byteLength(JSON.stringify(modelPayload), 'utf8');
  assert.ok(compactBytes < richBytes * 0.5, '75-bet model payload must be less than half the rich validation input');
  assert.ok(compactBytes < richBytes, 'Compact model payload must be smaller than rich validation input');
  const finalScene = payload.scenes.find(scene => scene.sceneType === 7);
  const postDay = new Set(finalScene.context.allowedGlobalFactIdsByPhase.POST_DAY);
  assert.ok(postDay.has('B1_RUNNER'));
  assert.ok(postDay.has('B38_FINISH'));
  assert.ok(postDay.has('B38_PROFIT_LOSS'));
  assert.ok(postDay.has('B75_RUNNER'));
  assert.ok(postDay.has('B75_FINISH'));
  assert.ok(postDay.has('B75_PROFIT_LOSS'));
  assert.ok(payload.factCatalog.B75_RUNNER, '75-bet catalog must include final bet');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(modelPayload, 'factCatalog'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(modelPayload.scenes[0].context, 'allowedGlobalFactIdsByPhase'), false);
  console.log('75-bet payload bytes: rich=' + richBytes + ' compact=' + compactBytes);
}

console.log('FACT_PARTS_V2_2 local validation input + FACT_PARTS_COMPACT_V1 Bedrock payload regression tests passed.');
