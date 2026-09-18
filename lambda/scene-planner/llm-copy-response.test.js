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
        else if (field === 'comments') out[field] = scene.betSequences.map(() => 'Result locked in');
        else out[field] = 'Clean recap copy';
      }
      return out;
    })
  };
}

assert.strictEqual(input.copyInputVersion, '4.0');
assert.strictEqual(input.groundingProtocol, 'FACT_SEMANTICS_V4_0');

const parsed = parseJsonObject(JSON.stringify(goodResponse()));
const normalized = validateCopyResponse(input, parsed);
assert.strictEqual(normalized.scenes.length, input.scenes.length);

const unexpected = goodResponse();
unexpected.scenes[0].sceneType = 1;
unexpected.debugNote = 'harmless model metadata';
assert.doesNotThrow(() => validateCopyResponse(input, unexpected));
assert.strictEqual(Object.prototype.hasOwnProperty.call(validateCopyResponse(input, unexpected).scenes[0], 'sceneType'), false);

const missing = goodResponse();
delete missing.scenes[0].openingTeaser;
assert.throws(() => validateCopyResponse(input, missing), /missing field openingTeaser/);

const wordTargetOvershoot = goodResponse();
wordTargetOvershoot.scenes[0].openingTeaser = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen';
assert.doesNotThrow(() => validateCopyResponse(input, wordTargetOvershoot));

const replayIndex = input.scenes.findIndex(scene => scene.sceneType === 3);
assert.ok(replayIndex >= 0, '8-bet fixture must contain a replay scene');

const longCopy = goodResponse();
longCopy.scenes[replayIndex].replayLabel = 'x'.repeat(200);
assert.doesNotThrow(() => validateCopyResponse(input, longCopy));

const badIndex = goodResponse();
badIndex.scenes[1].sceneIndex = 99;
assert.throws(() => validateCopyResponse(input, badIndex), /sceneIndex mismatch/);

const groupedIndex = input.scenes.findIndex(scene => scene.sceneType === 5 && scene.betSequences.length >= 2);
assert.ok(groupedIndex >= 0);
const groupedScene = input.scenes[groupedIndex];
const groupedPostAtoms = groupedScene.context.factAtomsByPhase.POST_RESULT_BLOCK;
const groupedFirst = groupedScene.betSequences[0];
const groupedSecond = groupedScene.betSequences[1];

const groupedPnlId = Object.keys(groupedPostAtoms).find(id =>
  /^BLOCK_(?:PROFIT_TEXT|LOSS_TEXT|BREAK_EVEN_TEXT)$/u.test(id)
);
assert.ok(groupedPnlId);
const groundedGroup = goodResponse();
groundedGroup.scenes[groupedIndex].contextLine =
  '<B' + groupedFirst + '_FINISH> then <B' + groupedSecond + '_FINISH>. Net <' + groupedPnlId + '>.';
const groundedGroupNormalized = validateCopyResponse(input, groundedGroup);
assert.strictEqual(
  groundedGroupNormalized.scenes[groupedIndex].contextLine,
  groupedPostAtoms['B' + groupedFirst + '_FINISH'] + ' then ' +
    groupedPostAtoms['B' + groupedSecond + '_FINISH'] + '. Net ' +
    groupedPostAtoms[groupedPnlId] + '.'
);

const dayIndex = input.scenes.findIndex(scene => scene.sceneType === 6);
const groundedWinningBets = goodResponse();
groundedWinningBets.scenes[dayIndex].dayVerdict = '<DAY_WINNING_BETS> winning bets shaped the day.';
const groundedDayNormalized = validateCopyResponse(input, groundedWinningBets);
assert.strictEqual(
  groundedDayNormalized.scenes[dayIndex].dayVerdict,
  input.scenes[dayIndex].context.factAtomsByPhase.POST_DAY.DAY_WINNING_BETS + ' winning bets shaped the day.'
);

const bet3SceneIndex = input.scenes.findIndex(scene => scene.sceneType === 2 && scene.betSequence === 3);
assert.ok(bet3SceneIndex >= 0);
const bet3Runner = fixture.bets[2].runnerName;

const groundedRunner = goodResponse();
groundedRunner.scenes[bet3SceneIndex].tensionLine = '<B3_RUNNER> is ready to go';
assert.strictEqual(
  validateCopyResponse(input, groundedRunner).scenes[bet3SceneIndex].tensionLine,
  bet3Runner + ' is ready to go'
);

const attachedPunctuation = goodResponse();
attachedPunctuation.scenes[bet3SceneIndex].tensionLine = '<B3_RUNNER>, next at <B3_MEETING>.';
assert.strictEqual(
  validateCopyResponse(input, attachedPunctuation).scenes[bet3SceneIndex].tensionLine,
  fixture.bets[2].runnerName + ', next at ' + fixture.bets[2].meeting + '.'
);

const wrongPhaseAtom = goodResponse();
wrongPhaseAtom.scenes[bet3SceneIndex].tensionLine = '<B3_FINISH> is the story';
assert.throws(() => validateCopyResponse(input, wrongPhaseAtom), /unknown or wrong-phase fact atom B3_FINISH/);

const futureResultLeak = goodResponse();
futureResultLeak.scenes[bet3SceneIndex].tensionLine = '<B8_FINISH>';
assert.throws(() => validateCopyResponse(input, futureResultLeak), /unknown or wrong-phase fact atom B8_FINISH/);

const finalSceneIndex = input.scenes.findIndex(scene => scene.sceneType === 7);
assert.ok(finalSceneIndex >= 0);

const b8PnlId = Object.keys(input.factCatalog).find(id =>
  /^B8_(?:PROFIT_TEXT|LOSS_TEXT|BREAK_EVEN_TEXT)$/u.test(id)
);
assert.ok(b8PnlId);
const crossSceneFinalFact = goodResponse();
crossSceneFinalFact.scenes[finalSceneIndex].shareCaption =
  '<B8_RUNNER> finished <B8_FINISH> with <' + b8PnlId + '> on the bet.';
const crossSceneFinalNormalized = validateCopyResponse(input, crossSceneFinalFact);
assert.ok(crossSceneFinalNormalized.scenes[finalSceneIndex].shareCaption.includes(fixture.bets[7].runnerName));
assert.ok(crossSceneFinalNormalized.scenes[finalSceneIndex].shareCaption.includes(input.factCatalog.B8_FINISH));
assert.ok(crossSceneFinalNormalized.scenes[finalSceneIndex].shareCaption.includes(input.factCatalog[b8PnlId]));

const unknownGlobalFact = goodResponse();
unknownGlobalFact.scenes[finalSceneIndex].shareCaption = '<B999_RUNNER>';
assert.throws(() => validateCopyResponse(input, unknownGlobalFact), /unknown or wrong-phase fact atom B999_RUNNER/);

const inventedPlausibleAtom = goodResponse();
inventedPlausibleAtom.scenes[groupedIndex].setupHeadline = '<BLOCK_MEETING_COUNT> meetings in play';
assert.throws(() => validateCopyResponse(input, inventedPlausibleAtom), /unknown or wrong-phase fact atom BLOCK_MEETING_COUNT/);

const malformedPlaceholder = goodResponse();
malformedPlaceholder.scenes[bet3SceneIndex].tensionLine = '<B3_RUNNER is ready';
assert.throws(() => validateCopyResponse(input, malformedPlaceholder), /malformed fact placeholder syntax/);

const htmlMarkup = goodResponse();
htmlMarkup.scenes[bet3SceneIndex].tensionLine = '<b>Big moment</b>';
assert.throws(() => validateCopyResponse(input, htmlMarkup), /malformed fact placeholder syntax/);

const legacyParts = goodResponse();
legacyParts.scenes[bet3SceneIndex].tensionLine = [{ type: 'fact', id: 'B3_RUNNER' }];
assert.throws(() => validateCopyResponse(input, legacyParts), /non-empty grounded string/);

const scene8Index = input.scenes.findIndex(scene => scene.sceneType === 8);
if (scene8Index >= 0) {
  const scene8 = input.scenes[scene8Index];
  const groundedRows = goodResponse();
  groundedRows.scenes[scene8Index].comments = scene8.betSequences.map(seq => '<B' + seq + '_RUNNER> finished <B' + seq + '_FINISH>');
  const rows = validateCopyResponse(input, groundedRows).scenes[scene8Index].comments;
  assert.strictEqual(rows.length, scene8.betSequences.length);

  const wrongRowScope = goodResponse();
  const firstSeq = scene8.betSequences[0];
  const secondSeq = scene8.betSequences[1];
  wrongRowScope.scenes[scene8Index].comments[0] = '<B' + secondSeq + '_FINISH>';
  assert.throws(
    () => validateCopyResponse(input, wrongRowScope),
    new RegExp('unknown or wrong-phase fact atom B' + secondSeq + '_FINISH')
  );
  assert.ok(firstSeq !== secondSeq);
}

const semanticToleranceCases = [
  'Two chances remain.',
  'The day finished $20 up.',
  'Both runners finished second.',
  'Profit was back in the conversation.'
];
for (const phrase of semanticToleranceCases) {
  const response = goodResponse();
  response.scenes[dayIndex].dayVerdict = phrase;
  assert.doesNotThrow(
    () => validateCopyResponse(input, response),
    'Narrative prose semantics remain non-fatal: ' + phrase
  );
}

console.log('FACT_SEMANTICS_V4_0 compact grounded-text response validation tests passed.');
