'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { buildDeterministicScenePlan } = require('./scene-planner');
const { buildLlmCopyInput } = require('./llm-copy-input');
const { validateCopyResponse } = require('./llm-copy-response');
const { mergeCopyIntoPlan } = require('./llm-copy-merge');
const { buildFallbackCopy } = require('./llm-copy-fallback');
const { buildRecap } = require('../builder-recap/recap-builder');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

const text = value => value;

function mockCopyFromInput(copyInput) {
  return {
    scenes: copyInput.scenes.map(scene => {
      const item = { sceneIndex: scene.sceneIndex };

      switch (scene.sceneType) {
        case 1:
          item.openingTeaser = text('A full racing day is ready to unfold.');
          break;
        case 2:
          item.tensionLine = text('This one had the day leaning on it.');
          item.reactionLine = text('That result shifted the running story.');
          break;
        case 3:
          item.replayLabel = text('WATCH IT AGAIN');
          item.replayComments = [text('Here we go'), text('Get there')];
          break;
        case 4:
          item.lookingBackStory = text('The early stretch delivered enough movement to shape the day.');
          item.lookingAheadTeaser = text('Plenty remained on the card before the closing chapter.');
          break;
        case 5:
          item.setupKicker = text('NEXT BLOCK');
          item.setupHeadline = text('A few more chances');
          item.payoffHeadline = text('The block is settled');
          item.contextLine = text('Those races moved the running position again.');
          break;
        case 6:
          item.dayVerdict = '<DAY_WINNING_BETS> winning bets shaped a day with several swings.';
          item.standoutHighlightType = 'totalReturned';
          item.standoutCopy = text('That was the clearest single turning point of the day.');
          break;
        case 7:
          item.selectedFinalHighlights = ['totalBets', 'wins', 'finalPnl'];
          item.finalSummary = 'The racing day is complete.';
          item.shareCaption = text('My full racing-day recap, from the opening move to the closing chapter.');
          break;
        case 8:
          item.headline = text('THE NEXT RUN OF BETS');
          item.headlineCategory = 'RACE_SEQUENCE_OR_DAY_STAGE';
          item.comments = scene.betSequences.map(() => text('Result locked in'));
          break;
        default:
          throw new Error('Unsupported scene type ' + scene.sceneType);
      }

      return item;
    })
  };
}

function structuralProjection(plan) {
  return plan.scenes.map(scene => {
    const out = { sceneType: scene.sceneType };
    if (scene.betSequence !== undefined) out.betSequence = scene.betSequence;
    if (scene.betSequences !== undefined) out.betSequences = [...scene.betSequences];
    if (scene.checkpointAfterBetSequence !== undefined) {
      out.checkpointAfterBetSequence = scene.checkpointAfterBetSequence;
    }
    return out;
  });
}

for (const totalBets of [5, 8, 16, 32, 75]) {
  const bettings = readJson('bettings-' + totalBets + '.json');
  const deterministicPlan = buildDeterministicScenePlan(bettings);
  const copyInput = buildLlmCopyInput(bettings, deterministicPlan);
  const copyResponse = mockCopyFromInput(copyInput);
  const validatedCopy = validateCopyResponse(copyInput, copyResponse);
  const finalPlan = mergeCopyIntoPlan(deterministicPlan, validatedCopy);

  assert.strictEqual(copyInput.copyInputVersion, '4.0');
  assert.strictEqual(copyInput.groundingProtocol, 'FACT_SEMANTICS_V4_0');
  assert.strictEqual(finalPlan.planVersion, '2.0');
  assert.deepStrictEqual(
    structuralProjection(finalPlan),
    structuralProjection(deterministicPlan),
    'Merge must preserve deterministic structure exactly'
  );

  assert.strictEqual('artifactType' in finalPlan, false);
  assert.strictEqual('artifactVersion' in finalPlan, false);
  assert.strictEqual(JSON.stringify(finalPlan).includes('FACT_SEMANTICS_V4_0'), false, 'Final scene plan must not contain copy-stage protocol metadata');
  assert.strictEqual(JSON.stringify(finalPlan).includes('<DAY_'), false, 'Final scene plan must not contain unresolved fact placeholders');

  const result = buildRecap({ bettings, scenePlan: finalPlan });
  assert.ok(result.html.includes('data-scene-type='));
  assert.strictEqual(result.betCount, totalBets);
  assert.strictEqual(result.sceneCount, finalPlan.scenes.length);

  console.log(
    'OK final scene-plan -> builder ' + totalBets +
    ': scenes=' + finalPlan.scenes.length +
    ' htmlBytes=' + result.html.length
  );
}

for (const totalBets of [5, 8, 16, 32, 75]) {
  const bettings = readJson('bettings-' + totalBets + '.json');
  const deterministicPlan = buildDeterministicScenePlan(bettings);
  const copyInput = buildLlmCopyInput(bettings, deterministicPlan);
  const fallbackCopy = buildFallbackCopy(copyInput);
  assert.strictEqual(
    /\bblock\b/iu.test(JSON.stringify(fallbackCopy)),
    false,
    'Deterministic fallback must not expose internal block terminology'
  );
  const finalPlan = mergeCopyIntoPlan(deterministicPlan, fallbackCopy);
  const result = buildRecap({ bettings, scenePlan: finalPlan });

  assert.strictEqual(result.betCount, totalBets);
  assert.strictEqual(result.sceneCount, finalPlan.scenes.length);
  assert.deepStrictEqual(
    structuralProjection(finalPlan),
    structuralProjection(deterministicPlan),
    'Fallback copy must preserve deterministic structure exactly'
  );
  console.log('OK deterministic copy fallback -> builder ' + totalBets);
}

{
  const bettings = readJson('bettings-5.json');
  const deterministicPlan = buildDeterministicScenePlan(bettings);
  const copyInput = buildLlmCopyInput(bettings, deterministicPlan);
  const good = validateCopyResponse(copyInput, mockCopyFromInput(copyInput));

  const structuralAttempt = JSON.parse(JSON.stringify(good));
  structuralAttempt.scenes[0].sceneType = 8;
  assert.throws(
    () => mergeCopyIntoPlan(deterministicPlan, structuralAttempt),
    /non-LLM field sceneType/
  );

  const missingField = JSON.parse(JSON.stringify(good));
  delete missingField.scenes[0].openingTeaser;
  assert.throws(
    () => mergeCopyIntoPlan(deterministicPlan, missingField),
    /missing required LLM field openingTeaser/
  );

  const missingScene = JSON.parse(JSON.stringify(good));
  missingScene.scenes.pop();
  assert.throws(
    () => mergeCopyIntoPlan(deterministicPlan, missingScene),
    /exactly one copy item/
  );
}

console.log('FACT_SEMANTICS_V4_0 merge, deterministic fallback and Builder compatibility tests passed.');
