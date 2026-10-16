'use strict';

// Canonical presentation identity; not a claim that the displayed selections
// constitute a covered or winning combination.
function displayBetRunners(bet) {
  if (!['TRIFECTA', 'FIRST4'].includes(bet.betType)) return String(bet.runnerName || '').trim();
  const selected = bet.selectedRunners || [];
  // A winning wager may display the known race podium only when each runner
  // appears in this wager's selections. Settlement remains authoritative.
  if (bet.result === 'WIN') {
    const maxRunners = bet.betType === 'FIRST4' ? 4 : 3;
    const podium = Array.from({length:maxRunners}, (_, index) => index + 1).map(position =>
      selected.find(runner => runner.finishingPosition === position)
    );
    if (podium.every(Boolean) && new Set(podium.map(x => x.runnerNumber)).size === maxRunners) {
      return podium.map(runner => runner.runnerName).join(' · ');
    }
  }
  return selected.slice(0, bet.betType === 'FIRST4' ? 4 : 3).map(runner => runner.runnerName).join(' · ');
}

module.exports = { displayBetRunners };
