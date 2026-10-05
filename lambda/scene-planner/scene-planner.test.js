'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildDeterministicScenePlan,
  calculateDesiredReplayCount,
  calculatePlanDurationSeconds
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

assert.strictEqual(calculateDesiredReplayCount(5, policy.replay), 1);
assert.strictEqual(calculateDesiredReplayCount(8, policy.replay), 2);
assert.strictEqual(calculateDesiredReplayCount(16, policy.replay), 2);
assert.strictEqual(calculateDesiredReplayCount(25, policy.replay), 2);
assert.strictEqual(calculateDesiredReplayCount(32, policy.replay), 2);
assert.strictEqual(calculateDesiredReplayCount(50, policy.replay), 3);
assert.strictEqual(calculateDesiredReplayCount(75, policy.replay), 3);

assert.strictEqual(policy.feature.extraScene2ByBets.find(x => x.maxBets === 40).maxExtra, 0);

{
  const runtime = require('./contract-loader').loadContract('runtime-contract.json');
  assert.strictEqual(runtime.durationPolicy.hardMaxSeconds,330);
  const timing = calculatePlanDurationSeconds([
    { sceneType: 1 },
    { sceneType: 2, betSequence: 1 },
    { sceneType: 4 },
    { sceneType: 5, betSequences: [2,3] },
    { sceneType: 6 },
    { sceneType: 8, betSequences: [4,5,6,7,8] },
    { sceneType: 7 }
  ], runtime);
  assert.strictEqual(timing.plannedSeconds,72.2);
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
      assert.match(bet.replayUrl || '', /^https:\/\//, 'Replay bet must have HTTPS footage');
    }
  }

  const targetReplayCount = calculateDesiredReplayCount(totalBets, policy.replay);
  const actualReplayCount = replaySequences(scenes).length;
  assert.ok(
    actualReplayCount <= targetReplayCount,
    `${totalBets}-bet fixture must not exceed replay target`
  );

  if (totalBets <= 16) {
    assert.strictEqual(
      scenes.some(scene => scene.sceneType === 8),
      false,
      `${totalBets}-bet fixture must not use Scene 8`
    );
  }

  if (totalBets > 40) {
    const eligibleReplayCount = new Set(
      bettings.bets
        .filter(bet => /^https:\/\//.test(bet.replayUrl || ''))
        .map(bet => bet.replayUrl)
    ).size;
    assert.ok(
      actualReplayCount >= Math.min(3, eligibleReplayCount),
      `${totalBets}-bet fixture must retain at least three eligible replays`
    );
  }

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
    const repeated = buildDeterministicScenePlan(bettings);
    assert.deepStrictEqual(plan, repeated, '32-bet planner output must remain deterministic');
    assert.strictEqual(replaySequences(plan.scenes).length, 2, '32-bet recap should contain exactly two replays when eligible');
  }
}

// Replay ranking is race/video based. WIN representative groups are preferred
// before LOSS groups; monetary importance and latest-sequence tie-breaks apply within each outcome class.
{
  const bettings = readJson('bettings-8.json');
  const urls = {
    a: 'https://example.com/replay-a.mp4',
    b: 'https://example.com/replay-b.mp4',
    c: 'https://example.com/replay-c.mp4',
    d: 'https://example.com/replay-d.mp4'
  };

  bettings.bets.forEach(bet => { bet.replayUrl = null; });
  bettings.bets[0].replayUrl = urls.a;
  bettings.bets[0].profitLoss = 20;
  bettings.bets[0].result = 'WIN';
  bettings.bets[1].replayUrl = urls.a;
  bettings.bets[1].profitLoss = -12; // replay A net = +8, importance 8
  bettings.bets[1].result = 'LOSS';
  bettings.bets[2].replayUrl = urls.b;
  bettings.bets[2].profitLoss = -30; // importance 30
  bettings.bets[2].result = 'LOSS';
  bettings.bets[3].replayUrl = urls.c;
  bettings.bets[3].profitLoss = 15; // importance 15
  bettings.bets[3].result = 'WIN';
  bettings.bets[4].replayUrl = urls.d;
  bettings.bets[4].profitLoss = -15; // importance 15, later than C
  bettings.bets[4].result = 'LOSS';

  const plan = buildDeterministicScenePlan(bettings);
  assert.deepStrictEqual(
    replaySequences(plan.scenes),
    [1, 4],
    '8-bet recap must prefer eligible WIN replay groups before higher-value LOSS groups'
  );
}


// If WIN replay groups do not fill the quota, the planner fills remaining slots with LOSS groups.
{
  const bettings = readJson('bettings-8.json');
  bettings.bets.forEach(bet => { bet.replayUrl = null; bet.result = 'LOSS'; });
  bettings.bets[0].replayUrl = 'https://example.com/win-replay.mp4';
  bettings.bets[0].result = 'WIN';
  bettings.bets[0].profitLoss = 12;
  bettings.bets[1].replayUrl = 'https://example.com/loss-high.mp4';
  bettings.bets[1].profitLoss = -40;
  bettings.bets[2].replayUrl = 'https://example.com/loss-low.mp4';
  bettings.bets[2].profitLoss = -15;

  const plan = buildDeterministicScenePlan(bettings);
  assert.deepStrictEqual(
    replaySequences(plan.scenes),
    [1, 2],
    'Replay quota should use the available WIN first, then the strongest LOSS fallback'
  );
}

// Currency ranking must compare exact cents, not floating-point accumulation artifacts.
{
  const bettings = readJson('bettings-8.json');
  const urls = {
    high: 'https://example.com/replay-high.mp4',
    earlierTie: 'https://example.com/replay-earlier-tie.mp4',
    laterTie: 'https://example.com/replay-later-tie.mp4'
  };

  bettings.bets.forEach(bet => { bet.replayUrl = null; });
  bettings.bets[0].replayUrl = urls.high;
  bettings.bets[0].profitLoss = 50;
  bettings.bets[0].result = 'WIN';

  bettings.bets[1].replayUrl = urls.earlierTie;
  bettings.bets[1].profitLoss = -10.1;
  bettings.bets[1].result = 'LOSS';
  bettings.bets[2].replayUrl = urls.earlierTie;
  bettings.bets[2].profitLoss = -10.2; // exact cents total = -20.30
  bettings.bets[2].result = 'LOSS';

  bettings.bets[3].replayUrl = urls.laterTie;
  bettings.bets[3].profitLoss = -20.3; // exact cents total = -20.30
  bettings.bets[3].result = 'LOSS';

  const plan = buildDeterministicScenePlan(bettings);
  assert.deepStrictEqual(
    replaySequences(plan.scenes),
    [1, 4],
    'Equal monetary importance must tie exactly in cents and prefer the later replay group at the cutoff'
  );
}

// Multiple bets sharing the exact replay URL must never schedule the video twice.
{
  const bettings = readJson('bettings-8.json');
  const shared = 'https://example.com/shared-replay.mp4';
  bettings.bets.forEach(bet => { bet.replayUrl = null; });
  bettings.bets[0].replayUrl = shared;
  bettings.bets[0].profitLoss = 15;
  bettings.bets[1].replayUrl = shared;
  bettings.bets[1].profitLoss = 11;

  const plan = buildDeterministicScenePlan(bettings);
  const selected = replaySequences(plan.scenes);
  assert.strictEqual(selected.length, 1, 'One unique replay URL must produce at most one Scene 3');
  assert.strictEqual(
    bettings.bets[selected[0] - 1].replayUrl,
    shared,
    'Selected Scene 3 must reference the shared replay URL'
  );
}


// Consecutive bets on the same runner in the same race are protected as one Scene 5
// only when that group owns a selected replay. The replay then follows exactly once.
{
  const bettings = readJson('bettings-8.json');
  const first = bettings.bets[0];
  const second = bettings.bets[1];
  second.raceId = first.raceId;
  second.raceName = first.raceName;
  second.meeting = first.meeting;
  second.state = first.state;
  second.raceNumber = first.raceNumber;
  second.raceTime = first.raceTime;
  second.runnerId = first.runnerId;
  second.runnerNumber = first.runnerNumber;
  second.runnerName = first.runnerName;
  second.betType = 'PLACE';

  const shared = 'https://example.com/verzain-race.mp4';
  bettings.bets.forEach(bet => { bet.replayUrl = null; });
  first.replayUrl = shared;
  second.replayUrl = shared;

  const plan = buildDeterministicScenePlan(bettings);
  const groupedIndex = plan.scenes.findIndex(scene =>
    scene.sceneType === 5 &&
    JSON.stringify(scene.betSequences) === JSON.stringify([1, 2])
  );

  assert.ok(groupedIndex >= 0, 'Same race/runner consecutive wagers must share one Scene 5');
  assert.strictEqual(
    plan.scenes.some(scene => scene.sceneType === 2 && [1, 2].includes(scene.betSequence)),
    false,
    'Protected same race/runner wagers must not split into Scene 2'
  );
  assert.strictEqual(plan.scenes[groupedIndex + 1].sceneType, 3, 'Replay must immediately follow grouped Scene 5');
  assert.ok([1, 2].includes(plan.scenes[groupedIndex + 1].betSequence));
  assert.strictEqual(
    bettings.bets[plan.scenes[groupedIndex + 1].betSequence - 1].replayUrl,
    shared
  );
}

// Same-runner/race wagers without a selected replay are not protected and may compact into Scene 8.
{
  const bettings = readJson('bettings-32.json');
  const first = bettings.bets[0];
  const second = bettings.bets[1];

  second.raceId = first.raceId;
  second.raceName = first.raceName;
  second.meeting = first.meeting;
  second.state = first.state;
  second.raceNumber = first.raceNumber;
  second.raceTime = first.raceTime;
  second.runnerId = first.runnerId;
  second.runnerNumber = first.runnerNumber;
  second.runnerName = first.runnerName;
  second.betType = 'PLACE';

  bettings.bets.forEach(bet => { bet.replayUrl = null; });
  bettings.bets[9].replayUrl = 'https://example.com/replay-10.mp4';
  bettings.bets[9].result = 'WIN';
  bettings.bets[19].replayUrl = 'https://example.com/replay-20.mp4';
  bettings.bets[19].result = 'WIN';

  const plan = buildDeterministicScenePlan(bettings);

  assert.strictEqual(
    plan.scenes.some(scene =>
      scene.sceneType === 5 &&
      scene.betSequences[0] === 1 &&
      scene.betSequences.includes(2)
    ),
    false,
    'Same-runner/race wagers without a selected replay must not be protected as Scene 5'
  );

  assert.ok(
    plan.scenes.some(scene =>
      scene.sceneType === 8 &&
      scene.betSequences.includes(1) &&
      scene.betSequences.includes(2)
    ),
    'Unprotected same-runner/race wagers should be eligible for Scene 8 compression'
  );
}

// Same race with different runners must not activate protected grouping.
{
  const bettings = readJson('bettings-8.json');
  const first = bettings.bets[0];
  const second = bettings.bets[1];
  second.raceId = first.raceId;
  second.raceName = first.raceName;
  second.meeting = first.meeting;
  second.state = first.state;
  second.raceNumber = first.raceNumber;
  second.raceTime = first.raceTime;

  bettings.bets.forEach(bet => { bet.replayUrl = null; });
  first.replayUrl = 'https://example.com/race-runner-a.mp4';
  second.replayUrl = 'https://example.com/race-runner-b.mp4';
  first.profitLoss = 100;
  second.profitLoss = 90;

  const plan = buildDeterministicScenePlan(bettings);
  assert.strictEqual(
    plan.scenes.some(scene =>
      scene.sceneType === 5 &&
      scene.betSequences[0] === 1 &&
      scene.betSequences.includes(2)
    ),
    false,
    'Different runners in the same race must not be protected as one Scene 5'
  );
}

// Same runner identity in different races must not activate protected grouping.
{
  const bettings = readJson('bettings-8.json');
  const first = bettings.bets[0];
  const second = bettings.bets[1];
  second.runnerId = first.runnerId;
  second.runnerNumber = first.runnerNumber;
  second.runnerName = first.runnerName;

  bettings.bets.forEach(bet => { bet.replayUrl = null; });
  first.replayUrl = 'https://example.com/runner-race-a.mp4';
  second.replayUrl = 'https://example.com/runner-race-b.mp4';
  first.profitLoss = 100;
  second.profitLoss = 90;

  const plan = buildDeterministicScenePlan(bettings);
  assert.strictEqual(
    plan.scenes.some(scene =>
      scene.sceneType === 5 &&
      scene.betSequences[0] === 1 &&
      scene.betSequences.includes(2)
    ),
    false,
    'Same runner in different races must not be protected as one Scene 5'
  );
}

console.log('Deterministic scene planner regression tests passed.');
