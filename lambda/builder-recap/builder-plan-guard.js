'use strict';

const fs = require('fs');
const path = require('path');

const runtimeContract = JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts/runtime-contract.json'), 'utf8'));

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
  if (scene?.sceneType === 5 || scene?.sceneType === 8) return Array.isArray(scene.betSequences) ? scene.betSequences.length : 0;
  return 0;
}

function targetDurationSeconds(totalBets) {
  const bands = runtimeContract.durationPolicy.targetBands;
  return bands.find(b => b.maxBets === null || totalBets <= b.maxBets)?.targetSeconds ?? runtimeContract.durationPolicy.hardMaxSeconds;
}

function minimumPrimaryDurationMs(totalBets, { allowScene8 }) {
  const transition = runtimeContract.shell.sceneTransition.durationMs;
  const t = runtimeContract.timeline;
  const options = [
    { size: 1, ms: t.scene2.durationMs + transition },
    { size: 2, ms: t.scene5.durationMsByRaceCount['2'] + transition },
    { size: 3, ms: t.scene5.durationMsByRaceCount['3'] + transition }
  ];
  if (allowScene8) {
    options.push(
      { size: 4, ms: t.scene8.durationMsByBetCount['4'] + transition },
      { size: 5, ms: t.scene8.durationMsByBetCount['5'] + transition }
    );
  }
  const dp = Array(totalBets + 1).fill(Infinity);
  dp[0] = 0;
  for (let n = 1; n <= totalBets; n++) {
    for (const option of options) {
      if (n >= option.size) dp[n] = Math.min(dp[n], dp[n - option.size] + option.ms);
    }
  }
  return t.scene1.durationMs + transition + dp[totalBets] + t.scene6.durationMs + transition;
}

function scene8AllowedForTarget(totalBets) {
  return minimumPrimaryDurationMs(totalBets, { allowScene8: false }) > targetDurationSeconds(totalBets) * 1000;
}

function midpointBoundary(scenes, totalBets) {
  const boundaries = [];
  let completed = 0;
  for (const scene of scenes) {
    completed += primaryContribution(scene);
    if ([2, 5, 8].includes(scene?.sceneType)) boundaries.push(completed);
  }
  if (!boundaries.length) return null;
  return boundaries.reduce((best, value) =>
    Math.abs(value / totalBets - 0.5) < Math.abs(best / totalBets - 0.5) ? value : best,
  boundaries[0]);
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

  if (scenes.some(scene => scene?.sceneType === 8) && !scene8AllowedForTarget(totalBets)) {
    fail(`Scene 8 is not allowed for ${totalBets} bets because Scene 2/5 coverage can meet the ${targetDurationSeconds(totalBets)}s target without Scene 8.`);
  }

  const scene4Index = scenes.findIndex(scene => scene?.sceneType === 4);
  if (scene4Index >= 0) {
    const expectedBoundary = midpointBoundary(scenes, totalBets);
    const actualBefore = completedBefore(scenes, scene4Index);
    const scene4 = scenes[scene4Index];
    if (actualBefore !== expectedBoundary) {
      fail(`Scene 4 must follow ${expectedBoundary} completed primary bets, not ${actualBefore}.`);
    }
    if (scene4.checkpointAfterBetSequence !== expectedBoundary) {
      fail(`Scene 4 checkpointAfterBetSequence must equal ${expectedBoundary}, not ${scene4.checkpointAfterBetSequence ?? 'missing'}.`);
    }
  }
}

module.exports = {
  BuilderPlanGuardError,
  validateBuilderPlanInvariants,
  minimumPrimaryDurationMs,
  scene8AllowedForTarget,
  targetDurationSeconds
};
