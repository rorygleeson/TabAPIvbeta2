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

assert.strictEqual(input.copyInputVersion, '2.1');
assert.strictEqual(input.groundingProtocol, 'FACT_PARTS_V2');

const parsed = parseJsonObject(JSON.stringify(goodResponse()));
const normalized = validateCopyResponse(input, parsed);
assert.strictEqual(normalized.scenes.length, input.scenes.length);

const unexpected = goodResponse();
unexpected.scenes[0].sceneType = 1;
assert.throws(() => validateCopyResponse(input, unexpected), /unexpected field sceneType/);

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
overCharTolerance.scenes[replayIndex].replayLabel = text('x'.repeat(72));
assert.throws(() => validateCopyResponse(input, overCharTolerance), /hard maxChars tolerance/);

const withinItemCharTolerance = goodResponse();
withinItemCharTolerance.scenes[replayIndex].replayComments[0] = text('x'.repeat(71));
assert.doesNotThrow(() => validateCopyResponse(input, withinItemCharTolerance));

const overItemCharTolerance = goodResponse();
overItemCharTolerance.scenes[replayIndex].replayComments[0] = text('x'.repeat(72));
assert.throws(() => validateCopyResponse(input, overItemCharTolerance), /hard itemMaxChars tolerance/);

const badIndex = goodResponse();
badIndex.scenes[1].sceneIndex = 99;
assert.throws(() => validateCopyResponse(input, badIndex), /sceneIndex mismatch/);

const group67Index = input.scenes.findIndex(scene =>
  scene.sceneType === 5 &&
  JSON.stringify(scene.betSequences) === JSON.stringify([6, 7])
);
assert.ok(group67Index >= 0);

const groundedGroup = goodResponse();
groundedGroup.scenes[group67Index].payoffHeadline = [
  fact('B6_FINISH'),
  textPart(', while '),
  fact('B7_FINISH')
];
groundedGroup.scenes[group67Index].contextLine = [
  fact('BLOCK_PROFIT_LOSS'),
  textPart(' and the pressure was building.')
];
const groundedGroupNormalized = validateCopyResponse(input, groundedGroup);
assert.strictEqual(groundedGroupNormalized.scenes[group67Index].payoffHeadline, 'GIN AND BARE IT finished 4th, while INSAIN CHAOS finished 2nd');
assert.strictEqual(groundedGroupNormalized.scenes[group67Index].contextLine, 'the block lost $85 and the pressure was building.');

const falseCollectiveFinish = goodResponse();
falseCollectiveFinish.scenes[group67Index].payoffHeadline = text('Both runners second');
assert.throws(() => validateCopyResponse(input, falseCollectiveFinish), /raw concrete factual wording/);

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
assert.throws(() => validateCopyResponse(input, rawNumber), /raw concrete factual wording/);

const groundedWinningBets = goodResponse();
groundedWinningBets.scenes[dayIndex].dayVerdict = [
  fact('DAY_WINNING_BETS'),
  textPart(' shaped the day.')
];
const groundedDayNormalized = validateCopyResponse(input, groundedWinningBets);
assert.strictEqual(groundedDayNormalized.scenes[dayIndex].dayVerdict, '3 winning bets shaped the day.');

const bet3SceneIndex = input.scenes.findIndex(scene => scene.sceneType === 2 && scene.betSequence === 3);
const rawMoney = goodResponse();
rawMoney.scenes[dayIndex].dayVerdict = text('The day finished $20 up.');
assert.throws(() => validateCopyResponse(input, rawMoney), /raw concrete factual wording/);

const explicitPosition = goodResponse();
explicitPosition.scenes[group67Index].payoffHeadline = text('Both runners finished second');
assert.throws(() => validateCopyResponse(input, explicitPosition), /raw concrete factual wording/);

const protectedRunner = goodResponse();
protectedRunner.scenes[bet3SceneIndex].tensionLine = text('ROCEM is ready to go');
assert.throws(() => validateCopyResponse(input, protectedRunner), /protected factual text/);

const groundedRunner = goodResponse();
groundedRunner.scenes[bet3SceneIndex].tensionLine = [
  fact('B3_RUNNER'),
  textPart(' is ready to go')
];
const groundedRunnerNormalized = validateCopyResponse(input, groundedRunner);
assert.strictEqual(groundedRunnerNormalized.scenes[bet3SceneIndex].tensionLine, 'ROCEM is ready to go');

const wrongPhaseAtom = goodResponse();
wrongPhaseAtom.scenes[bet3SceneIndex].tensionLine = [
  fact('B3_FINISH'),
  textPart(' is the story')
];
assert.throws(() => validateCopyResponse(input, wrongPhaseAtom), /unknown or wrong-phase fact atom B3_FINISH/);

const legacyPlaceholder = goodResponse();
legacyPlaceholder.scenes[bet3SceneIndex].tensionLine = '{{B3_RUNNER}} is ready';
assert.throws(() => validateCopyResponse(input, legacyPlaceholder), /non-empty array of text\/fact parts/);

const malformedFactPart = goodResponse();
malformedFactPart.scenes[bet3SceneIndex].tensionLine = [{ type: 'fact', id: 'B3_RUNNER', text: 'bad' }];
assert.throws(() => validateCopyResponse(input, malformedFactPart), /must contain only type and id/);


const boundarySource = { context: { protectedTerms: ['Al', 'Sale', 'Te Aroha'] } };
assert.doesNotThrow(() => validateCopyResponse(input, goodResponse()));
assert.strictEqual(require('./llm-copy-response').__test.containsProtectedTerm('final chapter', 'al'), false);
assert.strictEqual(require('./llm-copy-response').__test.containsProtectedTerm('wholesale move', 'sale'), false);
assert.strictEqual(require('./llm-copy-response').__test.containsProtectedTerm('al is next', 'al'), true);
assert.strictEqual(require('./llm-copy-response').__test.containsProtectedTerm('back at te aroha today', 'te aroha'), true);

console.log('FACT_PARTS_V2 LLM copy response validation tests passed.');
