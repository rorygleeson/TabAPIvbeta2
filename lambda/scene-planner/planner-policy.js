'use strict';

/**
 * Deterministic scene planner tuning policy.
 *
 * This file contains editorial/tuning choices only.
 * It must NOT duplicate physical scene timings or structural scene capacities;
 * those remain authoritative in the existing runtime/scene contracts.
 *
 * Values below are initial tuning values for planner development and will be
 * validated against representative 1 / 5 / 16 / 32 / 75 bet fixtures.
 */
module.exports = {
  duration: {
    // Acceptable deviation either side of the interpolated target duration.
    toleranceSeconds: 12,

    // Editorial duration curve. The planner interpolates between these points.
    targets: [
      { bets: 1, seconds: 60 },
      { bets: 5, seconds: 80 },
      { bets: 10, seconds: 105 },
      { bets: 20, seconds: 145 },
      { bets: 40, seconds: 195 },
      { bets: 60, seconds: 240 },
      { bets: 75, seconds: 285 }
    ]
  },

  midpoint: {
    // Scene 4 is omitted for very small recaps.
    enabled: true,
    minBets: 6,

    // Planner places Scene 4 at the legal primary-scene boundary nearest this ratio.
    targetCoverageRatio: 0.5
  },

  replay: {
    enabled: true,

    // Bet volume sets the desired replay count. Unique valid HTTPS replay
    // videos cap what can actually be selected; WIN and LOSS bets are eligible.
    minimumByBets: [
      { maxBets: 5, minCount: 1 },
      { maxBets: 40, minCount: 2 },
      { maxBets: null, minCount: 3 }
    ],

    // Absolute editorial ceiling for Scene 3 replay moments in one recap.
    maxCount: 3,

    // Minimum replay floor after eligibility is known. Large days should retain
    // enough actual race footage to keep the recap feeling like racing content.
    minimumRequiredByBets: [
      { maxBets: 40, minCount: 0 },
      { maxBets: null, minCount: 3 }
    ]
  },

  scene8: {
    // Scene 8 is a high-volume compression treatment. Smaller recaps remain
    // richer by using Scene 2 and Scene 5 only.
    minTotalBets: 17
  },

  feature: {
    // Replay-backed Scene 2s are mandatory. This table limits only additional
    // non-replay Scene 2 moments selected for editorial importance.
    extraScene2ByBets: [
      { maxBets: 10, maxExtra: 4 },
      { maxBets: 20, maxExtra: 3 },
      { maxBets: 40, maxExtra: 0 },
      { maxBets: null, maxExtra: 1 }
    ]
  },

  scoring: {
    // Initial attention weights. These influence presentation richness only.
    // They never alter factual bet data, chronology or P&L.
    biggestWin: 30,
    biggestLoss: 22,
    highestOddsWinner: 20,
    pnlCrossesIntoProfit: 25,
    pnlCrossesIntoLoss: 18,
    positivePnlSwing: 15,
    negativePnlSwing: 12,
    win: 8,
    replayAvailable: 4,
    firstBet: 3,
    lastBet: 5
  },

  compression: {
    // Ordered preferences when a structurally valid plan is above the target band.
    order: [
      'REMOVE_LOWEST_VALUE_REPLAY',
      'SCENE2_TO_SCENE5',
      'SCENE5_TO_SCENE8',
      'PACK_SCENE8'
    ]
  },

  enrichment: {
    // Ordered preferences when a structurally valid plan is below the target band.
    order: [
      'ADD_BEST_REPLAY',
      'SCENE8_TO_SCENE5',
      'SCENE5_TO_SCENE2'
    ]
  }
};
