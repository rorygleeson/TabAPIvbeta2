'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildDeterministicScenePlan,
  calculateDesiredReplayCount
} = require('./scene-planner');
const policy = require('./planner-policy');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

function primaryCoverage(scenes) {
  const covered = [];
  for (const scene of scenes) {
    if (scene.sceneType === 2) covered.push(scene.betSequence);
    if (scene.sceneType === 5 || scene.sceneType === 8) covered.push(...scene.betSequences);
  }
  return covered;
}

function replaySequences(scenes) {
  return scenes.filter(scene => scene.sceneType === 3).map(scene => scene.betSequence);
}

function assertCoreInvariants(bettings, plan) {
  const scenes = plan.scenes;
  const totalBets = bettings.bets.length;

  assert.strictEqual(plan.artifactType, 'deterministicScenePlan');
  assert.strictEqual(plan.artifactVersion, '1.0');
  assert.strictEqual(scenes[0].sceneType, 1);
  assert.strictEqual(scenes[scenes.length - 2].sceneType, 6);
  assert.strictEqual(scenes[scenes.length - 1].sceneType, 7);

  assert.deepStrictEqual(
    primaryCoverage(scenes),
    Array.from({ length: totalBets }, (_, i) => i + 1),
    `${totalBets}-bet fixture must have exact chronological primary coverage`
  );

  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];

    if (scene.sceneType === 5) {
      assert.ok(scene.betSequences.length === 2 || scene.betSequences.length === 3);
    }

    if (scene.sceneType === 8) {
      assert.ok(scene.betSequences.length === 4 || scene.betSequences.length === 5);
    }

    if (scene.sceneType === 3) {
      const previous = scenes[i - 1];
      assert.ok(previous, 'Scene 3 requires a preceding scene');
      assert.strictEqual(previous.sceneType, 2, 'Scene 3 must immediately follow Scene 2');
      assert.strictEqual(previous.betSequence, scene.betSequence, 'Scene 3 must match preceding Scene 2');

      const bet = bettings.bets[scene.betSequence - 1];
      assert.strictEqual(bet.result, 'WIN', 'Replay bet must be a WIN');
      assert.match(bet.replayUrl || '', /^https:\/\//, 'Replay bet must have HTTPS footage');
    }
  }

  const targetReplayCount = calculateDesiredReplayCount(totalBets, policy.replay);
  assert.ok(
    replaySequences(scenes).length <= targetReplayCount,
    `${totalBets}-bet fixture must not exceed replay target`
  );

  const scene4 = scenes.find(scene => scene.sceneType === 4);
  if (totalBets < policy.midpoint.minBets) {
    assert.strictEqual(scene4, undefined, 'Small recap must omit Scene 4');
  } else {
    assert.ok(scene4, 'Eligible recap must contain Scene 4');
  }
}

for (const totalBets of [5, 8, 16, 32, 75]) {
  const bettings = readJson(`bettings-${totalBets}.json`);
  const plan = buildDeterministicScenePlan(bettings);
  assertCoreInvariants(bettings, plan);

  console.log(
    `OK planner ${totalBets}: scenes=${plan.scenes.length} replays=${replaySequences(plan.scenes).length}`
  );

  if (totalBets === 32) {
    const expected = readJson('deterministic-scene-plan-32.json');
    assert.deepStrictEqual(plan, expected, '32-bet planner output must match checked-in regression fixture');
  }
}

console.log('Deterministic scene planner regression tests passed.');
