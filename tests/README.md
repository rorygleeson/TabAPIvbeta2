# TAB Recap Regression Gates

Last updated: 2026-09-18

This file describes the current Kubrick V2 regression strategy.

The old vbeta1 planner repair-loop tests are no longer authoritative.

## 1. Planner regression boundary

Kubrick V2 must prove two separate properties:

1. deterministic structure is correct and reproducible;
2. copy quality problems cannot destabilise an otherwise valid recap.

The planner architecture is:

```text
bettings.json
-> deterministic structure
-> one grounded copy call
-> deterministic fallback on copy-stage failure
-> final scene.json
```

There is no structural repair loop and no second LLM call.

## 2. Deterministic planner tests

Source:

```text
lambda/scene-planner/scene-planner.test.js
```

The structural suite must cover:

- Scene 1 always first;
- Scene 6 second-last;
- Scene 7 last;
- exact one-time primary bet coverage;
- primary chronology;
- Scene 2 promotion policy;
- Scene 3 replay eligibility;
- Scene 3 immediately following its matching Scene 2;
- Scene 4 omitted below 6 bets;
- Scene 4 nearest legal 50% boundary;
- Scene 5 grouping;
- Scene 8 threshold and grouping;
- duration calculations;
- 300-second runtime hard maximum;
- deterministic output for identical input.

## 3. Copy boundary tests

Relevant source:

```text
lambda/scene-planner/llm-copy-input.test.js
lambda/scene-planner/llm-copy-response.test.js
lambda/scene-planner/llm-copy-merge.test.js
lambda/scene-planner/index.test.js
```

Current expectations:

- compact model payload uses `FACT_PARTS_COMPACT_V1`;
- model payload is substantially smaller than the rich validation input at 75 bets;
- copy response scene order and scene index must match;
- required fields must be present;
- enum/cardinality rules remain objective hard checks;
- fact IDs must exist and be in the allowed phase scope;
- fact parts resolve deterministically;
- copy merges without altering structural fields;
- blank/unusable required copy triggers the copy fallback boundary;
- malformed model output can trigger deterministic fallback;
- no second Bedrock call is made;
- fallback copy still merges into the same deterministic skeleton.

Do **not** add hard tests requiring ideal grammar, capitalization, style, exact prose length, or JavaScript interpretation of arbitrary factual-looking narrative.

Those are copy-quality concerns, not recap-availability gates.

## 4. Fixture set

Current fixtures:

```text
tests/fixtures/bettings-5.json
tests/fixtures/bettings-8.json
tests/fixtures/bettings-16.json
tests/fixtures/bettings-32.json
tests/fixtures/bettings-50.json
tests/fixtures/bettings-75.json
tests/fixtures/bettings-baseline.json
```

### Real-data master

5 / 8 / 32 / 50 / 75 are based on one consistent 75-bet master dataset.

The race facts come from recent real Australian thoroughbred historical data.

The customer betting activity is synthetic test activity.

Prefix relationship:

```text
5  == first 5 of 75
8  == first 8 of 75
32 == first 32 of 75
50 == first 50 of 75
```

### Retained older fixture

`bettings-16.json` remains the older baseline fixture.

`bettings-baseline.json` is also retained for canonical-shape comparison.

### Missing replay cases

The 75-bet fixture deliberately contains:

```text
sequence 74 -> replayUrl = null
sequence 75 -> replayUrl = null
```

This proves replay media is optional input availability and cannot break the plan.

## 5. Canonical fixture checks

Every generated/replaced fixture must preserve the baseline shape.

Every bet must have:

```text
sequence
betTime
raceTime
raceId
raceName
meeting
state
raceNumber
runnerId
runnerNumber
runnerName
betType
stake
odds
result
finishingPosition
return
profitLoss
runningPnl
replayUrl
```

Summary must have:

```text
totalBets
totalStaked
totalReturned
wins
losses
finalPnl
meetings
biggestStake
biggestWinSequence
biggestLossSequence
highestOddsWinnerSequence
```

Semantic checks:

- sequence is exactly 1..N;
- `profitLoss = return - stake` to currency tolerance;
- `runningPnl` is cumulative;
- summary totals match bets;
- wins + losses = totalBets;
- meeting count matches unique meetings;
- biggest/highest sequence fields point to the correct earliest matching bet;
- non-null replay URLs are valid HTTPS URLs.

## 6. Current live direct planner proof

Latest direct planner jobs on 2026-09-18:

| Bets | Job | Scenes | Result |
|---:|---|---:|---|
| 5 | `test-step10-5-20260918051253` | 8 | PASS |
| 8 | `test-step10-8-20260918051209` | 11 | PASS |
| 16 | `test-step10-16-20260918051457` | 16 | PASS |
| 32 | `test-step10-32-20260918051624` | 20 | PASS |
| 50 | `test-step10-50-20260918051812` | 25 | PASS |
| 75 | `test-step10-75-20260918051948` | 27 | PASS |

All reached DynamoDB/planner status `RENDERING`.

The 75-bet test passed with the two intentional null replay URLs.

## 7. Local/deployed test command

Windows CMD:

```cmd
tests\tools\run-planner-test.cmd 5
tests\tools\run-planner-test.cmd 8
tests\tools\run-planner-test.cmd 16
tests\tools\run-planner-test.cmd 32
tests\tools\run-planner-test.cmd 50
tests\tools\run-planner-test.cmd 75
```

The script:

1. uploads the selected fixture;
2. creates a `RECEIVED` DynamoDB test job;
3. directly invokes `tab-recap-vbeta1-scene-planner` at `$LATEST`;
4. requires the result to reach `RENDERING`;
5. downloads `scene.json`;
6. creates a render-message file.

It does **not** send the rendering SQS message automatically.

## 8. Builder regression boundary

The existing Builder remains a compatibility boundary, not a second planner.

Builder regression must continue to prove:

- accepted final `scene.json` renders;
- exact primary bet references resolve;
- replay media lookup is based on selected Scene 3 and canonical `replayUrl`;
- missing replay media does not create an invalid planner contract;
- HTML substitutions are escaped;
- runtime does not stall on media failure;
- existing templates remain structurally compatible with Scene Types 1-8.

Copy wording can be imperfect without causing Builder rejection.

## 9. Copy-quality testing

Current known non-fatal examples include:

```text
The block lost $45.
profit for the day day.
Backed 8 backed runners won their races.
delivered The bet made $2800 profit.
```

If copy quality is changed:

1. make the smallest prompt-only change first;
2. do not add validators;
3. do not add repair calls;
4. test 5 bets;
5. test 75 bets;
6. compare before/after;
7. revert if quality worsens.

The internal word `block` should not be exposed to customers simply because the deterministic planner groups bets.

## 10. Manual AWS resilience tests

Deployed AWS SQS/state/idempotency/DLQ checks remain documented separately in:

```text
tests/manual-cli-tests.md
```
