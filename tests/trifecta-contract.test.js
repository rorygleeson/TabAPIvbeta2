'use strict';

// Trifecta admission regression tests. Expected RED until Kubrick supports TRIFECTA.
// Run after npm ci in lambda/builder-recap:
//   node tests/trifecta-contract.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('../lambda/builder-recap/node_modules/ajv/dist/2020');
const addFormats = require('../lambda/builder-recap/node_modules/ajv-formats');
const { validateCanonicalBettingsSemantics } = require('../shared/canonical-bettings-validator');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/bettings.schema.json'), 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/bettings-baseline.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const clone = x => structuredClone(x);
const errors = () => JSON.stringify(validate.errors || []);
function check(payload, shouldPass, label) {
  const ok = validate(payload);
  assert.equal(ok, shouldPass, label + ': ' + errors());
  if (ok) assert.doesNotThrow(() => validateCanonicalBettingsSemantics(payload), label);
}

// A previously accepted ordinary-bet fixture must remain accepted.
check(baseline, true, 'existing baseline');

function trifecta() {
  const payload = clone(baseline);
  const bet = payload.bets[0];
  bet.betType = 'TRIFECTA';
  bet.runnerNumber = null;
  bet.runnerName = null;
  bet.odds = null;
  bet.finishingPosition = null;
  bet.selectedRunners = [
    { runnerNumber: 2, runnerName: 'HORSE TWO', finishingPosition: 0 },
    { runnerNumber: 8, runnerName: 'HORSE EIGHT', finishingPosition: 2 },
    { runnerNumber: 11, runnerName: 'HORSE ELEVEN', finishingPosition: 0 }
  ];
  // Other canonical financial amounts stay unchanged: one wager, one sequence.
  // If this bet was the day's highest-odds winner, recalculate that summary
  // deterministically from other known-odds winners.
  const eligible = payload.bets.filter(x => x.result === 'WIN' && Number.isFinite(x.odds) && x.odds > 0);
  payload.summary.highestOddsWinnerSequence = eligible.reduce((best, x) => !best || x.odds > best.odds ? x : best, null)?.sequence ?? null;
  return payload;
}

check(trifecta(), true, 'valid Trifecta is accepted');
const missing = trifecta();
delete missing.bets[0].selectedRunners;
check(missing, false, 'missing selections rejected');
const duplicates = trifecta();
duplicates.bets[0].selectedRunners[1].runnerNumber = 2;
check(duplicates, false, 'duplicate runner numbers rejected');
const tooFew = trifecta();
tooFew.bets[0].selectedRunners.length = 2;
check(tooFew, false, 'fewer than three selections rejected');
const invalidRegular = clone(baseline);
invalidRegular.bets[0].runnerName = null;
check(invalidRegular, false, 'ordinary bet still requires runnerName');

console.log('Trifecta admission and backward compatibility tests passed.');
