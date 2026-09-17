'use strict';

const assert = require('assert');
const {
  BuilderPlanGuardError,
  validateBuilderPlanInvariants
} = require('./builder-plan-guard');

function bettings(totalBets) {
  return { summary: { totalBets } };
}

function edges() {
  return [
    { sceneType: 1 },
    { sceneType: 6 },
    { sceneType: 7 }
  ];
}

function compactPlan(totalBets, groupSize = 5) {
  const [s1, s6, s7] = edges();
  const scenes = [s1];
  let sequence = 1;

  while (sequence <= totalBets) {
    const remaining = totalBets - sequence + 1;

    if (remaining >= 4) {
      let size = Math.min(groupSize, remaining);
      if (remaining === 6) size = 4;

      if (size >= 4) {
        scenes.push({
          sceneType: 8,
          betSequences: Array.from({ length: size }, (_, i) => sequence + i),
          headline: 'Quick results ahead',
          comments: Array.from({ length: size }, () => 'On we go')
        });
        sequence += size;
        continue;
      }
    }

    scenes.push({
      sceneType: 2,
      betSequence: sequence,
      tensionLine: 'Next up.',
      reactionLine: 'Result in.'
    });
    sequence += 1;
  }

  scenes.push(s6, s7);
  return { planVersion: '2.0', scenes };
}

// Kubrick V2 structural ownership lives in the deterministic planner.
// The Builder must accept legal Scene 8 structure even on smaller days.
assert.doesNotThrow(() => validateBuilderPlanInvariants(bettings(5), compactPlan(5, 5)));
assert.doesNotThrow(() => validateBuilderPlanInvariants(bettings(8), compactPlan(8, 5)));
assert.doesNotThrow(() => validateBuilderPlanInvariants(bettings(16), compactPlan(16, 5)));

const [s1, s6, s7] = edges();
const midpointPlan = {
  planVersion: '2.0',
  scenes: [
    s1,
    { sceneType: 5, betSequences: [1, 2] },
    { sceneType: 4, checkpointAfterBetSequence: 2 },
    { sceneType: 5, betSequences: [3, 4] },
    s6,
    s7
  ]
};

assert.doesNotThrow(() => validateBuilderPlanInvariants(bettings(4), midpointPlan));

const wrongCheckpoint = JSON.parse(JSON.stringify(midpointPlan));
wrongCheckpoint.scenes.find(scene => scene.sceneType === 4).checkpointAfterBetSequence = 3;
assert.throws(
  () => validateBuilderPlanInvariants(bettings(4), wrongCheckpoint),
  error =>
    error instanceof BuilderPlanGuardError &&
    /checkpointAfterBetSequence must equal 2/.test(error.message)
);

const missingCheckpoint = JSON.parse(JSON.stringify(midpointPlan));
delete missingCheckpoint.scenes.find(scene => scene.sceneType === 4).checkpointAfterBetSequence;
assert.throws(
  () => validateBuilderPlanInvariants(bettings(4), missingCheckpoint),
  error =>
    error instanceof BuilderPlanGuardError &&
    /checkpointAfterBetSequence must equal 2/.test(error.message)
);

console.log('Builder independent planner-invariant regression tests passed.');
