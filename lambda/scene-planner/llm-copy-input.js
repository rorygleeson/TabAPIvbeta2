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
  8: { headline: 'PRE_RESULT_BLOCK', headlineCategory: 'PRE_RESULT_BLOCK', comments: 'POST_RESULT_BY_BET', blockReaction: 'POST_RESULT_BLOCK' }
};

function buildLlmCopyInput(bettings, deterministicPlan, contracts = sceneContracts) {
  validateInputs(bettings, deterministicPlan, contracts);
  const factCatalog = buildGlobalFactCatalog(bettings);
  return {
    copyInputVersion: '4.0',
    contractVersion: contracts.contractVersion,
    groundingProtocol: 'FACT_SEMANTICS_V4_0',
    semanticPolicy: {
      raceActionEvidence: 'NONE',
      replayEvidence: 'RESULT_FACTS_ONLY',
      oddsClassificationEvidence: 'NONE'
    },
    factCatalog,
    protectedTerms: protectedTerms(bettings, bettings.bets),
    scenes: deterministicPlan.scenes.map((scene, sceneIndex) =>
      buildSceneCopyInput(scene, sceneIndex, bettings, contracts)
    )
  };
}

function buildLlmModelPayload(copyInput) {
  if (!copyInput || !Array.isArray(copyInput.scenes)) {
    throw new TypeError('copyInput.scenes must be an array.');
  }

  return {
    modelPayloadVersion: '1.0',
    groundingProtocol: 'FACT_SEMANTIC_TEMPLATE_V1',
    semanticPolicy: cloneJson(copyInput.semanticPolicy || {}),
    scenes: copyInput.scenes.map(scene => {
      const item = {
        sceneIndex: scene.sceneIndex,
        sceneType: scene.sceneType,
        requiredFields: compactRequiredFields(scene.requiredFields),
        context: {
          factAtomsByPhase: cloneJson(scene.context?.factAtomsByPhase || {})
        }
      };

      if (scene.context?.semanticContextByPhase &&
          Object.keys(scene.context.semanticContextByPhase).length > 0) {
        item.context.semanticContextByPhase = cloneJson(scene.context.semanticContextByPhase);
      }

      if (scene.betSequence !== undefined) item.betSequence = scene.betSequence;
      if (scene.betSequences !== undefined) item.betSequences = [...scene.betSequences];
      if (scene.checkpointAfterBetSequence !== undefined) {
        item.checkpointAfterBetSequence = scene.checkpointAfterBetSequence;
      }

      if (Array.isArray(scene.context?.standoutOptions)) {
        item.context.standoutOptions = scene.context.standoutOptions.map(option => ({ type: option.type }));
      }
      if (Array.isArray(scene.context?.availableFinalHighlights)) {
        item.context.availableFinalHighlights = scene.context.availableFinalHighlights.map(option => ({ type: option.type }));
      }

      return item;
    })
  };
}

function compactRequiredFields(requiredFields) {
  const compact = {};
  for (const [field, rule] of Object.entries(requiredFields || {})) {
    const out = {
      phase: rule.phase,
      responseType: rule.responseType
    };
    if (Array.isArray(rule.enum)) out.enum = [...rule.enum];
    if (rule.minItems !== undefined) out.minItems = rule.minItems;
    if (rule.maxItems !== undefined) out.maxItems = rule.maxItems;
    if (rule.maxWords !== undefined) out.maxWords = rule.maxWords;
    if (rule.itemMaxWords !== undefined) out.itemMaxWords = rule.itemMaxWords;
    compact[field] = out;
  }
  return compact;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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
  item.context.allowedGlobalFactIdsByPhase = buildAllowedGlobalFactIdsByPhase(scene, bettings);
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
    if (rule.enum) rule.responseType = 'enum';
    else if (definition.minItems !== undefined || definition.maxItems !== undefined) rule.responseType = 'groundedTextArray';
    else rule.responseType = 'groundedText';
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

function buildGlobalFactCatalog(bettings) {
  return mergeAtoms(
    postDayAtoms(bettings),
    ...bettings.bets.map(bet => mergeAtoms(preBetAtoms(bet), postBetAtoms(bet)))
  );
}

function buildAllowedGlobalFactIdsByPhase(scene, bettings) {
  const dayPreIds = Object.keys(preDayAtoms(bettings));
  const dayPostIds = Object.keys(postDayAtoms(bettings));
  const allPreIds = bettings.bets.flatMap(bet => Object.keys(preBetAtoms(bet)));

  const postIdsThrough = sequence => bettings.bets
    .filter(bet => bet.sequence <= sequence)
    .flatMap(bet => Object.keys(postBetAtoms(bet)));

  const chronologyScope = sequence => unique([
    ...dayPreIds,
    ...allPreIds,
    ...postIdsThrough(sequence)
  ]);

  const preDayScope = unique([...dayPreIds, ...allPreIds]);
  const postDayScope = unique([
    ...dayPostIds,
    ...allPreIds,
    ...postIdsThrough(bettings.bets.length)
  ]);

  switch (scene.sceneType) {
    case 1:
      return { PRE_RESULT_DAY: preDayScope };

    case 2:
      return {
        PRE_RESULT: chronologyScope(scene.betSequence - 1),
        POST_RESULT: chronologyScope(scene.betSequence)
      };

    case 3:
      return {
        POST_RESULT: chronologyScope(scene.betSequence)
      };

    case 4:
      return {
        POST_COMPLETED_BETS: chronologyScope(scene.checkpointAfterBetSequence),
        PRE_FUTURE_RESULTS: chronologyScope(scene.checkpointAfterBetSequence)
      };

    case 5: {
      const first = Math.min(...scene.betSequences);
      const priorCompletedScope = chronologyScope(first - 1);
      return {
        PRE_RESULT_BLOCK: priorCompletedScope,
        POST_RESULT_BLOCK: priorCompletedScope
      };
    }

    case 6:
    case 7:
      return { POST_DAY: postDayScope };

    case 8: {
      const first = Math.min(...scene.betSequences);
      const priorCompletedScope = chronologyScope(first - 1);
      return {
        PRE_RESULT_BLOCK: priorCompletedScope,
        POST_RESULT_BY_BET: scene.betSequences.map(sequence => chronologyScope(sequence)),
        POST_RESULT_BLOCK: priorCompletedScope
      };
    }

    default:
      throw new Error('Unsupported sceneType ' + scene.sceneType + ' for fact scope.');
  }
}

function scene1Context(bettings) {
  return {
    factAtomsByPhase: {
      PRE_RESULT_DAY: preDayAtoms(bettings)
    },
    protectedTerms: protectedTerms(bettings, bettings.bets)
  };
}

function scene2Context(bettings, sequence) {
  const bet = betBySequence(bettings, sequence);
  const pre = preBetAtoms(bet);
  return {
    factAtomsByPhase: {
      PRE_RESULT: pre,
      POST_RESULT: mergeAtoms(pre, postBetAtoms(bet))
    },
    semanticContextByPhase: {
      POST_RESULT: { raceWinner: Number(bet.finishingPosition) === 1 }
    },
    protectedTerms: protectedTerms(bettings, [bet])
  };
}

function scene3Context(bettings, sequence) {
  const bet = betBySequence(bettings, sequence);
  return {
    factAtomsByPhase: {
      POST_RESULT: mergeAtoms(preBetAtoms(bet), postBetAtoms(bet))
    },
    semanticContextByPhase: {
      POST_RESULT: { raceWinner: Number(bet.finishingPosition) === 1 }
    },
    protectedTerms: protectedTerms(bettings, [bet])
  };
}

function scene4Context(bettings, checkpoint) {
  const completed = bettings.bets.filter(bet => bet.sequence <= checkpoint);
  const future = bettings.bets.filter(bet => bet.sequence > checkpoint).slice(0, 3);
  const remaining = Math.max(0, bettings.bets.length - completed.length);
  return {
    factAtomsByPhase: {
      POST_COMPLETED_BETS: checkpointAtoms(bettings, completed),
      PRE_FUTURE_RESULTS: mergeAtoms(
        { CHECKPOINT_BETS_REMAINING: String(remaining) },
        ...future.map(preBetAtoms)
      )
    },
    protectedTerms: protectedTerms(bettings, [...completed, ...future])
  };
}

function groupedContext(bettings, sequences, scene8) {
  const bets = sequences.map(sequence => betBySequence(bettings, sequence));
  const preBlock = mergeAtoms(groupPreAtoms(bettings, bets), ...bets.map(preBetAtoms));
  const postBlock = mergeAtoms(preBlock, groupPostAtoms(bets));
  const position = groupPositionSemantics(bettings, bets);
  const groupSemantics = {
    groupPosition: {
      isFirstGroup: position.isFirstGroup,
      isFinalGroup: position.isFinalGroup,
      finality: position.isFinalGroup ? 'FINAL_GROUP' : 'MORE_BETS_REMAIN'
    }
  };

  if (scene8) {
    return {
      factAtomsByPhase: {
        PRE_RESULT_BLOCK: preBlock,
        POST_RESULT_BY_BET: bets.map(bet => mergeAtoms(preBetAtoms(bet), postBetAtoms(bet))),
        POST_RESULT_BLOCK: postBlock
      },
      semanticContextByPhase: {
        PRE_RESULT_BLOCK: groupSemantics,
        POST_RESULT_BLOCK: groupSemantics
      },
      protectedTerms: protectedTerms(bettings, bets)
    };
  }

  return {
    factAtomsByPhase: {
      PRE_RESULT_BLOCK: preBlock,
      POST_RESULT_BLOCK: postBlock
    },
    semanticContextByPhase: {
      PRE_RESULT_BLOCK: groupSemantics,
      POST_RESULT_BLOCK: groupSemantics
    },
    protectedTerms: protectedTerms(bettings, bets)
  };
}

function scene6Context(bettings) {
  const options = buildStandoutOptions(bettings);
  const optionAtoms = options.map(option => option.atoms || {});
  return {
    factAtomsByPhase: {
      POST_DAY: mergeAtoms(postDayAtoms(bettings), ...optionAtoms)
    },
    standoutOptions: options.map(({ type, atoms }) => ({ type, factAtomIds: Object.keys(atoms || {}) })),
    protectedTerms: protectedTerms(bettings, betsForStandoutOptions(bettings, options))
  };
}

function scene7Context(bettings) {
  const highlights = buildFinalHighlights(bettings);
  const highlightAtoms = highlights.map(option => option.atoms || {});
  return {
    factAtomsByPhase: {
      POST_DAY: mergeAtoms(postDayAtoms(bettings), ...highlightAtoms)
    },
    availableFinalHighlights: highlights.map(({ type, atoms }) => ({ type, factAtomIds: Object.keys(atoms || {}) })),
    protectedTerms: protectedTerms(bettings, betsForFinalHighlights(bettings))
  };
}

function preDayAtoms(bettings) {
  const meetings = unique(bettings.bets.map(bet => bet.meeting));
  return {
    DAY_USER: String(bettings.user?.firstName ?? ''),
    DAY_TOTAL_BETS: String(bettings.bets.length),
    DAY_TOTAL_STAKED: money(bettings.summary?.totalStaked ?? sum(bettings.bets.map(bet => bet.stake))),
    DAY_MEETING_COUNT: String(meetings.length),
    DAY_MEETINGS: joinNatural(meetings)
  };
}

function postDayAtoms(bettings) {
  const summary = bettings.summary || {};
  const raceWinners = bettings.bets.filter(bet => Number(bet.finishingPosition) === 1).length;
  return mergeAtoms(preDayAtoms(bettings), {
    DAY_WINNING_BETS: String(Number(summary.wins || 0)),
    DAY_LOSING_BETS: String(Number(summary.losses || 0)),
    DAY_RACE_WINNERS: String(raceWinners),
    DAY_TOTAL_RETURNED: money(summary.totalReturned || 0)
  }, typedPnlAtoms('DAY', summary.finalPnl || 0));
}

function preBetAtoms(bet) {
  const prefix = 'B' + bet.sequence + '_';
  return {
    [prefix + 'RUNNER']: bet.runnerName,
    [prefix + 'MEETING']: bet.meeting,
    [prefix + 'RACE']: bet.meeting + ' Race ' + bet.raceNumber,
    [prefix + 'RACE_NAME']: bet.raceName,
    [prefix + 'BET_TYPE']: bet.betType,
    [prefix + 'STAKE']: money(bet.stake),
    [prefix + 'DECIMAL_ODDS']: formatNumber(bet.odds)
  };
}

function postBetAtoms(bet) {
  const prefix = 'B' + bet.sequence + '_';
  return mergeAtoms({
    [prefix + 'FINISH']: finishingPositionText(bet.finishingPosition),
    [prefix + 'BET_RESULT']: bet.result,
    [prefix + 'RETURN_PHRASE']: 'a ' + money(bet.return) + ' return'
  },
  typedPnlAtoms('B' + bet.sequence, bet.profitLoss),
  typedPnlAtoms('B' + bet.sequence + '_RUNNING', bet.runningPnl));
}

function groupPreAtoms(bettings, bets) {
  const before = previousRunningPnl(bettings, bets[0].sequence);
  const meetings = unique(bets.map(bet => bet.meeting));
  const last = bets[bets.length - 1].sequence;
  return mergeAtoms({
    BLOCK_BET_COUNT: String(bets.length),
    BLOCK_START_BET: String(bets[0].sequence),
    BLOCK_END_BET: String(last),
    BLOCK_TOTAL_DAY_BETS: String(bettings.bets.length),
    BLOCK_BETS_REMAINING_AFTER: String(Math.max(0, bettings.bets.length - last)),
    BLOCK_TOTAL_STAKE: money(sum(bets.map(bet => bet.stake))),
    BLOCK_MEETINGS: joinNatural(meetings)
  }, typedPnlAtoms('BLOCK_RUNNING_BEFORE', before));
}

function groupPostAtoms(bets) {
  const pl = sum(bets.map(bet => bet.profitLoss));
  const winningBets = bets.filter(bet => bet.result === 'WIN').length;
  const raceWinners = bets.filter(bet => Number(bet.finishingPosition) === 1).length;
  return mergeAtoms({
    BLOCK_WINNING_BETS: String(winningBets),
    BLOCK_LOSING_BETS: String(bets.length - winningBets),
    BLOCK_RACE_WINNERS: String(raceWinners)
  },
  typedPnlAtoms('BLOCK', pl),
  typedPnlAtoms('BLOCK_RUNNING_AFTER', bets[bets.length - 1].runningPnl));
}

function checkpointAtoms(bettings, completed) {
  const atoms = {};
  if (!completed.length) return atoms;
  const raceWinners = completed.filter(bet => Number(bet.finishingPosition) === 1).length;
  const winningBets = completed.filter(bet => bet.result === 'WIN').length;
  Object.assign(atoms, {
    CHECKPOINT_BETS_COMPLETED: String(completed.length),
    CHECKPOINT_WINNING_BETS: String(winningBets),
    CHECKPOINT_RACE_WINNERS: String(raceWinners)
  }, typedPnlAtoms('CHECKPOINT_RUNNING', completed[completed.length - 1].runningPnl));
  const best = bestPositiveWin(completed);
  if (best) Object.assign(atoms, preBetAtoms(best), postBetAtoms(best));
  return atoms;
}

function buildStandoutOptions(bettings) {
  const bets = bettings.bets;
  const options = [];
  const biggestWin = sequenceBet(bettings, bettings.summary?.biggestWinSequence);
  if (biggestWin && biggestWin.profitLoss > 0) {
    options.push({ type: 'biggestWin', atoms: highlightAtoms(biggestWin) });
  }
  const highestOddsWinner = sequenceBet(bettings, bettings.summary?.highestOddsWinnerSequence);
  if (highestOddsWinner) {
    options.push({ type: 'highestOddsWinner', atoms: highlightAtoms(highestOddsWinner) });
  }
  const biggestRecovery = bets.filter(bet => bet.profitLoss > 0)
    .reduce((best, bet) => !best || bet.profitLoss > best.profitLoss ? bet : best, null);
  if (biggestRecovery) {
    options.push({ type: 'biggestRecovery', atoms: highlightAtoms(biggestRecovery) });
  }
  const streak = longestLosingStreak(bets);
  if (streak) {
    options.push({
      type: 'longestLosingStreak',
      atoms: {
        STANDOUT_LONGEST_LOSING_STREAK_BET_COUNT: String(streak.length),
        STANDOUT_LONGEST_LOSING_STREAK_BET_RANGE: rangeValue(streak.startSequence, streak.endSequence)
      }
    });
  }
  const finish = strongestFinish(bets);
  options.push({
    type: 'strongestFinish',
    atoms: mergeAtoms({
      STANDOUT_STRONGEST_FINISH_BET_RANGE: rangeValue(finish.startSequence, finish.endSequence),
      STANDOUT_STRONGEST_FINISH_BET_COUNT: String(finish.endSequence - finish.startSequence + 1)
    }, typedPnlAtoms('STANDOUT_STRONGEST_FINISH', finish.netGain))
  });
  options.push({
    type: 'totalReturned',
    atoms: { DAY_TOTAL_RETURNED: money(bettings.summary?.totalReturned || 0) }
  });
  return options;
}

function buildFinalHighlights(bettings) {
  const summary = bettings.summary || {};
  const highlights = [
    { type: 'totalBets', atoms: { DAY_TOTAL_BETS: String(bettings.bets.length) } },
    { type: 'wins', atoms: { DAY_WINNING_BETS: String(Number(summary.wins || 0)) } },
    { type: 'losses', atoms: { DAY_LOSING_BETS: String(Number(summary.losses || 0)) } },
    { type: 'totalStaked', atoms: { DAY_TOTAL_STAKED: money(summary.totalStaked || 0) } },
    { type: 'totalReturned', atoms: { DAY_TOTAL_RETURNED: money(summary.totalReturned || 0) } },
    { type: 'finalPnl', atoms: typedPnlAtoms('DAY', summary.finalPnl || 0) }
  ];
  const biggestWin = sequenceBet(bettings, summary.biggestWinSequence);
  if (biggestWin && biggestWin.profitLoss > 0) {
    highlights.push({ type: 'biggestWin', atoms: highlightAtoms(biggestWin) });
  }
  const highestOddsWinner = sequenceBet(bettings, summary.highestOddsWinnerSequence);
  if (highestOddsWinner) {
    highlights.push({ type: 'highestOddsWinner', atoms: highlightAtoms(highestOddsWinner) });
  }
  return highlights;
}

function highlightAtoms(bet) {
  return mergeAtoms(preBetAtoms(bet), postBetAtoms(bet));
}

function betsForStandoutOptions(bettings, options) {
  const sequences = new Set();
  for (const option of options) {
    for (const id of Object.keys(option.atoms || {})) {
      const match = /^B(\d+)_/.exec(id);
      if (match) sequences.add(Number(match[1]));
    }
  }
  return [...sequences].sort((a,b) => a-b).map(sequence => betBySequence(bettings, sequence));
}

function betsForFinalHighlights(bettings) {
  const sequences = [bettings.summary?.biggestWinSequence, bettings.summary?.highestOddsWinnerSequence]
    .filter(Number.isInteger);
  return [...new Set(sequences)].map(sequence => betBySequence(bettings, sequence));
}

function protectedTerms(bettings, bets) {
  return unique([
    bettings.user?.firstName,
    ...bets.flatMap(bet => [bet.runnerName, bet.meeting, bet.raceName])
  ].filter(value => typeof value === 'string' && value.trim().length >= 2));
}

function bestPositiveWin(bets) {
  return bets.filter(bet => bet.result === 'WIN' && Number(bet.profitLoss) > 0)
    .reduce((best, bet) => !best || Number(bet.profitLoss) > Number(best.profitLoss) ? bet : best, null);
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

function typedPnlAtoms(prefix, value) {
  const n = Number(value);
  if (n > 0) return { [prefix + '_PROFIT_TEXT']: money(n) + ' profit' };
  if (n < 0) return { [prefix + '_LOSS_TEXT']: money(Math.abs(n)) + ' loss' };
  return { [prefix + '_BREAK_EVEN_TEXT']: '$0 break-even' };
}

function groupPositionSemantics(bettings, bets) {
  const startSequence = bets[0].sequence;
  const endSequence = bets[bets.length - 1].sequence;
  return {
    startSequence,
    endSequence,
    betCount: bets.length,
    totalBets: bettings.bets.length,
    remainingAfter: Math.max(0, bettings.bets.length - endSequence),
    isFirstGroup: startSequence === 1,
    isFinalGroup: endSequence === bettings.bets.length
  };
}

function rangeValue(start, end) {
  return start === end ? String(start) : String(start) + '-' + String(end);
}

function money(value) {
  return '$' + formatNumber(Math.abs(Number(value || 0)));
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
}

function ordinal(value) {
  const n = Number(value);
  const mod100 = n % 100;
  const suffix = (mod100 >= 11 && mod100 <= 13) ? 'th' : ({1:'st',2:'nd',3:'rd'}[n % 10] || 'th');
  return n + suffix;
}

function finishingPositionText(value) {
  return Number(value) === 0 ? 'UNPLACED' : ordinal(value);
}

function joinNatural(values) {
  const xs = unique(values.filter(Boolean));
  if (xs.length <= 1) return xs[0] || '';
  if (xs.length === 2) return xs[0] + ' and ' + xs[1];
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

function mergeAtoms(...maps) {
  return Object.assign({}, ...maps.filter(Boolean));
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

module.exports = {
  buildLlmCopyInput,
  buildLlmModelPayload,
  requiredLlmFields,
  __test: {
    preBetAtoms,
    postBetAtoms,
    postDayAtoms,
    groupPostAtoms,
    buildGlobalFactCatalog,
    buildAllowedGlobalFactIdsByPhase,
    typedPnlAtoms,
    groupPositionSemantics
  }
};
