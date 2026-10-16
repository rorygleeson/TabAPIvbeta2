'use strict';

const { URL } = require('url');

function createDefaultFailure(message) {
  const error = new Error(message);
  error.name = 'CanonicalBettingsValidationError';
  throw error;
}

const cents = value => Math.round(Number(value) * 100);
const sameMoney = (left, right) => cents(left) === cents(right);
const sum = values => values.reduce((total, value) => total + Number(value), 0);

function earliestMax(items, key) {
  if (!items.length) return null;
  return items.reduce((best, item) =>
    Number(item[key]) > Number(best[key]) ? item : best
  );
}

function earliestMin(items, key) {
  if (!items.length) return null;
  return items.reduce((best, item) =>
    Number(item[key]) < Number(best[key]) ? item : best
  );
}

function validateCanonicalBettingsSemantics(bettings, onFailure = createDefaultFailure) {
  const fail = message => onFailure(message);
  const bets = bettings.bets;
  const summary = bettings.summary;

  if (bets.length !== summary.totalBets) {
    fail('summary.totalBets does not equal bets.length.');
  }

  bets.forEach((bet, index) => {
    const expectedSequence = index + 1;

    if (bet.sequence !== expectedSequence) {
      fail(`Bet sequence must be contiguous and ascending; expected ${expectedSequence}.`);
    }

    if (!sameMoney(bet.profitLoss, bet.return - bet.stake)) {
      fail(`Bet ${bet.sequence}: profitLoss must equal return - stake.`);
    }

    const expectedRunningPnl = index === 0
      ? bet.profitLoss
      : bets[index - 1].runningPnl + bet.profitLoss;

    if (!sameMoney(bet.runningPnl, expectedRunningPnl)) {
      fail(`Bet ${bet.sequence}: runningPnl is inconsistent.`);
    }

    if (bet.replayUrl !== null) {
      let replayUrl;
      try {
        replayUrl = new URL(bet.replayUrl);
      } catch {
        replayUrl = null;
      }
      if (!bet.replayUrl.trim() || !replayUrl || replayUrl.protocol !== 'https:') {
        fail(`Bet ${bet.sequence}: replayUrl must be a valid non-empty HTTPS URL or null.`);
      }
    }
  });

  // Multi-runner selection validation for Trifecta and First4.
  bets.forEach(bet => {
    if (!['TRIFECTA', 'FIRST4'].includes(bet.betType)) return;
    if (!Array.isArray(bet.selectedRunners) || bet.selectedRunners.length < (bet.betType === 'FIRST4' ? 4 : 3)) {
      fail(`Bet ${bet.sequence}: ${bet.betType} requires enough selectedRunners.`);
      return;
    }
    const numbers = bet.selectedRunners.map(runner => runner.runnerNumber);
    if (new Set(numbers).size !== numbers.length) {
      fail(`Bet ${bet.sequence}: ${bet.betType} selectedRunners must have distinct runner numbers.`);
    }
  });

  const wins = bets.filter(bet => bet.result === 'WIN');
  const losses = bets.filter(bet => bet.result === 'LOSS');

  if (!sameMoney(summary.totalStaked, sum(bets.map(bet => bet.stake)))) {
    fail('summary.totalStaked mismatch.');
  }

  if (!sameMoney(summary.totalReturned, sum(bets.map(bet => bet.return)))) {
    fail('summary.totalReturned mismatch.');
  }

  if (
    summary.wins !== wins.length ||
    summary.losses !== losses.length ||
    summary.wins + summary.losses !== summary.totalBets
  ) {
    fail('summary win/loss counts mismatch.');
  }

  if (
    !sameMoney(summary.finalPnl, bets.at(-1).runningPnl) ||
    !sameMoney(summary.finalPnl, summary.totalReturned - summary.totalStaked)
  ) {
    fail('summary.finalPnl mismatch.');
  }

  if (summary.meetings !== new Set(bets.map(bet => bet.meeting)).size) {
    fail('summary.meetings mismatch.');
  }

  if (!sameMoney(summary.biggestStake, Math.max(...bets.map(bet => bet.stake)))) {
    fail('summary.biggestStake mismatch.');
  }

  checkSequenceSummary(
    summary.biggestWinSequence,
    earliestMax(wins.filter(bet => bet.profitLoss > 0), 'profitLoss'),
    'biggestWinSequence',
    fail
  );

  checkSequenceSummary(
    summary.biggestLossSequence,
    earliestMin(losses.filter(bet => bet.profitLoss < 0), 'profitLoss'),
    'biggestLossSequence',
    fail
  );

  checkSequenceSummary(
    summary.highestOddsWinnerSequence,
    earliestMax(wins.filter(bet => typeof bet.odds === 'number' && Number.isFinite(bet.odds) && bet.odds > 0), 'odds'),
    'highestOddsWinnerSequence',
    fail
  );

  return bettings;
}

function checkSequenceSummary(actual, bet, label, fail) {
  const expected = bet?.sequence ?? null;
  if (actual !== expected) {
    fail(`summary.${label} must be ${expected}.`);
  }
}

module.exports = {
  validateCanonicalBettingsSemantics
};
