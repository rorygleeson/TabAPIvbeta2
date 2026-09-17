'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { buildDeterministicScenePlan } = require('./scene-planner');
const { buildLlmCopyInput } = require('./llm-copy-input');
const { validateCopyResponse } = require('./llm-copy-response');
const { mergeCopyIntoPlan } = require('./llm-copy-merge');
const { buildRecap } = require('../builder-recap/recap-builder');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

function mockCopyFromInput(copyInput) {
  return {
    scenes: copyInput.scenes.map(scene => {
      const item = { sceneIndex: scene.sceneIndex };

      switch (scene.sceneType) {
        case 1:
          item.openingTeaser = 'A full racing day is ready to unfold.';
          break;
        case 2:
          item.tensionLine = 'This one had the day leaning on it.';
          item.reactionLine = 'That result shifted the running story.';
          break;
        case 3:
          item.replayLabel = 'WATCH IT AGAIN';
          item.replayComments = ['Here we go', 'Get there'];
          break;
        case 4:
          item.lookingBackStory = 'The early stretch delivered enough movement to shape the day.';
          item.lookingAheadTeaser = 'Plenty remained on the card before the final result.';
          break;
        case 5:
          item.setupKicker = 'NEXT BLOCK';
          item.setupHeadline = 'A few more chances';
          item.payoffHeadline = 'The block is settled';
          item.contextLine = 'Those races moved the running position again.';
          break;
        case 6:
          item.dayVerdict = '{{DAY_WINNING_BETS}} shaped a day with several swings.';
          item.standoutHighlightType = 'totalReturned';
          item.standoutCopy = 'That was the clearest single turning point of the day.';
          break;
        case 7:
          item.selectedFinalHighlights = ['totalBets', 'wins', 'finalPnl'];
          item.finalSummary = '{{DAY_FINAL_PNL}} when it was all done.';
          item.shareCaption = 'My full racing-day recap, from the first bet to the final result.';
          break;
        case 8:
          item.headline = 'THE NEXT RUN OF BETS';
          item.headlineCategory = 'RACE_SEQUENCE_OR_DAY_STAGE';
          item.comments = scene.betSequences.map(() => 'Result locked in');
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

  assert.strictEqual(finalPlan.planVersion, '2.0');
  assert.deepStrictEqual(
    structuralProjection(finalPlan),
    structuralProjection(deterministicPlan),
    'Merge must preserve deterministic structure exactly'
  );

  assert.strictEqual('artifactType' in finalPlan, false);
  assert.strictEqual('artifactVersion' in finalPlan, false);
  assert.strictEqual(JSON.stringify(finalPlan).includes('{{'), false, 'Final scene plan must not contain fact atom placeholders');

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

{
  const bettings = readJson('bettings-5.json');
  const deterministicPlan = buildDeterministicScenePlan(bettings);
  const copyInput = buildLlmCopyInput(bettings, deterministicPlan);
  const good = mockCopyFromInput(copyInput);

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

console.log('Final scene-plan merge and Builder compatibility tests passed.');
