'use strict';

const { loadContract } = require('./contract-loader');
const sceneContracts = loadContract('scene-contracts.json');

const FIELD_PHASES = {
  1: { openingTeaser: 'PRE_RESULT_DAY' },
  2: { tensionLine: 'PRE_RESULT', reactionLine: 'POST_RESULT' },
  3: { replayLabel: 'POST_RESULT', replayComments: 'POST_RESULT' },
  4: { lookingBackStory: 'POST_COMPLETED_BETS', lookingAheadTeaser: 'PRE_FUTURE_RESULTS' },
  5: { setupKicker: 'PRE_RESULT_BLOCK', setupHeadline: 'PRE_RESULT_BLOCK', payoffHeadline: 'POST_RESULT_BLOCK', contextLine: 'POST_RESULT_BLOCK' },
  6: { dayVerdict: 'POST_DAY', standoutHighlightType: 'POST_DAY', standoutCopy: 'POST_DAY' },
  7: { selectedFinalHighlights: 'POST_DAY', finalSummary: 'POST_DAY', shareCaption: 'POST_DAY' },
  8: { headline: 'PRE_RESULT_BLOCK', headlineCategory: 'PRE_RESULT_BLOCK', comments: 'POST_RESULT_BY_BET' }
};

function buildLlmCopyInput(bettings, deterministicPlan, contracts = sceneContracts) {
  validateInputs(bettings, deterministicPlan, contracts);
  return {
    copyInputVersion: '1.0',
    contractVersion: contracts.contractVersion,
    scenes: deterministicPlan.scenes.map((scene, sceneIndex) =>
      buildSceneCopyInput(scene, sceneIndex, bettings, contracts)
    )
  };
}

function validateInputs(bettings, deterministicPlan, contracts) {
  if (!bettings || !Array.isArray(bettings.bets) || bettings.bets.length === 0) {
    throw new TypeError('bettings.bets must be a non-empty array.');
  }
  if (!deterministicPlan || deterministicPlan.artifactType !== 'deterministicScenePlan' ||
      !Array.isArray(deterministicPlan.scenes)) {
    throw new TypeError('deterministicPlan must be a deterministicScenePlan.');
  }
  if (!contracts || !contracts.scenes) {
    throw new TypeError('sceneContracts.scenes is required.');
  }
}

function buildSceneCopyInput(scene, sceneIndex, bettings, contracts) {
  const item = {
    sceneIndex,
    sceneType: scene.sceneType,
    requiredFields: requiredLlmFields(scene.sceneType, contracts)
  };

  if (scene.betSequence !== undefined) item.betSequence = scene.betSequence;
  if (scene.betSequences !== undefined) item.betSequences = [...scene.betSequences];
  if (scene.checkpointAfterBetSequence !== undefined) {
    item.checkpointAfterBetSequence = scene.checkpointAfterBetSequence;
  }

  item.context = buildSceneContext(scene, bettings);
  return item;
}

function requiredLlmFields(sceneType, contracts) {
  const fields = contracts.scenes[String(sceneType)]?.fields || {};
  const phases = FIELD_PHASES[sceneType] || {};
  const required = {};

  for (const [name, definition] of Object.entries(fields)) {
    if (!definition || typeof definition !== 'object' || definition.source !== 'LLM') continue;
    const rule = { phase: phases[name] || 'UNSPECIFIED' };
    for (const key of ['maxWords','maxChars','minItems','maxItems','itemMaxWords','itemMaxChars','freshGenerationRequired']) {
      if (definition[key] !== undefined) rule[key] = definition[key];
    }
    if (Array.isArray(definition.enum)) rule.enum = [...definition.enum];
    required[name] = rule;
  }
  return required;
}

function buildSceneContext(scene, bettings) {
  switch (scene.sceneType) {
    case 1: return scene1Context(bettings);
    case 2: return scene2Context(bettings, scene.betSequence);
    case 3: return scene3Context(bettings, scene.betSequence);
    case 4: return scene4Context(bettings, scene.checkpointAfterBetSequence);
    case 5: return groupedContext(bettings, scene.betSequences, false);
    case 6: return scene6Context(bettings);
    case 7: return scene7Context(bettings);
    case 8: return groupedContext(bettings, scene.betSequences, true);
    default: throw new Error('Unsupported sceneType ' + scene.sceneType + '.');
  }
}

function scene1Context(bettings) {
  return {
    preResultDayFacts: {
      userName: bettings.user?.firstName ?? null,
      date: bettings.day?.date ?? null,
      totalBets: bettings.bets.length,
      totalStaked: bettings.summary?.totalStaked ?? sum(bettings.bets.map(bet => bet.stake)),
      meetings: unique(bettings.bets.map(bet => bet.meeting))
    }
  };
}

function scene2Context(bettings, sequence) {
  const bet = betBySequence(bettings, sequence);
  return {
    preResultFacts: preResultBetFacts(bet),
    postResultFacts: postResultBetFacts(bet, previousRunningPnl(bettings, sequence))
  };
}

function scene3Context(bettings, sequence) {
  const bet = betBySequence(bettings, sequence);
  return {
    replayFacts: {
      runnerName: bet.runnerName,
      meeting: bet.meeting,
      raceNumber: bet.raceNumber,
      betType: bet.betType,
      stake: bet.stake,
      odds: bet.odds,
      result: bet.result,
      finishingPosition: bet.finishingPosition,
      profitLoss: bet.profitLoss
    }
  };
}

function scene4Context(bettings, checkpoint) {
  const completed = bettings.bets.filter(bet => bet.sequence <= checkpoint);
  const future = bettings.bets.filter(bet => bet.sequence > checkpoint);
  return {
    completedFacts: {
      betsCompleted: completed.length,
      totalBets: bettings.bets.length,
      winnersSoFar: completed.filter(bet => bet.result === 'WIN').length,
      currentRunningPnl: completed.length ? completed[completed.length - 1].runningPnl : 0,
      bestWinSoFar: compactBestWin(completed)
    },
    upcomingFacts: future.slice(0, 3).map(preResultBetFacts)
  };
}

function groupedContext(bettings, sequences, scene8) {
  const bets = sequences.map(sequence => betBySequence(bettings, sequence));
  const before = previousRunningPnl(bettings, sequences[0]);
  const preFacts = bets.map(preResultBetFacts);
  const postFacts = bets.map(bet => postResultBetFacts(bet, previousRunningPnl(bettings, bet.sequence)));

  if (scene8) {
    return {
      preResultBlockFacts: {
        runningPnlBeforeBlock: before,
        totalStake: sum(bets.map(bet => bet.stake)),
        bets: preFacts
      },
      postResultFactsByBet: postFacts
    };
  }

  return {
    preResultBlockFacts: {
      runningPnlBeforeBlock: before,
      bets: preFacts
    },
    postResultBlockFacts: {
      runningPnlAfterBlock: bets[bets.length - 1].runningPnl,
      bets: postFacts
    }
  };
}

function scene6Context(bettings) {
  return {
    daySummaryFacts: daySummaryFacts(bettings),
    standoutOptions: buildStandoutOptions(bettings)
  };
}

function scene7Context(bettings) {
  return {
    daySummaryFacts: daySummaryFacts(bettings),
    availableFinalHighlights: buildFinalHighlights(bettings)
  };
}

function preResultBetFacts(bet) {
  return {
    sequence: bet.sequence,
    runnerName: bet.runnerName,
    raceName: bet.raceName,
    meeting: bet.meeting,
    raceNumber: bet.raceNumber,
    betType: bet.betType,
    stake: bet.stake,
    odds: bet.odds
  };
}

function postResultBetFacts(bet, runningPnlBefore) {
  return {
    sequence: bet.sequence,
    runnerName: bet.runnerName,
    result: bet.result,
    finishingPosition: bet.finishingPosition,
    return: bet.return,
    profitLoss: bet.profitLoss,
    runningPnlBefore,
    runningPnlAfter: bet.runningPnl
  };
}

function daySummaryFacts(bettings) {
  const summary = bettings.summary || {};
  return {
    totalBets: bettings.bets.length,
    wins: summary.wins,
    losses: summary.losses,
    totalStaked: summary.totalStaked,
    totalReturned: summary.totalReturned,
    finalPnl: summary.finalPnl
  };
}

function buildStandoutOptions(bettings) {
  const bets = bettings.bets;
  const options = [];
  const biggestWin = sequenceBet(bettings, bettings.summary?.biggestWinSequence);
  if (biggestWin && biggestWin.profitLoss > 0) options.push({ type: 'biggestWin', facts: highlightBetFacts(biggestWin) });
  const highestOddsWinner = sequenceBet(bettings, bettings.summary?.highestOddsWinnerSequence);
  if (highestOddsWinner) options.push({ type: 'highestOddsWinner', facts: highlightBetFacts(highestOddsWinner) });
  const biggestRecovery = bets.filter(bet => bet.profitLoss > 0)
    .reduce((best, bet) => !best || bet.profitLoss > best.profitLoss ? bet : best, null);
  if (biggestRecovery) options.push({ type: 'biggestRecovery', facts: highlightBetFacts(biggestRecovery) });
  const streak = longestLosingStreak(bets);
  if (streak) options.push({ type: 'longestLosingStreak', facts: streak });
  options.push({ type: 'strongestFinish', facts: strongestFinish(bets) });
  options.push({ type: 'totalReturned', facts: { totalReturned: bettings.summary?.totalReturned } });
  return options;
}

function buildFinalHighlights(bettings) {
  const summary = bettings.summary || {};
  const highlights = [
    { type: 'totalBets', facts: { totalBets: bettings.bets.length } },
    { type: 'wins', facts: { wins: summary.wins } },
    { type: 'losses', facts: { losses: summary.losses } },
    { type: 'totalStaked', facts: { totalStaked: summary.totalStaked } },
    { type: 'totalReturned', facts: { totalReturned: summary.totalReturned } },
    { type: 'finalPnl', facts: { finalPnl: summary.finalPnl } }
  ];
  const biggestWin = sequenceBet(bettings, summary.biggestWinSequence);
  if (biggestWin && biggestWin.profitLoss > 0) highlights.push({ type: 'biggestWin', facts: highlightBetFacts(biggestWin) });
  const highestOddsWinner = sequenceBet(bettings, summary.highestOddsWinnerSequence);
  if (highestOddsWinner) highlights.push({ type: 'highestOddsWinner', facts: highlightBetFacts(highestOddsWinner) });
  return highlights;
}

function highlightBetFacts(bet) {
  return {
    sequence: bet.sequence,
    runnerName: bet.runnerName,
    meeting: bet.meeting,
    raceNumber: bet.raceNumber,
    odds: bet.odds,
    profitLoss: bet.profitLoss
  };
}

function compactBestWin(bets) {
  const winner = bets.filter(bet => bet.result === 'WIN' && bet.profitLoss > 0)
    .reduce((best, bet) => !best || bet.profitLoss > best.profitLoss ? bet : best, null);
  return winner ? highlightBetFacts(winner) : null;
}

function longestLosingStreak(bets) {
  let best = null;
  let current = [];
  for (const bet of bets) {
    if (bet.result === 'LOSS') {
      current.push(bet);
      if (!best || current.length > best.length) best = [...current];
    } else current = [];
  }
  return best ? { length: best.length, startSequence: best[0].sequence, endSequence: best[best.length - 1].sequence } : null;
}

function strongestFinish(bets) {
  let running = 0;
  let bestGain = -Infinity;
  let bestStart = bets.length - 1;
  for (let i = bets.length - 1; i >= 0; i -= 1) {
    running += Number(bets[i].profitLoss);
    if (running > bestGain || (running === bestGain && i > bestStart)) {
      bestGain = running;
      bestStart = i;
    }
  }
  return { startSequence: bets[bestStart].sequence, endSequence: bets[bets.length - 1].sequence, netGain: bestGain };
}

function previousRunningPnl(bettings, sequence) {
  return sequence <= 1 ? 0 : bettings.bets[sequence - 2].runningPnl;
}

function betBySequence(bettings, sequence) {
  const bet = bettings.bets[sequence - 1];
  if (!bet || bet.sequence !== sequence) throw new Error('Missing bet sequence ' + sequence + '.');
  return bet;
}

function sequenceBet(bettings, sequence) {
  return Number.isInteger(sequence) ? betBySequence(bettings, sequence) : null;
}

function unique(values) {
  return [...new Set(values)];
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

module.exports = { buildLlmCopyInput, requiredLlmFields };
