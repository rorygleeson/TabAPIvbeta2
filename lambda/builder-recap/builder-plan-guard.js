'use strict';

class BuilderPlanGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuilderPlanGuardError';
    this.stage = 'SCENE_PLAN_SEMANTICS';
  }
}

function fail(message) {
  throw new BuilderPlanGuardError(message);
}

function primaryContribution(scene) {
  if (scene?.sceneType === 2) return 1;
  if (scene?.sceneType === 5 || scene?.sceneType === 8) {
    return Array.isArray(scene.betSequences) ? scene.betSequences.length : 0;
  }
  return 0;
}

function midpointBoundary(scenes, totalBets) {
  const boundaries = [];
  let completed = 0;

  for (const scene of scenes) {
    completed += primaryContribution(scene);
    if ([2, 5, 8].includes(scene?.sceneType)) boundaries.push(completed);
  }

  if (!boundaries.length) return null;

  return boundaries.reduce(
    (best, value) =>
      Math.abs(value / totalBets - 0.5) < Math.abs(best / totalBets - 0.5) ? value : best,
    boundaries[0]
  );
}

function completedBefore(scenes, index) {
  return scenes.slice(0, index).reduce((sum, scene) => sum + primaryContribution(scene), 0);
}

function validateBuilderPlanInvariants(bettings, scenePlan) {
  const totalBets = Number(bettings?.summary?.totalBets);
  const scenes = scenePlan?.scenes;

  if (!Number.isInteger(totalBets) || totalBets < 1 || !Array.isArray(scenes)) {
    fail('Builder plan guard requires validated bettings.summary.totalBets and scenePlan.scenes.');
  }

  // Kubrick V2: Scene 2/5/8 structure is owned by the deterministic planner.
  // Builder independently protects semantic invariants, but must not re-apply
  // the retired LLM-planner Scene 8 eligibility/target-duration rule.
  const scene4Index = scenes.findIndex(scene => scene?.sceneType === 4);
  if (scene4Index >= 0) {
    const expectedBoundary = midpointBoundary(scenes, totalBets);
    const actualBefore = completedBefore(scenes, scene4Index);
    const scene4 = scenes[scene4Index];

    if (actualBefore !== expectedBoundary) {
      fail(`Scene 4 must follow ${expectedBoundary} completed primary bets, not ${actualBefore}.`);
    }

    if (scene4.checkpointAfterBetSequence !== expectedBoundary) {
      fail(
        `Scene 4 checkpointAfterBetSequence must equal ${expectedBoundary}, not ${scene4.checkpointAfterBetSequence ?? 'missing'}.`
      );
    }
  }
}

module.exports = {
  BuilderPlanGuardError,
  validateBuilderPlanInvariants
};
