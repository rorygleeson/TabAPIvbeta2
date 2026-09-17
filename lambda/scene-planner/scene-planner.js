'use strict';

const defaultPolicy = require('./planner-policy');

/**
 * Build the deterministic structural scene plan.
 *
 * Final intended responsibility:
 * - consume canonical bettings.json
 * - derive deterministic planning facts
 * - calculate the target duration
 * - score bets for editorial attention
 * - allocate primary coverage across Scene 2 / 5 / 8
 * - attach eligible Scene 3 replays
 * - place optional Scene 4 midpoint
 * - validate exact coverage, chronology and duration
 * - return the slim deterministicScenePlan artifact
 *
 * No LLM copy generation belongs in this function.
 */
function buildDeterministicScenePlan(bettings, options = {}) {
  const policy = options.policy || defaultPolicy;

  validatePlannerInput(bettings, policy);

  const facts = derivePlannerFacts(bettings);
  const targetDurationSeconds = calculateTargetDurationSeconds(
    facts.totalBets,
    policy.duration.targets
  );

  // Structural scene allocation is deliberately implemented in the next step.
  // Failing explicitly prevents this scaffold from producing a bogus artifact.
  throw new Error(
    `Deterministic scene allocation is not implemented yet. ` +
    `Input has ${facts.totalBets} bets; target duration is ${targetDurationSeconds}s.`
  );
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
}

function derivePlannerFacts(bettings) {
  return {
    totalBets: bettings.bets.length,
    bets: bettings.bets
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
    const interpolated = lower.seconds + ratio * (upper.seconds - lower.seconds);

    return Math.round(interpolated);
  }

  throw new Error('Unable to interpolate target duration.');
}

module.exports = {
  buildDeterministicScenePlan,
  calculateTargetDurationSeconds
};
