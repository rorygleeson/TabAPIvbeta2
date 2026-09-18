# Kubrick V2 Migration

Last updated: 2026-09-18

## Objective

Replace the old LLM-heavy Kubrick planner with a deterministic structure engine while preserving the proven downstream Daily Recap system.

```text
TabAPIvbeta2
=
TabAPIvbeta1
- old Kubrick structural planning complexity
+ deterministic Kubrick V2 planner
+ one grounded LLM copy call
+ deterministic copy fallback
+ minimal canonical bettings.json cleanup
```

The existing Builder, templates, runtime, S3/SQS/DynamoDB topology and vbeta1-named AWS resources remain intentionally reused.

## Repositories

Active source:

```text
rorygleeson/TabAPIvbeta2
```

Frozen migration reference/fallback:

```text
rorygleeson/TabAPIvbeta1
```

Do not copy old Kubrick complexity into vbeta2 merely because it existed in vbeta1.

## AWS migration rule

Kubrick V2 reuses the existing AWS environment.

Account:

```text
134387458447
```

Region:

```text
ap-southeast-2
```

Key resources remain:

```text
tab-recap-vbeta1
tab-recap-vbeta1-jobs
tab-recap-vbeta1-planning
tab-recap-vbeta1-planning-dlq
tab-recap-vbeta1-rendering
tab-recap-vbeta1-rendering-dlq
tab-recap-vbeta1-scene-planner
tab-recap-vbeta1-builder-recap
```

No parallel vbeta2 AWS environment should be created unless explicitly approved.

GitHub changes do not imply AWS deployment. Deployment remains an explicit push/deploy action.

## Scope boundary

### Kubrick V2 owns

- canonical planner input validation;
- deterministic scene structure;
- replay selection;
- midpoint placement;
- Scene 5/8 grouping;
- duration candidate selection;
- grounded copy-input construction;
- exactly one Bedrock copy request;
- copy response validation;
- deterministic safe fallback on copy-stage failure;
- merge into final `scene.json`.

### Existing Builder owns

- deterministic template selection;
- factual rendering from `bettings.json` and `scene.json`;
- runtime HTML/JS/CSS behaviour;
- replay playback/runtime handling;
- final recap HTML generation.

### Separate concerns

The CSV Normaliser is a separate upstream subsystem.

Kubrick must not become responsible for CSV parsing, historical-results enrichment or account-history interpretation.

## Canonical input decision

The canonical `bettings.json` contract is locked except for the already-completed removal of:

```text
sceneType
showReplay
```

Fields retained include:

```text
profitLoss
runningPnl
summary
replayUrl
```

Replay semantics:

```text
valid HTTPS replayUrl -> replay available
null/invalid replayUrl -> replay unavailable
```

Kubrick decides whether available replay media is actually selected.

## Current Kubrick V2 flow

```text
bettings.json
  |
  v
schema + semantic input validation
  |
  v
buildDeterministicScenePlan()
  |
  v
deterministic-scene-plan.json
  |
  v
buildLlmCopyInput()
  |
  v
buildLlmModelPayload()
  |
  v
FACT_PARTS_COMPACT_V1
  |
  v
ONE Bedrock copy call
  |
  +--> valid response -> validate + merge
  |
  +--> copy-stage error -> deterministic fallback copy
  |
  v
final scene.json planVersion 2.0
  |
  v
existing Builder
```

There is no LLM structural repair loop and no second LLM call.

## Deterministic policy now implemented

### Duration

Current target curve:

```text
1  -> 60s
5  -> 80s
10 -> 105s
20 -> 145s
40 -> 195s
60 -> 240s
75 -> 285s
```

Tolerance setting: 12 seconds.

Runtime hard maximum: 300 seconds.

### Midpoint

```text
minimum bets = 6
target coverage = 50%
```

Scene 4 is placed after the legal primary-scene boundary nearest the target.

### Replay count

```text
<=5   -> 1 desired
<=10  -> 2 desired
<=20  -> 3 desired
<=40  -> 4 desired
>40   -> 5 desired
max   -> 5
```

For >40 bets, retain at least 3 when 3+ eligible replay bets exist.

Eligibility:

```text
WIN + valid HTTPS replayUrl
```

### Scene 2 extras

```text
<=10 -> max 4 extra
<=20 -> max 3 extra
<=40 -> max 2 extra
>40  -> max 1 extra
```

### Scene 8

Enabled only for:

```text
totalBets >= 17
```

### Grouping

Below 17 bets:

```text
1 -> Scene 2
2 -> Scene 5(2)
4 -> Scene 5(2)+Scene 5(2)
otherwise -> Scene 5(3) chunks
```

At 17+ bets:

```text
1 -> Scene 2
2-3 -> Scene 5
4-5 -> Scene 8
>5 -> Scene 8 groups of 5, avoiding a remainder of 1 by taking 4
```

## Grounded copy design

The rich internal copy input remains deterministic and is used for validation/merge.

The Bedrock request is a compact projection:

```text
groundingProtocol = FACT_PARTS_COMPACT_V1
modelPayloadVersion = 1.0
```

This compaction was required because the earlier rich 75-bet payload exceeded the model input limit.

The compact payload sends only scene-relevant phase-scoped facts and requested copy rules.

The model returns `fact` and `text` parts. Fact IDs are expanded deterministically.

Narrative semantics are not reconstructed by JavaScript.

## Copy availability boundary

A structurally valid recap must survive copy-stage failure.

The single copy call is wrapped so these failures use deterministic safe fallback copy:

- Bedrock invocation failure;
- malformed model output;
- copy response validation failure;
- unusable required copy.

Fallback implementation:

```text
lambda/scene-planner/llm-copy-fallback.js
```

There is no repair call.

Objective downstream failures still fail normally.

## Validation boundary

Hard failures are reserved for objective conditions such as:

- invalid canonical input;
- invalid deterministic scene structure;
- missing/duplicate/out-of-order primary coverage;
- illegal replay placement/eligibility;
- malformed copy response;
- missing required copy fields;
- unknown/out-of-scope fact IDs;
- invalid enums/cardinality;
- invalid final scene contract;
- storage/state/runtime errors.

Do not hard-fail for:

- awkward grammar;
- capitalization;
- repeated words;
- prose length targets;
- clumsy fact/text joins;
- customer-unfriendly internal terminology;
- semantic quality that cannot be safely verified mechanically.

Do not reintroduce old semantic/grammar/copy-length validators.

## Real-data fixture migration

The fake large test data has been replaced for:

```text
bettings-5.json
bettings-8.json
bettings-32.json
bettings-50.json
bettings-75.json
```

These use one consistent 75-bet master dataset derived from recent real Australian thoroughbred historical results from 2026-09-16 and 2026-09-17.

Race/runner/result/fixed-odds/Sky replay facts are historical.

The simulated customer bet selections/stakes are test data.

Smaller fixtures are exact prefixes of the 75-bet master:

```text
5  = first 5
8  = first 8
32 = first 32
50 = first 50
```

`bettings-16.json` and `bettings-baseline.json` remain the older retained baseline fixture.

The 75-bet fixture deliberately sets `replayUrl` to `null` for sequences 74 and 75.

## Baseline format validation

The new 5 / 8 / 32 / 50 / 75 fixtures have been compared directly with `bettings-baseline.json`.

They match the canonical object, bet-field and summary-field shape.

Semantic fixture checks also passed for:

- contiguous sequence;
- `profitLoss = return - stake`;
- cumulative `runningPnl`;
- summary totals;
- win/loss counts;
- meeting count;
- biggest/highest sequence references;
- valid HTTPS replay URLs when non-null.

## Latest live direct planner proof

On 2026-09-18, direct AWS planner tests reached `RENDERING` for:

| Bets | Fixture | Scene count | Result |
|---:|---|---:|---|
| 5 | new real-data | 8 | PASS |
| 8 | new real-data | 11 | PASS |
| 16 | older retained fixture | 16 | PASS |
| 32 | new real-data | 20 | PASS |
| 50 | new real-data | 25 | PASS |
| 75 | new real-data + 2 null replay URLs | 27 | PASS |

This proves the current planner boundary across small, medium and large days.

The 75-bet proof also confirms missing replay URLs do not break planning.

## Current remaining issue

The planner is structurally stable.

The remaining visible issue is **copy quality**, for example:

```text
Both runners missed, The block lost $45.
profit for the day day.
Backed 8 backed runners won their races.
delivered The bet made $2800 profit.
```

The internal word `block` should not leak into customer copy.

This is not justification for architecture changes.

The preferred next experiment is a very small prompt-only wording refinement, followed by 5- and 75-bet comparison tests.

No new validator, repair loop or second model call should be added for copy polish.

## Planned end-to-end product architecture

The planner migration sits inside the larger intended pilot flow:

```text
pilot frontend
  -> presigned CSV upload to private S3
  -> Orchestrator creates/tracks job
  -> one Python Normaliser Lambda (planned production shape)
       -> Pass 1 CSV parse/normalise
       -> Pass 2 historical enrichment
       -> Pass 3 canonical bettings.json
  -> planning SQS
  -> Kubrick V2 Scene Planner
  -> scene.json
  -> rendering SQS
  -> existing Builder
  -> private recap.html
  -> short-lived delivery URL
  -> frontend polls job status and redirects/displays recap
```

The current repository proves the planner/Builder boundary and contains ongoing Normaliser work. The full browser upload/orchestration/status/delivery path remains planned rather than fully proven.

## Working rules

1. Inspect actual repo state before proposing changes.
2. Work one controlled change/test at a time.
3. Distinguish PROVEN / LOCKED / IN PROGRESS / PLANNED.
4. Use Windows CMD for local user commands.
5. Do not create fixture-specific production hacks.
6. Do not add a structural repair loop.
7. Do not add a second LLM call.
8. Do not change deterministic planner structure without explicit approval.
9. Copy quality must remain non-fatal.
10. Do not claim GitHub source is deployed unless deployment is verified.

## Current state

### PROVEN

- deterministic planner exists and is active source;
- canonical input cleanup complete;
- replay selection and missing-replay handling work;
- deterministic midpoint/grouping/coverage work;
- compact 75-bet model payload works;
- one-call copy circuit breaker works;
- Builder downstream contract remains compatible;
- direct 5 / 8 / 16 / 32 / 50 / 75 planner tests pass.

### LOCKED

- LLM is copywriter only;
- code owns structure;
- one LLM copy call maximum;
- no repair loop;
- deterministic fallback on copy-stage failure;
- existing AWS topology reused;
- Builder not redesigned.

### IN PROGRESS / PLANNED

- optional prompt-only copy polish;
- further rendered-HTML regression with the new real fixtures;
- Normaliser integration into canonical `bettings.json`;
- complete upload/orchestration/status/delivery product path.
