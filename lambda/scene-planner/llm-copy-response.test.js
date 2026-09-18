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

const text = value => [{ type: 'text', text: value }];
const fact = id => ({ type: 'fact', id });
const textPart = value => ({ type: 'text', text: value });

function goodResponse() {
  return {
    scenes: input.scenes.map(scene => {
      const out = { sceneIndex: scene.sceneIndex };
      for (const [field, rule] of Object.entries(scene.requiredFields)) {
        if (field === 'standoutHighlightType') out[field] = scene.context.standoutOptions[0].type;
        else if (field === 'selectedFinalHighlights') out[field] = scene.context.availableFinalHighlights.slice(0, 3).map(x => x.type);
        else if (field === 'headlineCategory') out[field] = rule.enum[0];
        else if (field === 'replayComments') out[field] = [text('Go now'), text('Get there')];
        else if (field === 'comments') out[field] = scene.betSequences.map(() => text('Result locked in'));
        else out[field] = text('Clean recap copy');
      }
      return out;
    })
  };
}

assert.strictEqual(input.copyInputVersion, '2.3');
assert.strictEqual(input.groundingProtocol, 'FACT_PARTS_V2_2');

const parsed = parseJsonObject(JSON.stringify(goodResponse()));
const normalized = validateCopyResponse(input, parsed);
assert.strictEqual(normalized.scenes.length, input.scenes.length);

const unexpected = goodResponse();
unexpected.scenes[0].sceneType = 1;
unexpected.debugNote = 'harmless model metadata';
assert.doesNotThrow(() => validateCopyResponse(input, unexpected));
const unexpectedNormalized = validateCopyResponse(input, unexpected);
assert.strictEqual(Object.prototype.hasOwnProperty.call(unexpectedNormalized.scenes[0], 'sceneType'), false);

const missing = goodResponse();
delete missing.scenes[0].openingTeaser;
assert.throws(() => validateCopyResponse(input, missing), /missing field openingTeaser/);

const wordTargetOvershoot = goodResponse();
wordTargetOvershoot.scenes[0].openingTeaser = text('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen');
assert.doesNotThrow(() => validateCopyResponse(input, wordTargetOvershoot));

const replayIndex = input.scenes.findIndex(scene => scene.sceneType === 3);
assert.ok(replayIndex >= 0, '8-bet fixture must contain a replay scene');

const withinCharTolerance = goodResponse();
withinCharTolerance.scenes[replayIndex].replayLabel = text('x'.repeat(71));
assert.doesNotThrow(() => validateCopyResponse(input, withinCharTolerance));

const overCharTolerance = goodResponse();
overCharTolerance.scenes[replayIndex].replayLabel = text('x'.repeat(200));
assert.doesNotThrow(() => validateCopyResponse(input, overCharTolerance));

const withinItemCharTolerance = goodResponse();
withinItemCharTolerance.scenes[replayIndex].replayComments[0] = text('x'.repeat(71));
assert.doesNotThrow(() => validateCopyResponse(input, withinItemCharTolerance));

const overItemCharTolerance = goodResponse();
overItemCharTolerance.scenes[replayIndex].replayComments[0] = text('x'.repeat(200));
assert.doesNotThrow(() => validateCopyResponse(input, overItemCharTolerance));

const badIndex = goodResponse();
badIndex.scenes[1].sceneIndex = 99;
assert.throws(() => validateCopyResponse(input, badIndex), /sceneIndex mismatch/);

const groupedIndex = input.scenes.findIndex(scene => scene.sceneType === 5 && scene.betSequences.length >= 2);
assert.ok(groupedIndex >= 0);
const groupedScene = input.scenes[groupedIndex];
const groupedPostAtoms = groupedScene.context.factAtomsByPhase.POST_RESULT_BLOCK;
const groupedFirst = groupedScene.betSequences[0];
const groupedSecond = groupedScene.betSequences[1];

const groundedGroup = goodResponse();
groundedGroup.scenes[groupedIndex].payoffHeadline = text('A tough double landed.');
groundedGroup.scenes[groupedIndex].contextLine = [
  fact('B' + groupedFirst + '_FINISH'),
  fact('B' + groupedSecond + '_FINISH'),
  fact('BLOCK_PROFIT_LOSS'),
  textPart(' The pressure was building.')
];
const groundedGroupNormalized = validateCopyResponse(input, groundedGroup);
assert.strictEqual(
  groundedGroupNormalized.scenes[groupedIndex].contextLine,
  groupedPostAtoms['B' + groupedFirst + '_FINISH'] + ' ' +
    groupedPostAtoms['B' + groupedSecond + '_FINISH'] + ' ' +
    groupedPostAtoms.BLOCK_PROFIT_LOSS + ' The pressure was building.'
);

const tolerantPrefixIntoClause = goodResponse();
tolerantPrefixIntoClause.scenes[groupedIndex].contextLine = [
  textPart('That result was '),
  fact('BLOCK_PROFIT_LOSS')
];
const tolerantPrefixNormalized = validateCopyResponse(input, tolerantPrefixIntoClause);
assert.strictEqual(tolerantPrefixNormalized.scenes[groupedIndex].contextLine, 'That result was ' + groupedPostAtoms.BLOCK_PROFIT_LOSS);

const tolerantSuffixFromClause = goodResponse();
tolerantSuffixFromClause.scenes[groupedIndex].contextLine = [
  fact('BLOCK_PROFIT_LOSS'),
  textPart(' turned the day around.')
];
const tolerantSuffixNormalized = validateCopyResponse(input, tolerantSuffixFromClause);
assert.strictEqual(tolerantSuffixNormalized.scenes[groupedIndex].contextLine, groupedPostAtoms.BLOCK_PROFIT_LOSS + ' turned the day around.');

const goodClauseNarrative = goodResponse();
goodClauseNarrative.scenes[groupedIndex].contextLine = [
  fact('BLOCK_PROFIT_LOSS'),
  textPart(' That changed the mood.')
];
const goodClauseNarrativeNormalized = validateCopyResponse(input, goodClauseNarrative);
assert.strictEqual(goodClauseNarrativeNormalized.scenes[groupedIndex].contextLine, groupedPostAtoms.BLOCK_PROFIT_LOSS + ' That changed the mood.');

const falseCollectiveFinish = goodResponse();
falseCollectiveFinish.scenes[groupedIndex].payoffHeadline = text('Both runners second');
assert.doesNotThrow(() => validateCopyResponse(input, falseCollectiveFinish));

const ordinaryNarrativeOrdinal = goodResponse();
ordinaryNarrativeOrdinal.scenes[0].openingTeaser = text('The first chapter is about to unfold.');
assert.doesNotThrow(() => validateCopyResponse(input, ordinaryNarrativeOrdinal));

const dayIndex = input.scenes.findIndex(scene => scene.sceneType === 6);
const wageringVocabulary = [
  'That win changed the mood.',
  'The losses were starting to bite.',
  'Profit was back in the conversation.',
  'The return gave the story another twist.',
  'The stake was on and the tension was building.',
  'The odds looked tempting.'
];
for (const phrase of wageringVocabulary) {
  const response = goodResponse();
  response.scenes[dayIndex].dayVerdict = text(phrase);
  assert.doesNotThrow(() => validateCopyResponse(input, response), phrase);
}

const rawNumber = goodResponse();
rawNumber.scenes[dayIndex].dayVerdict = text('Three winners became 3 winners.');
assert.doesNotThrow(() => validateCopyResponse(input, rawNumber));

const groundedWinningBets = goodResponse();
groundedWinningBets.scenes[dayIndex].dayVerdict = [
  fact('DAY_WINNING_BETS'),
  textPart(' shaped the day.')
];
const groundedDayNormalized = validateCopyResponse(input, groundedWinningBets);
assert.strictEqual(
  groundedDayNormalized.scenes[dayIndex].dayVerdict,
  input.scenes[dayIndex].context.factAtomsByPhase.POST_DAY.DAY_WINNING_BETS + ' shaped the day.'
);

const bet3SceneIndex = input.scenes.findIndex(scene => scene.sceneType === 2 && scene.betSequence === 3);
const rawMoney = goodResponse();
rawMoney.scenes[dayIndex].dayVerdict = text('The day finished $20 up.');
assert.doesNotThrow(() => validateCopyResponse(input, rawMoney));

const explicitPosition = goodResponse();
explicitPosition.scenes[groupedIndex].payoffHeadline = text('Both runners finished second');
assert.doesNotThrow(() => validateCopyResponse(input, explicitPosition));

const bet3Runner = fixture.bets[2].runnerName;
const protectedRunner = goodResponse();
protectedRunner.scenes[bet3SceneIndex].tensionLine = text(bet3Runner + ' is ready to go');
assert.doesNotThrow(() => validateCopyResponse(input, protectedRunner));

const groundedRunner = goodResponse();
groundedRunner.scenes[bet3SceneIndex].tensionLine = [
  fact('B3_RUNNER'),
  textPart(' is ready to go')
];
const groundedRunnerNormalized = validateCopyResponse(input, groundedRunner);
assert.strictEqual(groundedRunnerNormalized.scenes[bet3SceneIndex].tensionLine, bet3Runner + ' is ready to go');

const textPartWithExtraMetadata = goodResponse();
textPartWithExtraMetadata.scenes[bet3SceneIndex].tensionLine = [{ type: 'text', text: '<b>ROCEM</b> at $5 is still just display text.', note: 'ignore me' }];
const textMetadataNormalized = validateCopyResponse(input, textPartWithExtraMetadata);
assert.strictEqual(textMetadataNormalized.scenes[bet3SceneIndex].tensionLine, '<b>ROCEM</b> at $5 is still just display text.');

const blankTextFragment = goodResponse();
blankTextFragment.scenes[groupedIndex].contextLine = [
  fact('BLOCK_PROFIT_LOSS'),
  textPart('   '),
  textPart(' The pressure remained.')
];
const blankTextNormalized = validateCopyResponse(input, blankTextFragment);
assert.strictEqual(blankTextNormalized.scenes[groupedIndex].contextLine, groupedPostAtoms.BLOCK_PROFIT_LOSS + ' The pressure remained.');

const wrongPhaseAtom = goodResponse();
wrongPhaseAtom.scenes[bet3SceneIndex].tensionLine = [
  fact('B3_FINISH'),
  textPart(' is the story')
];
assert.throws(() => validateCopyResponse(input, wrongPhaseAtom), /unknown or wrong-phase fact atom B3_FINISH/);

const finalSceneIndex = input.scenes.findIndex(scene => scene.sceneType === 7);
assert.ok(finalSceneIndex >= 0);

const crossSceneFinalFact = goodResponse();
crossSceneFinalFact.scenes[finalSceneIndex].shareCaption = [
  fact('B8_RUNNER'),
  textPart(' closed the day with the final flourish.'),
  fact('B8_RESULT_SUMMARY')
];
const crossSceneFinalNormalized = validateCopyResponse(input, crossSceneFinalFact);
assert.ok(crossSceneFinalNormalized.scenes[finalSceneIndex].shareCaption.includes(fixture.bets[7].runnerName));
assert.ok(crossSceneFinalNormalized.scenes[finalSceneIndex].shareCaption.includes(input.factCatalog.B8_RESULT_SUMMARY));

const futureResultLeak = goodResponse();
futureResultLeak.scenes[bet3SceneIndex].tensionLine = [
  fact('B8_FINISH')
];
assert.throws(() => validateCopyResponse(input, futureResultLeak), /unknown or wrong-phase fact atom B8_FINISH/);

const unknownGlobalFact = goodResponse();
unknownGlobalFact.scenes[finalSceneIndex].shareCaption = [
  fact('B999_RUNNER')
];
assert.throws(() => validateCopyResponse(input, unknownGlobalFact), /unknown or wrong-phase fact atom B999_RUNNER/);

const legacyPlaceholder = goodResponse();
legacyPlaceholder.scenes[bet3SceneIndex].tensionLine = '{{B3_RUNNER}} is ready';
assert.throws(() => validateCopyResponse(input, legacyPlaceholder), /non-empty array of text\/fact parts/);

const factPartWithExtraMetadata = goodResponse();
factPartWithExtraMetadata.scenes[bet3SceneIndex].tensionLine = [{ type: 'fact', id: 'B3_RUNNER', note: 'harmless metadata' }];
const extraMetadataNormalized = validateCopyResponse(input, factPartWithExtraMetadata);
assert.strictEqual(extraMetadataNormalized.scenes[bet3SceneIndex].tensionLine, bet3Runner);




{
  const semanticToleranceCases = [
    'Two chances remain.',
    'The day finished $20 up.',
    'Backed ' + bet3Runner + ' at 5.',
    'Both runners finished second.',
    'Three winning bets from 8 bets.',
    'Odds @ 3 looked short.',
    'Profit moved to +$25.'
  ];
  for (const phrase of semanticToleranceCases) {
    const response = goodResponse();
    response.scenes[dayIndex].dayVerdict = text(phrase);
    assert.doesNotThrow(
      () => validateCopyResponse(input, response),
      'Narrative text semantics must be non-fatal: ' + phrase
    );
  }
}

console.log('FACT_PARTS_V2_2 LLM copy response validation tests passed with prose-quality tolerance.');
