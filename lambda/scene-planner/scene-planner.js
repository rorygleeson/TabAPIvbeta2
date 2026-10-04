'use strict';

const defaultPolicy = require('./planner-policy');
const { loadContract } = require('./contract-loader');
const runtimeContract = loadContract('runtime-contract.json');

function buildDeterministicScenePlan(bettings, options = {}) {
  const policy = options.policy || defaultPolicy;
  const runtime = options.runtimeContract || runtimeContract;

  validatePlannerInput(bettings, policy);

  const facts = derivePlannerFacts(bettings, policy);
  const targetDurationSeconds = calculateTargetDurationSeconds(
    facts.totalBets,
    policy.duration.targets
  );

  const desiredReplayCount = calculateDesiredReplayCount(facts.totalBets, policy.replay);
  const eligibleReplayGroups = buildReplayGroups(facts.bets)
    .sort((a, b) => {
      const aWin = a.representative.result === 'WIN' ? 1 : 0;
      const bWin = b.representative.result === 'WIN' ? 1 : 0;
      return bWin - aWin ||
        b.importanceCents - a.importanceCents ||
        b.latestSequence - a.latestSequence;
    });

  const maximumReplayCount = Math.min(
    desiredReplayCount,
    eligibleReplayGroups.length,
    policy.replay.maxCount
  );
  const minimumReplayCount = calculateMinimumRequiredReplayCount(
    facts.totalBets,
    eligibleReplayGroups.length,
    maximumReplayCount,
    policy.replay
  );

  for (let replayCount = maximumReplayCount; replayCount >= minimumReplayCount; replayCount -= 1) {
    const replaySequences = new Set(
      eligibleReplayGroups.slice(0, replayCount).map(group => group.representative.sequence)
    );

    const maxExtraScene2 = calculateExtraScene2Allowance(
      facts.totalBets,
      policy.feature.extraScene2ByBets
    );

    let bestCandidate = null;

    for (let extraScene2Count = 0; extraScene2Count <= maxExtraScene2; extraScene2Count += 1) {
      const featuredSequences = selectFeaturedSequences(
        facts,
        policy,
        replaySequences,
        replaySequences.size + extraScene2Count
      );

      const scenes = buildScenes(facts, policy, featuredSequences, replaySequences);
      const duration = calculatePlanDurationSeconds(scenes, runtime);
      const candidate = {
        scenes,
        plannedSeconds: duration.plannedSeconds,
        conservativeSeconds: duration.conservativeSeconds,
        distanceFromTarget: Math.abs(duration.plannedSeconds - targetDurationSeconds)
      };

      if (candidate.plannedSeconds > runtime.durationPolicy.hardMaxSeconds) {
        continue;
      }

      if (!bestCandidate || isBetterCandidate(candidate, bestCandidate)) {
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      validateDeterministicPlan(bestCandidate.scenes, facts, replaySequences);
      return {
        artifactType: 'deterministicScenePlan',
        artifactVersion: '1.0',
        scenes: bestCandidate.scenes
      };
    }
  }

  throw new Error('Unable to build a valid deterministic scene plan within the runtime hard maximum.');
}

function validatePlannerInput(bettings, policy) {
  if (!bettings || typeof bettings !== 'object') {
    throw new TypeError('bettings must be an object.');
  }

  if (!Array.isArray(bettings.bets) || bettings.bets.length === 0) {
    throw new TypeError('bettings.bets must be a non-empty array.');
  }

  bettings.bets.forEach((bet, index) => {
    const expectedSequence = index + 1;
    if (!bet || bet.sequence !== expectedSequence) {
      throw new Error(
        `bettings.bets must be contiguous and chronological; expected sequence ${expectedSequence}.`
      );
    }
  });

  if (!policy || !policy.duration || !Array.isArray(policy.duration.targets)) {
    throw new TypeError('planner policy duration.targets is required.');
  }

  if (!policy.replay || !Array.isArray(policy.replay.minimumByBets)) {
    throw new TypeError('planner policy replay.minimumByBets is required.');
  }

  if (!policy.feature || !Array.isArray(policy.feature.extraScene2ByBets)) {
    throw new TypeError('planner policy feature.extraScene2ByBets is required.');
  }

  if (!policy.scene8 || !Number.isInteger(policy.scene8.minTotalBets) || policy.scene8.minTotalBets < 1) {
    throw new TypeError('planner policy scene8.minTotalBets must be a positive integer.');
  }

  if (!Array.isArray(policy.replay.minimumRequiredByBets)) {
    throw new TypeError('planner policy replay.minimumRequiredByBets is required.');
  }
}

function derivePlannerFacts(bettings, policy) {
  const bets = bettings.bets;
  return {
    totalBets: bets.length,
    bets,
    summary: bettings.summary || {},
    policy
  };
}

function calculateTargetDurationSeconds(totalBets, targets) {
  if (!Number.isInteger(totalBets) || totalBets < 1) {
    throw new TypeError('totalBets must be a positive integer.');
  }

  if (!Array.isArray(targets) || targets.length === 0) {
    throw new TypeError('duration targets must be a non-empty array.');
  }

  const points = targets
    .map(point => ({ bets: Number(point.bets), seconds: Number(point.seconds) }))
    .sort((a, b) => a.bets - b.bets);

  if (points.some(point => !Number.isFinite(point.bets) || !Number.isFinite(point.seconds))) {
    throw new TypeError('duration target points must contain numeric bets and seconds.');
  }

  if (totalBets <= points[0].bets) return points[0].seconds;
  if (totalBets >= points[points.length - 1].bets) return points[points.length - 1].seconds;

  for (let i = 1; i < points.length; i += 1) {
    const upper = points[i];
    if (totalBets > upper.bets) continue;

    const lower = points[i - 1];
    const ratio = (totalBets - lower.bets) / (upper.bets - lower.bets);
    return Math.round(lower.seconds + ratio * (upper.seconds - lower.seconds));
  }

  throw new Error('Unable to interpolate target duration.');
}

function calculateDesiredReplayCount(totalBets, replayPolicy) {
  if (!replayPolicy.enabled) return 0;

  const rule = replayPolicy.minimumByBets.find(item =>
    item.maxBets === null || totalBets <= item.maxBets
  );

  return rule ? Math.min(rule.minCount, replayPolicy.maxCount) : 0;
}

function calculateMinimumRequiredReplayCount(totalBets, eligibleCount, maximumReplayCount, replayPolicy) {
  const rule = replayPolicy.minimumRequiredByBets.find(item =>
    item.maxBets === null || totalBets <= item.maxBets
  );
  const requestedMinimum = rule ? Math.max(0, Number(rule.minCount) || 0) : 0;
  return Math.min(requestedMinimum, eligibleCount, maximumReplayCount);
}

function calculateExtraScene2Allowance(totalBets, rules) {
  const rule = rules.find(item => item.maxBets === null || totalBets <= item.maxBets);
  return rule ? Math.max(0, Number(rule.maxExtra) || 0) : 0;
}

function isReplayEligible(bet) {
  return isHttpsUrl(bet.replayUrl);
}

function buildReplayGroups(bets) {
  const groupsByUrl = new Map();

  for (const bet of bets) {
    if (!isReplayEligible(bet)) continue;

    let group = groupsByUrl.get(bet.replayUrl);
    if (!group) {
      group = {
        replayUrl: bet.replayUrl,
        bets: [],
        raceNetPnlCents: 0,
        importanceCents: 0,
        latestSequence: bet.sequence,
        representative: bet
      };
      groupsByUrl.set(bet.replayUrl, group);
    }

    group.bets.push(bet);
    group.raceNetPnlCents += moneyToCents(bet.profitLoss);
    group.latestSequence = Math.max(group.latestSequence, bet.sequence);

    const currentAbs = Math.abs(moneyToCents(group.representative.profitLoss));
    const candidateAbs = Math.abs(moneyToCents(bet.profitLoss));
    if (candidateAbs > currentAbs ||
        (candidateAbs === currentAbs && bet.sequence > group.representative.sequence)) {
      group.representative = bet;
    }
  }

  for (const group of groupsByUrl.values()) {
    group.importanceCents = Math.abs(group.raceNetPnlCents);
  }

  return [...groupsByUrl.values()];
}

function moneyToCents(value) {
  return Math.round(Number(value) * 100);
}

function isHttpsUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function normalizedIdentityPart(value) {
  return String(value ?? '').trim().toUpperCase();
}

function sameRaceAndRunner(a, b) {
  const sameRace = a.raceId && b.raceId
    ? a.raceId === b.raceId
    : normalizedIdentityPart(a.meeting) === normalizedIdentityPart(b.meeting) &&
      Number(a.raceNumber) === Number(b.raceNumber);

  if (!sameRace) return false;

  return a.runnerId && b.runnerId
    ? a.runnerId === b.runnerId
    : Number(a.runnerNumber) === Number(b.runnerNumber) &&
      normalizedIdentityPart(a.runnerName) === normalizedIdentityPart(b.runnerName);
}

function buildProtectedSameRunnerRaceGroups(bets) {
  const groupsByStart = new Map();
  let index = 0;

  while (index < bets.length) {
    let end = index + 1;
    while (end < bets.length && sameRaceAndRunner(bets[index], bets[end])) {
      end += 1;
    }

    const size = end - index;
    if (size === 2 || size === 3) {
      const sequences = bets.slice(index, end).map(bet => bet.sequence);
      groupsByStart.set(sequences[0], sequences);
    }

    index = end;
  }

  return groupsByStart;
}

function scoreBet(bet, facts, policy) {
  const weights = policy.scoring;
  const previousPnl = bet.sequence === 1 ? 0 : facts.bets[bet.sequence - 2].runningPnl;
  let score = 0;

  if (bet.sequence === facts.summary.biggestWinSequence) score += weights.biggestWin;
  if (bet.sequence === facts.summary.biggestLossSequence) score += weights.biggestLoss;
  if (bet.sequence === facts.summary.highestOddsWinnerSequence) score += weights.highestOddsWinner;
  if (previousPnl <= 0 && bet.runningPnl > 0) score += weights.pnlCrossesIntoProfit;
  if (previousPnl >= 0 && bet.runningPnl < 0) score += weights.pnlCrossesIntoLoss;
  if (bet.profitLoss > 0) score += weights.positivePnlSwing;
  if (bet.profitLoss < 0) score += weights.negativePnlSwing;
  if (bet.result === 'WIN') score += weights.win;
  if (isHttpsUrl(bet.replayUrl)) score += weights.replayAvailable;
  if (bet.sequence === 1) score += weights.firstBet;
  if (bet.sequence === facts.totalBets) score += weights.lastBet;

  return score;
}

function selectFeaturedSequences(facts, policy, requiredSequences, targetCount) {
  const selected = new Set(requiredSequences);
  const ranked = facts.bets
    .slice()
    .sort((a, b) => scoreBet(b, facts, policy) - scoreBet(a, facts, policy) || a.sequence - b.sequence);

  for (const bet of ranked) {
    if (selected.size >= targetCount) break;
    selected.add(bet.sequence);
  }

  return selected;
}

function buildScenes(facts, policy, featuredSequences, replaySequences) {
  const primaryScenes = [];
  const protectedGroups = buildProtectedSameRunnerRaceGroups(facts.bets);
  let sequence = 1;

  while (sequence <= facts.totalBets) {
    const protectedGroup = protectedGroups.get(sequence);
    if (protectedGroup) {
      primaryScenes.push({ sceneType: 5, betSequences: protectedGroup });
      sequence += protectedGroup.length;
      continue;
    }

    if (featuredSequences.has(sequence)) {
      primaryScenes.push({ sceneType: 2, betSequence: sequence });
      sequence += 1;
      continue;
    }

    const gap = [];
    while (
      sequence <= facts.totalBets &&
      !featuredSequences.has(sequence) &&
      !protectedGroups.has(sequence)
    ) {
      gap.push(sequence);
      sequence += 1;
    }

    primaryScenes.push(...groupGap(gap, facts.totalBets >= policy.scene8.minTotalBets));
  }

  const midpointAfter = calculateMidpointBoundary(primaryScenes, facts.totalBets, policy.midpoint);
  const scenes = [{ sceneType: 1 }];

  for (const primaryScene of primaryScenes) {
    scenes.push(primaryScene);

    const replaySequence = replaySequenceForPrimaryScene(primaryScene, replaySequences);
    if (replaySequence !== null) {
      scenes.push({ sceneType: 3, betSequence: replaySequence });
    }

    const completedSequence = lastCoveredSequence(primaryScene);
    if (midpointAfter !== null && completedSequence === midpointAfter) {
      scenes.push({ sceneType: 4, checkpointAfterBetSequence: midpointAfter });
    }
  }

  scenes.push({ sceneType: 6 });
  scenes.push({ sceneType: 7 });
  return scenes;
}

function replaySequenceForPrimaryScene(scene, replaySequences) {
  if (scene.sceneType === 2) {
    return replaySequences.has(scene.betSequence) ? scene.betSequence : null;
  }

  if (scene.sceneType === 5) {
    const matches = scene.betSequences.filter(sequence => replaySequences.has(sequence));
    if (matches.length > 1) {
      throw new Error('A Scene 5 group may contain at most one selected replay representative.');
    }
    return matches[0] ?? null;
  }

  return null;
}

function replayAttachedToPreviousPrimary(previous, replaySequence) {
  if (!previous) return false;
  if (previous.sceneType === 2) return previous.betSequence === replaySequence;
  if (previous.sceneType === 5) return previous.betSequences.includes(replaySequence);
  return false;
}

function groupGap(sequences, allowScene8) {
  const scenes = [];
  let index = 0;
  let remaining = sequences.length;

  while (remaining > 0) {
    let size;

    if (!allowScene8) {
      if (remaining === 1) size = 1;
      else if (remaining === 2) size = 2;
      else if (remaining === 4) size = 2;
      else size = 3;
    } else if (remaining === 1) size = 1;
    else if (remaining === 2 || remaining === 3) size = remaining;
    else if (remaining === 4 || remaining === 5) size = remaining;
    else {
      const remainderAfterFive = remaining - 5;
      size = remainderAfterFive === 1 ? 4 : 5;
    }

    const chunk = sequences.slice(index, index + size);
    if (size === 1) scenes.push({ sceneType: 2, betSequence: chunk[0] });
    else if (size <= 3) scenes.push({ sceneType: 5, betSequences: chunk });
    else scenes.push({ sceneType: 8, betSequences: chunk });

    index += size;
    remaining -= size;
  }

  return scenes;
}

function calculateMidpointBoundary(primaryScenes, totalBets, midpointPolicy) {
  if (!midpointPolicy.enabled || totalBets < midpointPolicy.minBets) return null;

  let bestSequence = null;
  let bestDistance = Infinity;

  for (const scene of primaryScenes) {
    const completed = lastCoveredSequence(scene);
    if (completed >= totalBets) continue;

    const distance = Math.abs(completed / totalBets - midpointPolicy.targetCoverageRatio);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSequence = completed;
    }
  }

  return bestSequence;
}

function lastCoveredSequence(scene) {
  return scene.sceneType === 2
    ? scene.betSequence
    : scene.betSequences[scene.betSequences.length - 1];
}

function calculatePlanDurationSeconds(scenes, runtime) {
  let plannedMs = 0;
  let conservativeMs = 0;

  for (const scene of scenes) {
    if (scene.sceneType === 7) continue;

    let plannedSceneMs = 0;
    let conservativeSceneMs = 0;

    if (scene.sceneType === 1) plannedSceneMs = runtime.timeline.scene1.durationMs;
    if (scene.sceneType === 2) plannedSceneMs = runtime.timeline.scene2.durationMs;
    if (scene.sceneType === 4) plannedSceneMs = runtime.timeline.scene4.durationMs;
    if (scene.sceneType === 5) {
      plannedSceneMs = runtime.timeline.scene5.durationMsByRaceCount[String(scene.betSequences.length)];
    }
    if (scene.sceneType === 6) plannedSceneMs = runtime.timeline.scene6.durationMs;
    if (scene.sceneType === 8) {
      plannedSceneMs = runtime.timeline.scene8.durationMsByBetCount[String(scene.betSequences.length)];
    }
    if (scene.sceneType === 3) {
      plannedSceneMs = runtime.timeline.scene3.plannedPlaybackMs + runtime.timeline.scene3.exitFadeMs;
      conservativeSceneMs = plannedSceneMs +
        runtime.timeline.scene3.metadataTimeoutMs +
        runtime.timeline.scene3.playTimeoutMs;
    }

    if (!conservativeSceneMs) conservativeSceneMs = plannedSceneMs;
    plannedMs += plannedSceneMs;
    conservativeMs += conservativeSceneMs;
  }

  const transitionMs = runtime.shell.sceneTransition.durationMs * Math.max(0, scenes.length - 1);
  plannedMs += transitionMs;
  conservativeMs += transitionMs;

  return {
    plannedSeconds: plannedMs / 1000,
    conservativeSeconds: conservativeMs / 1000
  };
}

function isBetterCandidate(candidate, currentBest) {
  if (candidate.distanceFromTarget !== currentBest.distanceFromTarget) {
    return candidate.distanceFromTarget < currentBest.distanceFromTarget;
  }
  if (candidate.plannedSeconds !== currentBest.plannedSeconds) {
    return candidate.plannedSeconds < currentBest.plannedSeconds;
  }
  return candidate.scenes.length < currentBest.scenes.length;
}

function validateDeterministicPlan(scenes, facts, replaySequences) {
  if (scenes[0].sceneType !== 1) throw new Error('Scene 1 must be first.');
  if (scenes[scenes.length - 2].sceneType !== 6) throw new Error('Scene 6 must be second-last.');
  if (scenes[scenes.length - 1].sceneType !== 7) throw new Error('Scene 7 must be last.');

  const covered = [];
  const seenReplaySequences = new Set();
  const seenReplayUrls = new Set();

  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (scene.sceneType === 2) covered.push(scene.betSequence);
    if (scene.sceneType === 5 || scene.sceneType === 8) covered.push(...scene.betSequences);

    if (scene.sceneType === 3) {
      const previous = scenes[index - 1];
      if (!replayAttachedToPreviousPrimary(previous, scene.betSequence)) {
        throw new Error(
          `Scene 3 for bet ${scene.betSequence} must immediately follow the Scene 2 or Scene 5 containing that bet.`
        );
      }
      const bet = facts.bets[scene.betSequence - 1];
      if (!isReplayEligible(bet)) {
        throw new Error(`Scene 3 bet ${scene.betSequence} is not replay eligible.`);
      }
      if (seenReplayUrls.has(bet.replayUrl)) {
        throw new Error(`Replay URL ${bet.replayUrl} may appear at most once.`);
      }
      seenReplayUrls.add(bet.replayUrl);
      seenReplaySequences.add(scene.betSequence);
    }
  }

  const expected = facts.bets.map(bet => bet.sequence);
  if (covered.length !== expected.length || covered.some((value, index) => value !== expected[index])) {
    throw new Error('Primary bet coverage must be exact, chronological and one-time.');
  }

  if (seenReplaySequences.size !== replaySequences.size ||
      [...replaySequences].some(sequence => !seenReplaySequences.has(sequence))) {
    throw new Error('Selected replay coverage does not match emitted Scene 3 scenes.');
  }
}

module.exports = {
  buildDeterministicScenePlan,
  calculateTargetDurationSeconds,
  calculateDesiredReplayCount,
  calculateMinimumRequiredReplayCount,
  calculateExtraScene2Allowance
};
