# Kubrick V2 Architecture Guide

> Authoritative architecture guide for the TAB Daily Recap Kubrick V2 migration.
>
> This document supersedes the old vbeta1 Kubrick planner design.

Last updated: 2026-09-18

---

## 1. Core architectural decision

Kubrick V2 separates **facts**, **deterministic scene structure**, **LLM copy**, and **rendering**.

The architecture is intentionally simple:

```text
canonical bettings.json
    |
    v
DETERMINISTIC STRUCTURE ENGINE
    |
    v
ordered scene skeleton
    |
    v
grounded compact copy payload
    |
    v
EXACTLY ONE BEDROCK COPY CALL
    |
    +--> valid copy -> merge
    |
    +--> copy-stage failure -> deterministic safe fallback copy
    |
    v
FINAL scene.json VALIDATION
    |
    v
EXISTING BUILDER
    |
    v
recap HTML
```

The key rule is:

> **Code owns scene planning. The LLM is a copywriter only.**

The existing Builder remains downstream-compatible and does not need to understand that Kubrick was rewritten.

---

## 2. Ownership model

### Layer 1 — Facts

`bettings.json` is the planner's factual source of truth.

Canonical bet fields include:

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

Summary fields include:

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

`sceneType` and `showReplay` are not canonical input fields.

Replay semantics are:

```text
valid HTTPS replayUrl -> replay media is available
null/invalid replayUrl -> replay media is unavailable
```

Availability does not mean Kubrick must show the replay. Replay selection is owned by planner code.

### Layer 2 — Deterministic structure

Code decides:

- Scene 1 position
- Scene 2 promotions
- Scene 3 replay selection and placement
- Scene 4 midpoint/checkpoint placement
- Scene 5 grouping
- Scene 8 grouping/compression
- exact primary bet coverage
- chronology
- Scene 6 and Scene 7 ending positions
- duration calculation and candidate selection

For identical `bettings.json` and policy, the structure must be reproducible.

### Layer 3 — Copy

The LLM writes only requested narrative fields such as:

- opening teaser
- tension/reaction lines
- replay labels/comments
- grouped-scene headlines/context
- midpoint narration
- daily verdict
- standout wording
- final/share copy

The LLM must not change scene type, order, membership, replay selection, midpoint placement or duration.

### Layer 4 — Rendering

The existing Builder consumes:

```text
validated bettings.json
+
validated scene.json
+
existing contracts/templates/runtime
=
recap HTML
```

The Builder is deterministic and is not a second planner.

---

## 3. Current planner implementation

Primary code:

- `lambda/scene-planner/scene-planner.js`
- `lambda/scene-planner/planner-policy.js`
- `lambda/scene-planner/llm-copy-input.js`
- `lambda/scene-planner/llm-copy-response.js`
- `lambda/scene-planner/llm-copy-merge.js`
- `lambda/scene-planner/llm-copy-fallback.js`
- `lambda/scene-planner/index.js`

Runtime contracts are loaded from `contracts/`.

The deterministic planner currently:

1. validates chronological canonical input;
2. derives planner facts;
3. interpolates target duration;
4. ranks replay-eligible bets;
5. selects a replay count within policy;
6. ranks additional Scene 2 candidates;
7. builds grouped primary scenes;
8. inserts Scene 3 immediately after matching Scene 2;
9. places Scene 4 at the nearest legal primary-scene boundary to 50% coverage;
10. appends Scene 6 and Scene 7;
11. calculates duration;
12. chooses the valid candidate nearest the target duration;
13. verifies exact chronological primary coverage and replay legality.

The planner does not ask the model to repair structure.

---

## 4. Locked deterministic policy

### Duration targets

The current editorial target curve is:

```text
1 bet   -> 60s
5 bets  -> 80s
10 bets -> 105s
20 bets -> 145s
40 bets -> 195s
60 bets -> 240s
75 bets -> 285s
```

Targets are interpolated between points.

Planner tolerance setting:

```text
12 seconds
```

The runtime hard maximum remains:

```text
300 seconds
```

Coverage and correctness outrank perfect target matching.

### Midpoint

```text
enabled = true
minimum bets = 6
target coverage ratio = 0.5
```

Scene 4 is placed after the legal primary-scene boundary closest to 50% completed bet coverage. It is never inserted in the middle of a Scene 5 or Scene 8 group.

### Replay policy

Desired replay count by recap size:

```text
<= 5 bets   -> 1
<= 10 bets  -> 2
<= 20 bets  -> 3
<= 40 bets  -> 4
> 40 bets   -> 5
absolute max -> 5
```

For recaps above 40 bets, at least 3 replays are retained when at least 3 eligible replay bets exist.

Replay eligibility is:

```text
bet.result == "WIN"
AND
replayUrl is valid HTTPS
```

Replay candidates are ranked deterministically using the scoring policy.

Every selected replay bet is also a Scene 2, and Scene 3 must immediately follow that Scene 2.

### Scene 2 allowance

Replay-backed Scene 2s are mandatory.

Additional non-replay Scene 2 allowance:

```text
<= 10 bets  -> max 4 extra
<= 20 bets  -> max 3 extra
<= 40 bets  -> max 2 extra
> 40 bets   -> max 1 extra
```

### Scene 8 threshold

Scene 8 is available only when:

```text
total bets >= 17
```

### Grouping

For recaps below 17 bets, Scene 8 is not used.

Remaining non-featured gaps are grouped as:

```text
1 remaining -> Scene 2
2 remaining -> Scene 5(2)
4 remaining -> Scene 5(2) + Scene 5(2)
otherwise   -> Scene 5(3) chunks
```

For recaps of 17 or more bets:

```text
1 remaining  -> Scene 2
2-3 remaining -> Scene 5
4-5 remaining -> Scene 8
>5 remaining  -> Scene 8 groups of 5,
                 except use 4 when taking 5 would leave remainder 1
```

### Scoring

Current deterministic attention weights:

```text
biggestWin             30
biggestLoss            22
highestOddsWinner      20
pnlCrossesIntoProfit   25
pnlCrossesIntoLoss     18
positivePnlSwing       15
negativePnlSwing       12
win                      8
replayAvailable          4
firstBet                 3
lastBet                  5
```

These weights affect presentation richness only. They never change factual bet data.

---

## 5. Scene rules

### Scene 1 — Opening

- always first
- no primary bet coverage
- placement owned by code
- opening prose owned by LLM

### Scene 2 — Featured single bet

- exactly one bet
- selected deterministically
- may be replay-backed or editorially promoted
- factual identity owned by code
- tension/reaction copy owned by LLM

### Scene 3 — Replay

- optional
- only for replay-eligible winning bets
- matching Scene 2 must exist
- must immediately follow matching Scene 2
- replay URL remains factual input
- label/comments are copy

### Scene 4 — Checkpoint

- omitted below 6 bets
- at most once
- checkpoint boundary owned by code
- narration owned by LLM
- cannot split grouped primary scenes

### Scene 5 — Small grouped story

- covers 2 or 3 consecutive bets
- grouping owned by code
- copy owned by LLM

The word **“block”** is an internal planning concept and should not appear in customer-facing copy merely because the planner groups bets.

### Scene 6 — Daily summary

- always second-last
- factual highlight eligibility is deterministic
- verdict/standout wording is LLM-owned

### Scene 7 — Final/share

- always last
- untimed/permanent runtime ending
- selected highlight identities are controlled by code/contract
- final/share wording is LLM-owned

### Scene 8 — Fast results

- only on higher-volume recaps
- covers 4 or 5 consecutive bets
- grouping owned by code
- one comment corresponds to each covered bet
- headline/category and comments are copy fields

---

## 6. Grounded copy protocol

Kubrick still makes exactly one model call per recap.

The rich internal copy contract is built first for deterministic validation and merge.

The actual Bedrock request uses a compact projection so 75-bet recaps remain comfortably within model input limits.

Current model protocol:

```text
FACT_PARTS_COMPACT_V1
modelPayloadVersion = 1.0
```

Each scene receives only its relevant phase-scoped fact atoms and requested field rules.

The model returns prose as fact/text parts:

```json
[
  {"type":"fact","id":"..."},
  {"type":"text","text":" ..."}
]
```

Fact parts are expanded deterministically during validation/merge.

The model never receives authority to reconstruct structure.

Chronology remains phase-scoped so pre-result copy cannot access future outcomes.

---

## 7. Copy validation boundary

The planner hard-fails objective machine-verifiable copy contract problems before fallback handling, including malformed response shape, unknown/out-of-scope fact IDs, missing required fields, illegal enum/cardinality and unusable empty required output.

Narrative quality is deliberately **not** a hard availability gate.

The following are non-fatal copy-quality issues:

- awkward grammar
- capitalization
- repetitive wording
- word-target overshoot
- clumsy fact/text joins
- factual-looking free text that JavaScript cannot reliably semantically interpret
- customer-unfriendly internal vocabulary such as “block”

Do not add homemade semantic, grammar, capitalization or prose-length validators to solve these issues.

Builder display substitutions are HTML-escaped.

---

## 8. Copy availability boundary

A structurally valid recap must not fail merely because the single LLM copy attempt fails.

`invokeCopyModel()` catches copy-stage failure, including:

- Bedrock request failure
- malformed/unparseable model output
- copy response validation failure

The planner then logs a copy fallback event and uses deterministic safe copy from:

`lambda/scene-planner/llm-copy-fallback.js`

Rules:

- exactly one Bedrock call maximum
- no repair call
- no second verifier model
- no per-scene model fan-out
- deterministic structure remains unchanged
- merge/final schema/S3/DynamoDB failures remain genuine hard failures

This is the main availability circuit breaker.

---

## 9. Current AWS/runtime architecture

Kubrick V2 deliberately reuses the existing vbeta1 AWS environment.

Account:

```text
134387458447
```

Region:

```text
ap-southeast-2
```

Key resources:

```text
S3        tab-recap-vbeta1
DynamoDB  tab-recap-vbeta1-jobs
SQS       tab-recap-vbeta1-planning
SQS       tab-recap-vbeta1-rendering
Lambda    tab-recap-vbeta1-scene-planner
Lambda    tab-recap-vbeta1-builder-recap
```

Bedrock model/profile:

```text
au.anthropic.claude-sonnet-4-5-20250929-v1:0
```

Planner Lambda source configuration:

```text
Node.js 22
512 MB
240s timeout
300s DynamoDB planning lease
```

Deployment runs from the `deploy` branch via `.github/workflows/deploy.yml`.

GitHub source changes are not assumed deployed until the deployment flow is explicitly run and verified.

---

## 10. Current implemented backend flow

The currently implemented planner/builder backend boundary is:

```text
working/<jobId>/bettings.json
       |
       v
planning SQS or direct test invocation
       |
       v
Scene Planner Lambda
       |
       +--> DynamoDB RECEIVED/PLANNING state
       +--> deterministic-scene-plan.json
       +--> one Bedrock copy attempt
       +--> scene.json
       |
       v
DynamoDB RENDERING
       |
       v
rendering SQS
       |
       v
Builder Lambda
       |
       v
recap HTML in private S3
```

The planner test harness directly invokes the planner and stops after `RENDERING`; it does not automatically send the rendering SQS message.

---

## 11. Planned full product flow

The intended full pilot/product flow remains broader than the currently tested planner boundary.

Planned end-to-end flow:

```text
User / pilot frontend
  |
  v
upload TAB CSV using short-lived presigned S3 URL
  |
  v
Orchestrator / job creation
  |
  v
Python Normaliser
  |
  +--> Pass 1: deterministic CSV parse/normalisation
  +--> Pass 2: authoritative historical race/result/media enrichment
  +--> Pass 3: final canonical bettings.json
  |
  v
planning queue
  |
  v
Kubrick V2 Scene Planner
  |
  v
scene.json
  |
  v
rendering queue
  |
  v
existing Builder
  |
  v
private recap.html
  |
  v
short-lived delivery URL / status response
```

This full flow is a target architecture. The current repository contains substantial Normaliser test/prototype logic plus the implemented planner and Builder, but the complete browser-upload/orchestration product path is not yet treated as proven production flow.

Do not blur **implemented/proven** and **planned** components.

---

## 12. Normaliser boundary

The Normaliser remains separate from Kubrick.

Current direction:

```text
TAB account-history CSV
  -> Pass 1 deterministic parse
  -> Pass 2 historical enrichment
  -> Pass 3 canonical bettings.json
  -> Kubrick V2
```

Kubrick must not absorb CSV parsing or historical-results enrichment responsibilities.

The main Normaliser design document is:

`docs/NORMALISER-LOGIC-SPEC.md`

---

## 13. Test fixtures and current proof

Current fixture files:

- `tests/fixtures/bettings-5.json`
- `tests/fixtures/bettings-8.json`
- `tests/fixtures/bettings-16.json`
- `tests/fixtures/bettings-32.json`
- `tests/fixtures/bettings-50.json`
- `tests/fixtures/bettings-75.json`
- `tests/fixtures/bettings-baseline.json`

The 5 / 8 / 32 / 50 / 75 fixtures use recent real historical Australian thoroughbred race data for race identity, runner, result, fixed odds and Sky replay URLs. Betting selections/stakes are synthetic test activity.

The 16-bet fixture remains the older baseline dataset.

The 75-bet fixture deliberately has `replayUrl: null` on sequences 74 and 75 to prove missing replay media is harmless.

Direct live planner tests reached `RENDERING` on 2026-09-18 for:

```text
5 bets  -> 8 scenes
8 bets  -> 11 scenes
16 bets -> 16 scenes
32 bets -> 20 scenes
50 bets -> 25 scenes
75 bets -> 27 scenes
```

This proves planner structural stability across the tested sizes. It does not mean every generated sentence is polished.

---

## 14. Current quality issue: copy polish only

The remaining visible issue is wording quality.

Examples observed in valid output include constructions such as:

```text
Both runners missed, The block lost $45.
profit for the day day.
Backed 8 backed runners won their races.
SAUCISSON won the race. at 81 odds delivered The bet made $2800 profit.
```

These are not structural planner failures.

Preferred treatment:

1. preserve current architecture;
2. if improvement is required, make a small prompt-only wording change first;
3. do not add hard prose validators;
4. do not add repair loops;
5. do not add a second LLM call;
6. test 5 and 75 before widening changes;
7. revert the prompt-only change if quality regresses.

---

## 15. Anti-complexity rules

These rules are mandatory:

1. No LLM structural planning.
2. No fixture-specific production hacks.
3. No structural repair loop.
4. No second LLM call for copy repair.
5. No duplicated decision ownership across prompt/validator/Builder.
6. No Builder redesign to compensate for planner wording.
7. No extra canonical-input cleanup without explicit approval.
8. Structure must remain deterministic for identical input.
9. Copy quality must not become an availability gate.
10. Make one controlled change/test at a time.

---

## 16. Current status

### PROVEN

- deterministic Kubrick V2 planner implemented;
- canonical input cleanup implemented;
- exact primary coverage and chronology enforced;
- replay eligibility/placement implemented;
- midpoint placement implemented;
- Scene 5 and Scene 8 grouping implemented;
- duration candidate selection implemented;
- compact one-call copy payload implemented;
- deterministic copy fallback implemented;
- existing Builder compatibility retained;
- direct live planner tests pass at 5 / 8 / 16 / 32 / 50 / 75;
- 75-bet fixture passes with two missing replay URLs.

### LOCKED

- code owns structure;
- LLM owns copy only;
- exactly one Bedrock copy call maximum;
- no copy repair loop;
- no second model call;
- copy-stage failure falls back deterministically;
- prose quality remains non-fatal;
- existing vbeta1 AWS topology is reused;
- Builder remains downstream-compatible.

### REMAINING / PLANNED

- optional small prompt-only copy-quality refinement;
- continue Builder/rendered-HTML regression proof with the new real fixtures where useful;
- continue Normaliser integration toward canonical `bettings.json`;
- complete the full upload/orchestration/status/delivery product path when that work is resumed.

The planner should not be structurally redesigned unless new evidence demonstrates a real architectural defect.
