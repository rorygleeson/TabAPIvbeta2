'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildDeterministicScenePlan } = require('./scene-planner');
const { buildLlmCopyInput, buildLlmModelPayload } = require('./llm-copy-input');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures');
const FORBIDDEN_KEYS = new Set([
  'raceId','runnerId','runnerNumber','replayUrl','betTime','raceTime',
  'schemaVersion','timezone','jobId','s3Key','durationMs','sceneDurationMs'
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
    assert.strictEqual(FORBIDDEN_KEYS.has(key), false, 'LLM payload must not contain forbidden field ' + key);
  });
}

function assertNoLegacySemanticAtoms(payload) {
  const legacy = [
    /^B\d+_ODDS$/u,
    /_PROFIT_LOSS$/u,
    /_RUNNING_PNL$/u,
    /_RACE_WIN$/u,
    /^DAY_FINAL_PNL$/u,
    /^BLOCK_PROFIT_LOSS$/u,
    /^BLOCK_RUNNING_PNL_/u,
    /^CHECKPOINT_RUNNING_PNL$/u,
    /^STANDOUT_STRONGEST_FINISH_(?:START_BET|END_BET|PNL)$/u
  ];
  for (const id of Object.keys(payload.factCatalog || {})) {
    for (const pattern of legacy) {
      assert.strictEqual(pattern.test(id), false, 'Legacy ambiguous atom must not survive V4: ' + id);
    }
  }
}

function assertTypedPnlAtom(id, value) {
  assert.match(id, /_(?:PROFIT_AMOUNT|LOSS_AMOUNT|BREAK_EVEN_AMOUNT)$/u);
  assert.match(String(value), /^\$\d+(?:\.\d+)?$/u);
  assert.strictEqual(String(value).startsWith('+$'), false);
  assert.strictEqual(String(value).startsWith('-$'), false);
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
      assert.ok(pre[prefix + 'DECIMAL_ODDS']);
      assert.strictEqual(prefix + 'FINISH' in pre, false);
      assert.ok(post[prefix + 'FINISH']);
      assert.strictEqual(
        scene.context.semanticContextByPhase.POST_RESULT.raceWinner,
        Number(payload.factCatalog[prefix + 'FINISH']?.replace(/\D+/gu, '')) === 1
      );
    }

    if (scene.sceneType === 3) {
      assert.ok(scene.context.semanticContextByPhase.POST_RESULT);
      assert.strictEqual(typeof scene.context.semanticContextByPhase.POST_RESULT.raceWinner, 'boolean');
    }

    if (scene.sceneType === 5) {
      const pre = scene.context.factAtomsByPhase.PRE_RESULT_BLOCK;
      const sem = scene.context.semanticContextByPhase.PRE_RESULT_BLOCK.groupPosition;
      assert.ok(pre.BLOCK_TOTAL_STAKE);
      assert.ok(pre.BLOCK_START_BET);
      assert.ok(pre.BLOCK_END_BET);
      assert.strictEqual(typeof sem.isFirstGroup, 'boolean');
      assert.strictEqual(typeof sem.isFinalGroup, 'boolean');
    }

    if (scene.sceneType === 8) {
      const pre = scene.context.factAtomsByPhase.PRE_RESULT_BLOCK;
      const byBet = scene.context.factAtomsByPhase.POST_RESULT_BY_BET;
      const sem = scene.context.semanticContextByPhase.PRE_RESULT_BLOCK.groupPosition;
      assert.ok(pre.BLOCK_TOTAL_STAKE);
      assert.strictEqual(typeof sem.isFinalGroup, 'boolean');
      assert.ok(Array.isArray(byBet));
      assert.strictEqual(byBet.length, scene.betSequences.length);
      byBet.forEach((atoms, index) => {
        const prefix = 'B' + scene.betSequences[index] + '_';
        assert.ok(atoms[prefix + 'FINISH']);
        assert.ok(atoms[prefix + 'DECIMAL_ODDS']);
      });
    }
  }
}

for (const totalBets of [5, 8, 16, 32, 75]) {
  const bettings = readJson('bettings-' + totalBets + '.json');
  const deterministicPlan = buildDeterministicScenePlan(bettings);
  const payload = buildLlmCopyInput(bettings, deterministicPlan);
  const modelPayload = buildLlmModelPayload(payload);

  assert.strictEqual(payload.copyInputVersion, '4.0');
  assert.strictEqual(payload.groundingProtocol, 'FACT_SEMANTICS_V4_0');
  assert.strictEqual(modelPayload.modelPayloadVersion, '1.0');
  assert.strictEqual(modelPayload.groundingProtocol, 'FACT_SEMANTIC_TEMPLATE_V1');
  assert.deepStrictEqual(payload.semanticPolicy, {
    raceActionEvidence: 'NONE',
    replayEvidence: 'RESULT_FACTS_ONLY'
  });
  assert.deepStrictEqual(modelPayload.semanticPolicy, payload.semanticPolicy);
  assert.strictEqual(modelPayload.scenes.length, deterministicPlan.scenes.length);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(modelPayload, 'factCatalog'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(modelPayload, 'protectedTerms'), false);
  assert.ok(payload.factCatalog && typeof payload.factCatalog === 'object');
  assert.ok(Array.isArray(payload.protectedTerms));
  assertNoForbiddenFields(payload);
  assertNoLegacySemanticAtoms(payload);
  assertGroundingScopes(payload);

  for (const scene of payload.scenes) {
    assert.ok(scene.context.allowedGlobalFactIdsByPhase, 'Local validation input keeps deterministic global scopes');
  }
  for (const scene of modelPayload.scenes) {
    assert.ok(scene.context.factAtomsByPhase, 'Model payload keeps scene-local facts');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(scene.context, 'allowedGlobalFactIdsByPhase'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(scene.context, 'protectedTerms'), false);
  }

  payload.scenes.forEach((scene, index) => {
    assert.strictEqual(scene.sceneIndex, index);
    assert.strictEqual(scene.sceneType, deterministicPlan.scenes[index].sceneType);
    assert.ok(Object.keys(scene.requiredFields).length > 0);
    for (const rule of Object.values(scene.requiredFields)) {
      assert.ok(['groundedText','groundedTextArray','enum'].includes(rule.responseType));
    }
  });

  console.log('OK semantic V4 copy input ' + totalBets + ': scenes=' + payload.scenes.length);
}

// Historical failure backfeed: signed P&L ambiguity and odds typing.
{
  const bettings = readJson('bettings-5.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));

  assert.strictEqual(payload.factCatalog.B3_DECIMAL_ODDS, '4.2');
  assert.strictEqual(payload.factCatalog.B3_PROFIT_AMOUNT, '$96');
  assert.strictEqual(payload.factCatalog.B4_LOSS_AMOUNT, '$35');
  assert.strictEqual(payload.factCatalog.B5_PROFIT_AMOUNT, '$38');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payload.factCatalog, 'B3_ODDS'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payload.factCatalog, 'B3_PROFIT_LOSS'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payload.factCatalog, 'B3_RACE_WIN'), false);

  const scene3 = payload.scenes.find(scene => scene.sceneType === 3 && scene.betSequence === 3);
  assert.ok(scene3);
  assert.strictEqual(scene3.context.semanticContextByPhase.POST_RESULT.raceWinner, true);
  assert.strictEqual(payload.semanticPolicy.replayEvidence, 'RESULT_FACTS_ONLY');
  assert.strictEqual(payload.semanticPolicy.raceActionEvidence, 'NONE');

  const dayScene = payload.scenes.find(scene => scene.sceneType === 6);
  const options = dayScene.context.standoutOptions;
  const strongest = options.find(option => option.type === 'strongestFinish');
  assert.ok(strongest);
  const postDay = dayScene.context.factAtomsByPhase.POST_DAY;
  assert.strictEqual(postDay.STANDOUT_STRONGEST_FINISH_BET_RANGE, '3-5');
  assert.strictEqual(postDay.STANDOUT_STRONGEST_FINISH_BET_COUNT, '3');
  assert.strictEqual(postDay.STANDOUT_STRONGEST_FINISH_PROFIT_AMOUNT, '$99');
  assert.ok(strongest.factAtomIds.includes('STANDOUT_STRONGEST_FINISH_BET_COUNT'));
}

// Historical failure backfeed: 75-bet group 36-38 is NOT final; 74-75 IS final.
{
  const bettings = readJson('bettings-75.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));

  const middle = payload.scenes.find(scene =>
    scene.sceneType === 5 &&
    Array.isArray(scene.betSequences) &&
    scene.betSequences[0] === 36 &&
    scene.betSequences[scene.betSequences.length - 1] === 38
  );
  assert.ok(middle, 'Expected Scene 5 for bets 36-38');
  const middleSem = middle.context.semanticContextByPhase.PRE_RESULT_BLOCK.groupPosition;
  const middleFacts = middle.context.factAtomsByPhase.PRE_RESULT_BLOCK;
  assert.deepStrictEqual(
    {
      start: Number(middleFacts.BLOCK_START_BET),
      end: Number(middleFacts.BLOCK_END_BET),
      remaining: Number(middleFacts.BLOCK_BETS_REMAINING_AFTER),
      final: middleSem.isFinalGroup
    },
    { start: 36, end: 38, remaining: 37, final: false }
  );

  const finalGroup = payload.scenes.find(scene =>
    scene.sceneType === 5 &&
    Array.isArray(scene.betSequences) &&
    scene.betSequences[0] === 74
  );
  assert.ok(finalGroup, 'Expected final Scene 5 for bets 74-75');
  const finalSem = finalGroup.context.semanticContextByPhase.PRE_RESULT_BLOCK.groupPosition;
  assert.strictEqual(finalGroup.context.factAtomsByPhase.PRE_RESULT_BLOCK.BLOCK_BETS_REMAINING_AFTER, '0');
  assert.strictEqual(finalSem.isFinalGroup, true);

  const day = payload.scenes.find(scene => scene.sceneType === 6).context.factAtomsByPhase.POST_DAY;
  assert.strictEqual(day.DAY_PROFIT_AMOUNT, '$3813.65');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(day, 'DAY_FINAL_PNL'), false);
}

// Historical failure backfeed: replay narrative has no race-action evidence.
{
  const bettings = readJson('bettings-16.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));
  const replayScenes = payload.scenes.filter(scene => scene.sceneType === 3);
  assert.ok(replayScenes.length > 0);
  assert.strictEqual(payload.semanticPolicy.replayEvidence, 'RESULT_FACTS_ONLY');
  assert.strictEqual(payload.semanticPolicy.raceActionEvidence, 'NONE');
  for (const scene of replayScenes) {
    const sem = scene.context.semanticContextByPhase.POST_RESULT;
    assert.strictEqual(typeof sem.raceWinner, 'boolean');
  }
}

// Every typed P&L atom exposed to the model is unsigned and semantically named.
{
  const bettings = readJson('bettings-75.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));
  for (const [id, value] of Object.entries(payload.factCatalog)) {
    if (/(?:PROFIT_AMOUNT|LOSS_AMOUNT|BREAK_EVEN_AMOUNT)$/u.test(id)) {
      assertTypedPnlAtom(id, value);
    }
  }
}

{
  const bettings = readJson('bettings-75.json');
  const payload = buildLlmCopyInput(bettings, buildDeterministicScenePlan(bettings));
  const modelPayload = buildLlmModelPayload(payload);
  const richBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const compactBytes = Buffer.byteLength(JSON.stringify(modelPayload), 'utf8');
  console.log('75-bet semantic V4 payload bytes: rich=' + richBytes + ' compact=' + compactBytes);
  assert.ok(compactBytes < richBytes * 0.6, '75-bet model payload must remain substantially smaller than rich validation input');
  assert.ok(compactBytes < 75000, 'Semantic V4 model payload should remain compact enough for current architecture: ' + compactBytes + ' bytes');
}

console.log('FACT_SEMANTICS_V4_0 semantic atom and historical-failure regression tests passed.');
