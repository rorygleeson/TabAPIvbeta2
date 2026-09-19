# Kubrick V2 Architecture Guide

> Authoritative architecture guide for the TAB Daily Recap Kubrick V2 migration.
>
> This document supersedes the old vbeta1 Kubrick planner design.

Last updated: 2026-09-19

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
raceId (optional; preserve only when genuinely supplied)
raceName
meeting
state
raceNumber
runnerId (optional; preserve only when genuinely supplied)
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

Canonical outcome/finish semantics are:

```text
result
- authoritative betting outcome for the wager: WIN or LOSS

finishingPosition
- preserve the TAB historical-results API value
- 0 = unplaced / exact finishing position not supplied by TAB
- 1+ = recorded finishing position supplied by TAB
- never infer or fabricate an exact finishing position
- finishingPosition does not determine or override result
```


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

Current rich internal grounding protocol:

```text
FACT_SEMANTICS_V4_0
copyInputVersion = 4.0
```

Current compact Bedrock payload protocol remains:

```text
FACT_SEMANTIC_TEMPLATE_V1
modelPayloadVersion = 1.0
```

Each scene receives only its relevant phase-scoped fact atoms and requested field rules. V4 also carries compact deterministic semantics: a single recap-wide evidence policy plus only the scene-local semantic classifications that cannot be represented safely as renderable values.

The model returns normal grounded strings containing compact fact references:

```json
"Backed <DAY_TOTAL_BETS> bets across <DAY_MEETING_COUNT> meetings."
```

For array fields such as Scene 8 comments, it returns one grounded string per required item.

The atom ownership rule is now explicit:

> **Code owns exact factual values and eligibility. The LLM owns grammar and storytelling.**

Model-facing fact atoms are exact typed values, not pre-written customer sentences. Counts are counts; stakes and returns are exact money values; P&L is exposed as unsigned typed atoms such as `*_PROFIT_AMOUNT` or `*_LOSS_AMOUNT`; odds use explicit `*_DECIMAL_ODDS` names; recorded finishing positions use exact ordinals, while canonical `finishingPosition=0` means `UNPLACED` and must never be rendered as `0TH`. Prose-fragment atoms such as `*_RACE_WIN = "won the race"` are not exposed.

Deterministic semantic context carries meaning that should not be rendered directly. The global policy states that race-action evidence is unavailable and replay copy is limited to supplied result facts. Scene-local semantics are intentionally small: for example `raceWinner` after a completed result, and `isFirstGroup/isFinalGroup` for grouped day-position wording. Exact group start/end/remaining values remain renderable fact atoms.

Standout sequence ranges are represented explicitly as `*_BET_RANGE` plus `*_BET_COUNT`, avoiding the earlier ambiguity where an end sequence could be mistaken for a count.

Every `<ATOM_ID>` reference is validated against the field's deterministic chronology scope and then substituted with the exact fact value. Unknown, wrong-phase or malformed placeholders reject the single copy response to deterministic fallback. JavaScript does not rewrite grammar or facts.

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
- clumsy fact/grammar joins
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

## 9. Kubrick service boundary and terminology

**Kubrick** is now the name for the complete recap-generation backend, not just the planner.

```text
Kubrick
  = Orchestrator Lambda
  + Planner Lambda
  + Builder / Renderer Lambda
```

Component ownership is explicit:

### Orchestrator

The Orchestrator owns the public service boundary:

- receives public API requests;
- generates the UUID `jobId`;
- stores canonical `bettings.json`;
- creates the initial DynamoDB job state;
- submits the planning SQS message;
- reads current job status;
- generates the fresh short-lived `recapUrl` when the job is READY.

### Planner

The Planner owns recap planning:

- validates canonical input;
- builds deterministic scene structure;
- selects replay, midpoint, grouping and duration;
- makes exactly one grounded Bedrock copy call;
- uses deterministic fallback for copy-stage failure;
- writes final `scene.json`;
- moves the job to `RENDERING`;
- submits the rendering SQS message.

### Builder / Renderer

The existing Builder is the Kubrick renderer. The terms **Builder** and **Renderer** refer to the same downstream Lambda responsibility:

- consumes canonical `bettings.json` and final `scene.json`;
- selects deterministic templates;
- renders the interactive HTML/CSS/JavaScript recap;
- handles runtime media behaviour;
- writes `recaps/<jobId>/recap.html`;
- stores `recapS3Key`;
- moves the job to `READY`.

The Builder/Renderer is not a second planner.

### Normaliser

The CSV Normaliser is **not part of Kubrick**.

It is an isolated sample client/use case that converts TAB account-history CSV data into canonical `bettings.json`, then calls Kubrick through the same public API as any other client.

Kubrick must not absorb CSV parsing, account-history interpretation or historical-results enrichment responsibilities.

---

## 10. Current AWS/runtime architecture

Kubrick deliberately reuses the existing vbeta1-named AWS environment.

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
API Gateway REST API  tab-recap-vbeta1-api
Lambda                tab-recap-vbeta1-orchestrator
Lambda                tab-recap-vbeta1-scene-planner
Lambda                tab-recap-vbeta1-builder-recap
SQS                   tab-recap-vbeta1-planning
SQS                   tab-recap-vbeta1-rendering
DynamoDB              tab-recap-vbeta1-jobs
S3                    tab-recap-vbeta1
Usage Plan            tab-recap-vbeta1-poc
```

The API key value is deliberately **not** stored in source or documentation. It is created/configured in API Gateway and attached to the POC usage plan. Clients currently provide it through the standard `x-api-key` header.

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

## 11. Public Kubrick API

The POC public API surface is deliberately small and locked:

```text
POST /jobs
GET  /jobs/{jobId}
```

Base URL:

```text
https://fbhuqhy5cf.execute-api.ap-southeast-2.amazonaws.com/poc
```

Both methods require:

```http
x-api-key: <POC API KEY>
```

The shared key is POC access control/throttling, not end-user identity. The actual value must never be committed to GitHub or repository documentation.

### Admission boundary

Before any Kubrick job begins, API Gateway and the Orchestrator provide a synchronous admission gate:

```text
API Gateway
  -> require valid x-api-key
  -> Orchestrator parses JSON
  -> canonical schema validation
  -> deterministic semantic validation
  -> only then create/queue the job
```

Admission validation is local deterministic work. It must not invoke Bedrock, enrichment APIs, historical APIs, Planner logic or rendering.

Canonical semantic validation is implemented once in `shared/canonical-bettings-validator.js` and packaged into both the Orchestrator and Builder Lambdas. The Orchestrator also packages the canonical root `contracts/bettings.schema.json` for admission schema validation.

The client waits for this initial decision:

```text
Orchestrator rejection -> direct HTTP errorCode, no jobId, do not poll
API Gateway rejection  -> direct Gateway HTTP error, no jobId, do not poll
accepted               -> HTTP 202 + jobId + RECEIVED, begin polling
```

API Gateway currently enforces the shared key and throttling before Lambda, but custom Gateway `GatewayResponse` mappings are not configured; clients must not assume those Gateway-owned 403/429 bodies use the same Kubrick JSON envelope as Orchestrator-owned errors.

`202 Accepted` is returned only after the canonical input is persisted, the DynamoDB job exists and Planning SQS has accepted the processing message.

If a persistence or queue-handoff step fails, the request must not be represented as successfully accepted. Partial internal state must be reconciled as part of Kubrick's resiliency behaviour.

### POST /jobs

The request body is canonical `bettings.json`.

The Orchestrator:

```text
generate UUID jobId
-> S3 working/<jobId>/bettings.json
-> DynamoDB RECEIVED
-> planning SQS
-> HTTP 202 {jobId,status:"RECEIVED"}
```

The client never generates the job ID.

### GET /jobs/{jobId}

The Orchestrator reads DynamoDB and returns the current state.

Processing responses contain:

```json
{
  "jobId": "...",
  "status": "PLANNING"
}
```

Client-visible lifecycle states can include:

```text
RECEIVED
PLANNING
RENDERING
READY
FAILED
```

When READY, the response contains a fresh presigned URL:

```json
{
  "jobId": "...",
  "status": "READY",
  "recapUrl": "https://..."
}
```

The current presigned URL lifetime is 15 minutes.

The URL itself is not stored in DynamoDB. `recapS3Key` is the stable persisted state; the Orchestrator generates a new URL on demand.

The detailed client contract is maintained in:

`docs/KUBRICK_API.md`

---

## 12. How a client consumes Kubrick

A Kubrick client only needs to understand the canonical input contract and the two HTTP endpoints.

```text
1. Produce canonical bettings.json.
2. POST /jobs with x-api-key and wait for synchronous admission.
3. If POST is rejected, handle the direct error and do not poll.
4. If POST returns 202 Accepted, retain the returned jobId.
5. Poll GET /jobs/{jobId} with x-api-key.
6. Continue while status is RECEIVED / PLANNING / RENDERING.
7. Stop and surface the error if status is FAILED.
8. When status is READY, read recapUrl.
9. Present the interactive recap to the user while the URL is valid.
```

Everything behind the API is abstracted from the client:

```text
Client
  |
  | POST /jobs
  v
API Gateway
  |
  v
Orchestrator
  |
  v
Planning SQS
  |
  v
Planner
  |
  v
Rendering SQS
  |
  v
Builder / Renderer
  |
  v
private recap.html
  |
  | GET /jobs/{jobId}
  v
Orchestrator -> fresh recapUrl -> Client
```

Clients do not need direct access to S3, DynamoDB, SQS, Bedrock, Planner internals, templates or Builder internals.

The isolated CSV Normaliser is simply one example:

```text
TAB CSV
-> isolated Normaliser
-> canonical bettings.json
-> Kubrick POST /jobs
-> poll Kubrick status
-> recapUrl
```

Other future clients may be mobile apps, web apps, backend services, batch processes or other TAB systems.

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

The 5 / 8 / 32 / 50 / 75 fixtures use recent real historical Australian thoroughbred race facts with synthetic customer betting activity. The 16-bet fixture remains the older retained baseline dataset.

The 75-bet fixture deliberately has `replayUrl: null` on sequences 74 and 75 to prove missing replay media is harmless.

Planner structural tests pass at 5 / 8 / 16 / 32 / 50 / 75 bets.

The automatic backend handoff is live-proven:

```text
Planner
-> rendering SQS
-> Builder / Renderer
-> READY
-> recap.html
```

The public Kubrick API path is also live-proven through `tests/tools/run-orchestrator-test.cmd`.

That harness exercises **both** public endpoints:

```text
POST /jobs
GET /jobs/{jobId}
```

and then downloads the final `recap.html` using the returned `recapUrl`.

Live API tests have completed successfully across multiple fixture sizes up to the 75-bet maximum.

Strict bad-input admission is also live-proven. On 2026-09-19, `tests\\tools\\run-orchestrator-test.cmd 8 bad` returned HTTP 400 with `KUBRICK_INVALID_PAYLOAD`, a `requestId`, semantic validation `details`, no `jobId`, and no polling.

The soundtrack/media path is also proven after:

- configuring the existing CloudFront MP3 path to return CORS headers; and
- setting `audio.crossOrigin='anonymous'` before assigning the soundtrack `src`.

The existing Web Audio/runtime flow was otherwise left unchanged.

---

## 14. Copy-quality hardening

Live 5- and 75-bet tests proved the deterministic planner remained structurally stable, but exposed a systemic copy-interface problem: the old fact catalog mixed raw values, noun phrases and complete customer sentences. That gave both code and the LLM partial ownership of grammar and produced failures such as repeated nouns, sentence fragments and awkward sentence-atom joins.

The source implementation has now been hardened around one ownership boundary:

```text
code -> exact facts, chronology and eligibility
LLM  -> grammar, sentence construction and narrative colour
```

The model-facing catalog now prefers atomic values/small factual units. Live tests then exposed a second scaling problem in the verbose fact/text-part response encoding: 50 bets produced 7,614 output tokens and one invented atom ID, while 75 bets hit the configured 8,000 output-token ceiling and was truncated. The model response protocol has therefore been compacted to grounded strings using validated `<ATOM_ID>` placeholders. This preserves the same factual ownership while removing repeated `type/fact/id/text` JSON wrappers.

This is a copy-interface change only. It does not alter deterministic scene planning, grouping, replay policy, midpoint policy, Builder inputs or the one-call/fallback architecture.

The compact grounded-string protocol is now live-proven at 75 bets: the previous response hit the 8,000-token ceiling and truncated, while the compact response completed naturally at 3,982 output tokens with `stopReason=end_turn`, `fallbackUsed=false`, and 27 scenes reaching RENDERING.

Semantic V4 is implemented and live-tested. Regression backfeeding covers the historical failure classes: signed P&L wording, return-versus-profit confusion, race-win fragment atoms, strongest-finish range/count ambiguity, false final-group language, decimal-odds meaning and unsupported race-action storytelling.

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

- deterministic Kubrick V2 planner implemented and live-tested;
- canonical input cleanup implemented;
- exact primary coverage and chronology enforced;
- replay eligibility/placement implemented;
- midpoint placement implemented;
- Scene 5 and Scene 8 grouping implemented;
- duration candidate selection implemented;
- compact one-call copy payload implemented;
- semantic V4 copy interface live-tested;
- deterministic copy fallback implemented;
- Planner automatically sends the rendering SQS message;
- Builder consumes the rendering message and writes `recaps/<jobId>/recap.html`;
- DynamoDB transitions through `RENDERING` to `READY`;
- end-to-end Planner -> rendering SQS -> Builder is live-proven at 5, 50 and 75 bets;
- 75-bet fixture passes with two missing replay URLs.

### LOCKED

- code owns structure;
- LLM owns copy only;
- exactly one Bedrock copy call maximum;
- no copy repair loop;
- no second model call;
- copy-stage failure falls back deterministically;
- prose quality remains non-fatal;
- existing vbeta1-named AWS backend topology is reused;
- Builder remains downstream-compatible;
- Orchestrator generates UUID `jobId`;
- public POC API is `POST /jobs` plus `GET /jobs/{jobId}`;
- both API methods require API Gateway `x-api-key`;
- the API key value is created manually in AWS and is never stored in source;
- the Normaliser remains decoupled and is not part of the API contract;
- DynamoDB stores stable `recapS3Key`, not a pre-signed URL;
- `GET /jobs/{jobId}` generates a fresh short-lived recap URL when status is `READY`.

### PROVEN — public API/admission boundary

- `tabapivbeta1-orchestrator` is deployed;
- the shared POC API key is attached to the usage plan;
- public `POST /jobs` and `GET /jobs/{jobId}` are live-proven;
- accepted jobs have reached `READY` and returned presigned URLs that download the final recap;
- strict admission is live-proven for a semantic mismatch: HTTP 400 + `KUBRICK_INVALID_PAYLOAD` + `requestId` + validation `details` + no `jobId`;
- the shared canonical semantic validator is packaged into both Orchestrator and Builder;
- the Orchestrator packages the root canonical `contracts/bettings.schema.json` and validates schema before semantic rules.

### IN PROGRESS / PLANNED

- complete partial job-creation cleanup/reconciliation for failures after S3/DynamoDB writes but before successful Planning SQS handoff;
- complete the end-to-end resiliency audit for Lambda timeouts, SQS visibility/retries/DLQs and stuck non-terminal DynamoDB states;
- API Gateway key/throttle rejection is enforced before Lambda, but custom Gateway-owned Kubrick JSON error envelopes are not currently configured.

The planner/Builder path should not be structurally redesigned unless new evidence demonstrates a real architectural defect.

## Appendix A. Scene Template Variable Ownership Mapping

This appendix documents the actual Builder/template boundary. It describes the variables rendered into each canonical scene template and identifies whether each value comes from validated `bettings.json`, deterministic Builder/runtime calculation, or LLM-generated copy in the final `scene.json`.

Source categories used below:

- **BETTINGS** — read directly from validated `bettings.json`.
- **BETTINGS DERIVED** — deterministically formatted or calculated by Builder from `bettings.json`.
- **BUILDER / RUNTIME** — generated from scene position, runtime contracts, deterministic Builder logic, controlled constants or runtime timing/FX behaviour.
- **LLM** — generated by the one-call copy stage, validated, grounded and merged into final `scene.json`.

### Scene 1 — Opening / Pre-race

Template: `templates/scene-1-opening-pre-race-template.html`

| Template variable | Ownership | Resolution |
| --- | --- | --- |
| `sceneInstanceId` | BUILDER / RUNTIME | Unique rendered scene instance ID |
| `sceneDurationMs` | BUILDER / RUNTIME | Scene 1 duration from runtime contract |
| `dateDisplay` | BETTINGS DERIVED | `day.date` formatted for display |
| `userName` | BETTINGS | `user.firstName` |
| `totalBets` | BETTINGS | `summary.totalBets` |
| `totalStakedDisplay` | BETTINGS DERIVED | `summary.totalStaked` formatted as currency |
| `meetingCount` | BETTINGS DERIVED | Count of unique meetings |
| `meetingJourney` | BETTINGS DERIVED | Unique meeting names in chronological first-appearance order |
| `openingTeaser` | **LLM** | Opening recap copy |
| `closingHook` | BUILDER / RUNTIME | Controlled constant: `LET'S RUN IT BACK.` |

LLM contribution: `openingTeaser`.

### Scene 2 — Single-race card

Template: `templates/scene-2-single-race-card-template.html`

| Template variable | Ownership | Resolution |
| --- | --- | --- |
| `sceneInstanceId` | BUILDER / RUNTIME | Unique rendered scene instance ID |
| `resultKind` | BETTINGS DERIVED | Deterministic `WIN` / `LOSS` |
| `fxPackage` | BETTINGS DERIVED | Deterministic win/loss/comeback/big-win FX package |
| `sceneDurationMs` | BUILDER / RUNTIME | Scene 2 duration from runtime contract |
| `meetingRace` | BETTINGS DERIVED | Meeting + race number |
| `userName` | BETTINGS | `user.firstName` |
| `horseName` | BETTINGS | `runnerName` |
| `stakeDisplay` | BETTINGS DERIVED | Stake formatted as currency |
| `betType` | BETTINGS | Canonical wager type |
| `oddsDisplay` | BETTINGS DERIVED | Decimal odds formatted for display |
| `tensionLine` | **LLM** | Pre-result copy |
| `finishingPositionText` | BETTINGS DERIVED | Recorded ordinal, or `UNPLACED` when canonical `finishingPosition=0` |
| `betResult` | BETTINGS | Canonical wager outcome |
| `reactionLine` | **LLM** | Post-result copy |
| `previousRunningPnl` | BETTINGS DERIVED | Running P&L before current bet |
| `runningPnl` | BETTINGS | Current running P&L |
| `raceTimeDisplay` | BETTINGS DERIVED | Race time formatted in recap timezone |
| `pnlSignClass` | BETTINGS DERIVED | `positive`, `negative` or `zero` |
| `runningPnlDisplay` | BETTINGS DERIVED | Display-formatted running P&L |

LLM contribution: `tensionLine`, `reactionLine`.

### Scene 3 — Race replay

Template: `templates/scene-3-race-replay-template.html`

| Template variable | Ownership | Resolution |
| --- | --- | --- |
| `sceneInstanceId` | BUILDER / RUNTIME | Unique rendered scene instance ID |
| `replayStartMode` | BUILDER / RUNTIME | Replay start mode from runtime contract |
| `replayStartRatio` | BUILDER / RUNTIME | Replay start ratio from runtime contract |
| `replayClipSeconds` | BUILDER / RUNTIME | Replay clip length from runtime contract |
| `replayLabel` | **LLM** | Replay label |
| `horseName` | BETTINGS | `runnerName` |
| `meetingRace` | BETTINGS DERIVED | Meeting + race number |
| `userName` | BETTINGS | `user.firstName` |
| `stakeDisplay` | BETTINGS DERIVED | Stake formatted as currency |
| `betType` | BETTINGS | Canonical wager type |
| `oddsDisplay` | BETTINGS DERIVED | Decimal odds formatted for display |

Scene 3 also places two values into the runtime manifest rather than direct HTML placeholders:

| Runtime value | Ownership | Resolution |
| --- | --- | --- |
| `replayUrl` | BETTINGS | Exact validated replay media URL |
| `replayComments[]` | **LLM** | Result-grounded replay comments |

LLM contribution: `replayLabel`, `replayComments[]`. The LLM never selects the replay media URL.

### Scene 4 — Status / Story summary

Template: `templates/scene-4-status-story-summary-template.html`

| Template variable | Ownership | Resolution |
| --- | --- | --- |
| `sceneInstanceId` | BUILDER / RUNTIME | Unique rendered scene instance ID |
| `checkpointTime` | BETTINGS DERIVED | Time of the last completed bet at the checkpoint |
| `userName` | BETTINGS | `user.firstName` |
| `pnlSignClass` | BETTINGS DERIVED | Sign class of checkpoint running P&L |
| `checkpointPnlDisplay` | BETTINGS DERIVED | Absolute checkpoint P&L display |
| `checkpointDirection` | BETTINGS DERIVED | `UP`, `DOWN` or `EVEN` |
| `betsCompleted` | BUILDER / RUNTIME | Deterministic number of primary bets completed before Scene 4 |
| `totalBets` | BETTINGS | `summary.totalBets` |
| `winnersSoFar` | BETTINGS DERIVED | Winning wagers completed by checkpoint |
| `bestWinSummarySoFar` | BETTINGS DERIVED | Deterministic best positive winning wager so far |
| `lookingBackStory` | **LLM** | Backward-looking checkpoint narrative |
| `lookingAheadTeaser` | **LLM** | Future-bet teaser with no future-result leakage |

LLM contribution: `lookingBackStory`, `lookingAheadTeaser`.

### Scene 5 — Multi-race scene

Template: `templates/scene-5-multi-race-scene-template.html`

Top-level variables:

| Template variable | Ownership | Resolution |
| --- | --- | --- |
| `sceneInstanceId` | BUILDER / RUNTIME | Unique rendered scene instance ID |
| `raceCount` | BUILDER / RUNTIME | Count of bets in `betSequences` |
| `setupKicker` | **LLM** | Pre-result setup copy |
| `setupHeadline` | **LLM** | Pre-result group headline |
| `payoffHeadline` | **LLM** | Post-result group headline |
| `contextLine` | **LLM** | Post-result supporting copy |
| `previousRunningPnlBeforeGroup` | BETTINGS DERIVED | Running P&L before the first grouped bet |
| `runningPnlAfterGroup` | BETTINGS | Running P&L after the final grouped bet |
| `pnlSignClass` | BETTINGS DERIVED | Sign class after group |
| `runningPnlDisplay` | BETTINGS DERIVED | Display-formatted post-group P&L |

The template loops over deterministic `races[]` rows:

| Race-row variable | Ownership | Resolution |
| --- | --- | --- |
| `outcomeClass` | BETTINGS DERIVED | Result class for styling |
| `raceIndex` | BUILDER / RUNTIME | Position inside the grouped scene |
| `fxPackage` | BETTINGS DERIVED | Deterministic FX package |
| `runningPnl` | BETTINGS | Running P&L after the bet |
| `raceTimeDisplay` | BETTINGS DERIVED | Race time display |
| `horseName` | BETTINGS | Runner name |
| `meetingName` | BETTINGS | Meeting |
| `raceNumber` | BETTINGS | Race number |
| `betType` | BETTINGS | Wager type |
| `stakeDisplay` | BETTINGS DERIVED | Stake display |
| `oddsDisplay` | BETTINGS DERIVED | Decimal odds display |
| `returnText` | BETTINGS DERIVED | Deterministic return text when return > 0 |
| `finishingPositionText` | BETTINGS DERIVED | Recorded ordinal, or `UNPLACED` when canonical `finishingPosition=0` |
| `betResult` | BETTINGS | Wager outcome |
| `betProfitLossDisplay` | BETTINGS DERIVED | Per-bet P&L display |

LLM contribution: `setupKicker`, `setupHeadline`, `payoffHeadline`, `contextLine`.

### Scene 6 — Daily summary

Template: `templates/scene-6-daily-summary-template.html`

| Template variable | Ownership | Resolution |
| --- | --- | --- |
| `sceneInstanceId` | BUILDER / RUNTIME | Unique rendered scene instance ID |
| `userName` | BETTINGS | `user.firstName` |
| `finalPnlSignClass` | BETTINGS DERIVED | Final P&L sign class |
| `finalPnlDisplay` | BETTINGS DERIVED | Final P&L display |
| `totalBets` | BETTINGS | `summary.totalBets` |
| `totalStakedDisplay` | BETTINGS DERIVED | Total staked display |
| `totalReturnedDisplay` | BETTINGS DERIVED | Total returned display |
| `winsLossesDisplay` | BETTINGS DERIVED | Deterministic wins/losses summary |
| `biggestWinSummary` | BETTINGS DERIVED | Deterministic biggest-win display |
| `dayVerdict` | **LLM** | Overall day verdict copy |
| `standoutCopy` | **LLM** | Copy for the selected standout |

The final scene plan also contains `standoutHighlightType`, chosen by the LLM from deterministic eligible options. It is control metadata rather than a direct HTML placeholder.

LLM contribution: `dayVerdict`, `standoutCopy`, plus selection of `standoutHighlightType`.

### Scene 7 — Final / Share

Template: `templates/scene-7-final-share-template.html`

| Template variable | Ownership | Resolution |
| --- | --- | --- |
| `sceneInstanceId` | BUILDER / RUNTIME | Unique rendered scene instance ID |
| `userName` | BETTINGS | `user.firstName` |
| `heroOutcomeClass` | BETTINGS DERIVED | Positive / negative / break-even final class |
| `finalHeroText` | BETTINGS DERIVED | Deterministic final P&L hero text |
| `resolvedFinalHighlights` | BETTINGS DERIVED + LLM selection | Builder resolves selected highlight IDs into deterministic factual text |
| `text` | BETTINGS DERIVED | Individual resolved highlight text |
| `finalSummary` | **LLM** | Final summary copy |
| `userNameUpper` | BETTINGS DERIVED | Upper-case first name |

Scene 7 also supplies `shareCaption` to runtime data rather than a direct HTML placeholder.

The LLM chooses `selectedFinalHighlights[]`, but Builder owns the actual displayed factual values for those cards.

LLM contribution: `finalSummary`, `shareCaption`, plus selection of `selectedFinalHighlights[]`.

### Scene 8 — Fast results run

Template: `templates/scene-8-fast-results-template.html`

Top-level variables:

| Template variable | Ownership | Resolution |
| --- | --- | --- |
| `sceneInstanceId` | BUILDER / RUNTIME | Unique rendered scene instance ID |
| `betCount` | BUILDER / RUNTIME | Number of bets in this Scene 8 block |
| `sceneDurationMs` | BUILDER / RUNTIME | Duration selected from runtime contract |
| `resultRevealMs` | BUILDER / RUNTIME | Deterministic reveal timing marks |
| `headline` | **LLM** | Pre-result block headline |

The template loops over deterministic `races[]` rows:

| Race-row variable | Ownership | Resolution |
| --- | --- | --- |
| `outcomeClass` | BETTINGS DERIVED | Result class |
| `raceIndex` | BUILDER / RUNTIME | Position in block |
| `runningPnl` | BETTINGS | Running P&L |
| `raceTimeDisplay` | BETTINGS DERIVED | Race time display |
| `horseName` | BETTINGS | Runner name |
| `meetingName` | BETTINGS | Meeting |
| `raceNumber` | BETTINGS | Race number |
| `betType` | BETTINGS | Wager type |
| `oddsDisplay` | BETTINGS DERIVED | Decimal odds display |
| `stakeDisplay` | BETTINGS DERIVED | Stake display |
| `finishingPositionText` | BETTINGS DERIVED | Recorded ordinal, or `UNPLACED` when canonical `finishingPosition=0` |
| `betResult` | BETTINGS | Wager outcome |
| `betProfitLossDisplay` | BETTINGS DERIVED | Per-bet P&L display |
| `comment` | **LLM** | One grounded result comment for that bet |

The LLM also returns `headlineCategory` as controlled copy metadata. It is validated but not rendered directly as an HTML placeholder.

LLM contribution: `headline`, one `comment` per bet, plus selection of `headlineCategory`.

### LLM ownership summary

The architecture can therefore be understood very simply: Claude does not build scenes. Deterministic code creates the scene structure and resolves nearly every displayed factual/runtime value. The LLM fills a small set of copy slots:

```text
Scene 1
  openingTeaser

Scene 2
  tensionLine
  reactionLine

Scene 3
  replayLabel
  replayComments[]

Scene 4
  lookingBackStory
  lookingAheadTeaser

Scene 5
  setupKicker
  setupHeadline
  payoffHeadline
  contextLine

Scene 6
  dayVerdict
  standoutCopy
  selects standoutHighlightType

Scene 7
  finalSummary
  shareCaption
  selects selectedFinalHighlights[]

Scene 8
  headline
  comments[]
  selects headlineCategory
```

This ownership mapping is the preferred mental model when reasoning about Kubrick V2: **code owns structure and factual rendering; the LLM fills a small number of grounded text slots.**
