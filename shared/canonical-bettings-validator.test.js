'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateCanonicalBettingsSemantics } = require('./canonical-bettings-validator');

const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'bettings-baseline.json');
const baseline = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

assert.doesNotThrow(() => validateCanonicalBettingsSemantics(structuredClone(baseline)));

const badTotalBets = structuredClone(baseline);
badTotalBets.summary.totalBets += 1;
assert.throws(
  () => validateCanonicalBettingsSemantics(badTotalBets),
  /summary\.totalBets does not equal bets\.length/
);

const badProfitLoss = structuredClone(baseline);
badProfitLoss.bets[0].profitLoss += 1;
assert.throws(
  () => validateCanonicalBettingsSemantics(badProfitLoss),
  /profitLoss must equal return - stake/
);

const badRunningPnl = structuredClone(baseline);
badRunningPnl.bets[1].runningPnl += 1;
assert.throws(
  () => validateCanonicalBettingsSemantics(badRunningPnl),
  /runningPnl is inconsistent/
);

const badSummary = structuredClone(baseline);
badSummary.summary.totalReturned += 1;
assert.throws(
  () => validateCanonicalBettingsSemantics(badSummary),
  /summary\.totalReturned mismatch/
);

const badReplayUrl = structuredClone(baseline);
badReplayUrl.bets[0].replayUrl = 'http://example.com/replay.mp4';
assert.throws(
  () => validateCanonicalBettingsSemantics(badReplayUrl),
  /replayUrl must be a valid non-empty HTTPS URL or null/
);

console.log('Shared canonical bettings semantic validator tests passed.');
