# Kubrick V2 Migration

Last updated: 2026-09-19

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

The existing Builder, templates, runtime, S3/SQS/DynamoDB topology and vbeta1-named AWS resources remain intentionally reused. The POC adds an Orchestrator Lambda and API Gateway REST API while leaving the proven Planner/Builder contracts unchanged.

For current terminology, **Kubrick means the complete Orchestrator + Planner + Builder/Renderer backend service**. The CSV Normaliser is not part of Kubrick; it is an isolated sample client that produces canonical `bettings.json` and consumes the Kubrick API.

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
tab-recap-vbeta1-orchestrator
tab-recap-vbeta1-api
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
FACT_SEMANTIC_TEMPLATE_V1
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

Current rich protocol:

```text
groundingProtocol = FACT_SEMANTICS_V4_0
copyInputVersion = 4.0
```

The Bedrock request remains a compact projection:

```text
groundingProtocol = FACT_SEMANTIC_TEMPLATE_V1
modelPayloadVersion = 1.0
```

This compaction was required because the earlier rich 75-bet payload exceeded the model input limit.

The compact payload sends only scene-relevant phase-scoped facts and requested copy rules.

The earlier fact/text-part response encoding was itself too verbose at scale. Live evidence showed 32 bets completing at 5,706 output tokens, 50 bets completing generation at 7,614 tokens but falling back after an invented `BLOCK_MEETING_COUNT` atom reference, and 75 bets stopping at the configured 8,000-token ceiling. Compact grounded strings then reduced the live 75-bet response to 3,982 output tokens with `stopReason=end_turn` and no fallback. Semantic V4 keeps that grounded-string wire format while improving the meaning of the supplied atoms.

The model returns compact grounded strings such as `"<B3_RUNNER> finished <B3_FINISH>."`. Every `<ATOM_ID>` is validated against the deterministic phase scope and then substituted with the exact fact value.

The copy interface now follows one explicit ownership rule:

```text
code owns exact factual values + chronology + eligibility
LLM owns grammar + sentence construction + narrative colour
```

Model-facing atoms are typed exact values rather than complete customer sentences. P&L no longer uses signed scalar atoms: code exposes mutually exclusive unsigned `*_PROFIT_AMOUNT`, `*_LOSS_AMOUNT` or `*_BREAK_EVEN_AMOUNT` atoms. Returns use `*_RETURN_AMOUNT`; odds use `*_DECIMAL_ODDS`; prose-fragment `*_RACE_WIN` atoms are removed.

A compact deterministic semantic layer now accompanies the atoms. One recap-wide `semanticPolicy` states that race-action evidence is unavailable and replay narration is limited to supplied result facts. Scene-local semantic context is deliberately minimal and only carries meaning such as `raceWinner` and grouped `isFirstGroup/isFinalGroup`. Exact group start/end/remaining values remain fact atoms.

Historical-failure backfeed regression tests prove that the old ambiguous atoms are absent, bets 36-38 of the 75-bet fixture are explicitly non-final with 37 remaining, bets 74-75 are explicitly final, the 5-bet strongest-finish range is 3-5 with count 3 and $99 profit, and replay scenes carry the global result-facts-only evidence boundary.

JavaScript still does not repair prose. It validates placeholders, owns semantic classification and substitutes exact values.

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
- clumsy fact/grammar joins;
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

## Latest live backend proof

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

The automatic downstream handoff is also live-proven at 5, 50 and 75 bets:

```text
Planner -> rendering SQS -> Builder -> READY -> recap.html
```

The 50-bet end-to-end run exposed a missing Scene 4 future-count atom. `CHECKPOINT_BETS_REMAINING` was added to `PRE_FUTURE_RESULTS`; the rerun used real LLM copy and completed successfully.

The 75-bet proof confirms both the full Planner/Builder path and that missing replay URLs do not break planning.

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

## POC Orchestrator / API architecture

Kubrick is the complete backend service:

```text
Kubrick
  = Orchestrator
  + Planner
  + Builder / Renderer
```

The public client boundary is API Gateway + Orchestrator. Clients never call Planner or Builder/Renderer directly.

Locked API:

```text
POST /jobs
GET  /jobs/{jobId}
```

Both methods require the API Gateway `x-api-key` header. This is a shared POC key, not end-user authentication. The key value is never stored in GitHub or repository documentation.

### Admission contract to implement

Before job creation, the Orchestrator must synchronously:

```text
parse JSON
-> validate canonical schema
-> validate deterministic semantic invariants
-> reject invalid input directly
```

This admission work is deliberately local and deterministic; no Bedrock or external enrichment/API call belongs in this phase.

Only after validation succeeds may Kubrick generate a job ID and begin durable job creation. `202 Accepted` is returned only after:

```text
canonical input persisted
-> DynamoDB job created
-> Planning SQS submission confirmed
```

If any of those creation/handoff steps fail, the caller must not receive a successful `202`. Partial internal writes require cleanup/reconciliation and will be covered by the resiliency audit.

This strict admission behaviour is **documented/locked but not yet implemented** in the current Orchestrator source.

### POST /jobs

```text
canonical bettings.json
  -> API Gateway
  -> Orchestrator
       -> random UUID jobId
       -> working/<jobId>/bettings.json
       -> DynamoDB RECEIVED
       -> planning SQS
  -> HTTP 202 {jobId,status:"RECEIVED"}
```

The job ID is owned by the Orchestrator.

### Internal Kubrick path

```text
planning SQS
  -> Planner
  -> scene.json
  -> rendering SQS
  -> Builder / Renderer
  -> recaps/<jobId>/recap.html
  -> DynamoDB READY + recapS3Key
```

### GET /jobs/{jobId}

The Orchestrator reads the current DynamoDB state. Processing clients can observe `RECEIVED`, `PLANNING` and `RENDERING`. Terminal states are `READY` or `FAILED`.

When the job is `READY`, the Orchestrator generates a fresh short-lived S3 presigned URL from `recapS3Key` and returns it as `recapUrl`.

The presigned URL is never persisted in DynamoDB. Current TTL is 15 minutes.

The client consumption sequence is:

```text
produce canonical bettings.json
-> POST /jobs
-> retain jobId
-> poll GET /jobs/{jobId}
-> READY
-> consume recapUrl
```

The dedicated API contract is `docs/KUBRICK_API.md`.

### Normaliser relationship

The Normaliser remains isolated from Kubrick.

It is one sample client/use case:

```text
TAB account-history CSV
-> Normaliser
-> canonical bettings.json
-> Kubrick API
-> recapUrl
```

Other clients can consume Kubrick directly without using the Normaliser.

### Proof

The Orchestrator/API CloudFormation stack is deployed and the shared POC API key is configured.

`tests/tools/run-orchestrator-test.cmd` exercises both public endpoints:

```text
POST /jobs
GET /jobs/{jobId}
```

and then downloads the final HTML from the returned `recapUrl`.

Live API tests have succeeded across multiple fixture sizes up to the 75-bet maximum.

The soundtrack path is also live-proven after the existing CloudFront MP3 path was configured for CORS and the Builder runtime was changed to set `audio.crossOrigin='anonymous'` before the soundtrack `src`. No other Web Audio/Apple compatibility logic was redesigned.

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

- Kubrick service boundary is Orchestrator + Planner + Builder/Renderer;
- deterministic planner exists and is active source;
- canonical input cleanup complete;
- replay selection and missing-replay handling work;
- deterministic midpoint/grouping/coverage work;
- compact 75-bet model payload works;
- one-call copy circuit breaker works;
- Builder/Renderer downstream contract remains compatible;
- direct 5 / 8 / 16 / 32 / 50 / 75 planner tests pass;
- Planner automatically sends rendering SQS messages;
- Planner -> rendering SQS -> Builder/Renderer -> READY is live-proven;
- Orchestrator/API stack is deployed;
- API Gateway shared-key POC access is configured;
- both `POST /jobs` and `GET /jobs/{jobId}` are live-proven through the orchestrator harness;
- public API -> Orchestrator -> Planner -> Builder/Renderer -> READY -> presigned `recapUrl` is live-proven across multiple sizes up to 75 bets;
- final recap HTML has been opened/checked from live API outputs;
- soundtrack playback is live-proven with the existing CloudFront MP3 path plus anonymous CORS mode.

### LOCKED

- Kubrick means the complete Orchestrator + Planner + Builder/Renderer service;
- Orchestrator is the only public Kubrick Lambda boundary;
- Planner and Builder/Renderer remain internal implementation components;
- LLM is copywriter only;
- code owns structure;
- one LLM copy call maximum;
- no repair loop;
- deterministic fallback on copy-stage failure;
- existing vbeta1-named backend topology reused;
- Builder/Renderer not redesigned;
- Orchestrator generates UUID job IDs;
- API surface is exactly `POST /jobs` and `GET /jobs/{jobId}`;
- both methods require API Gateway `x-api-key` for the POC;
- actual API key value is manually configured in AWS and never committed;
- `recapS3Key` is persisted while the presigned `recapUrl` is generated fresh on READY;
- the Normaliser is isolated and is only a sample client/use case, not a Kubrick component.
- strict Orchestrator admission now performs JSON parsing, canonical schema validation and shared deterministic semantic validation before job creation;
- Orchestrator-owned direct request failures now use stable `errorCode` envelopes with `requestId`;
- admission telemetry records payload size, bet count, validation duration and acceptance/rejection result;
- canonical semantic validation is shared from `shared/canonical-bettings-validator.js` and packaged into both Orchestrator and Builder Lambdas.

### IN PROGRESS / PLANNED

- define and test partial job-creation rollback/reconciliation before returning 202;
- complete the end-to-end resiliency audit covering API/Lambda timeouts, SQS visibility/retries/DLQs and DynamoDB terminal failure state;
- productionising the isolated Normaliser as a client remains a separate future step;
- future client applications may consume the same Kubrick API directly;
- production-grade user authentication/authorization can replace the shared POC API key later if required.

### TECH DEBT / CLEANUP

- Canonical contract files are currently duplicated under `lambda/builder-recap/contracts/`, while CI only checks that those copies have not drifted from `contracts/`.
- This creates manual synchronization work and can cause unrelated CI failures when a canonical contract is changed without updating the Builder copy.
- Future cleanup should make `contracts/` the single source of truth and have build/deploy packaging copy the required contracts into the Builder package automatically.
- Do not perform this cleanup during planner/copy-quality stabilization; treat it as a separate controlled change.


### Final V4 semantic hardening — 2026-09-18

The final V4 copy interface adds three narrow safeguards without changing planner structure, Builder inputs, validation philosophy or the one-call/fallback architecture:

- return/P&L model-facing facts carry their semantic noun as indivisible text units (for example `$126 returned`, `$96 profit`, `$45 loss`), preventing correct amounts from being relabelled as the wrong financial concept;
- `replayEvidence=RESULT_FACTS_ONLY` explicitly limits replay labels/comments to supplied result facts and does not authorize invented race-running action;
- `oddsClassificationEvidence=NONE` means numeric decimal odds must not be converted into inferred favourite/outsider/longshot-style classifications.

The 75-bet CI model payload increased from 64,991 bytes to 66,459 bytes (+1,468 bytes, about 2.3%), remaining below the final V4 69,000-byte regression ceiling. CI remains green at 5 / 8 / 16 / 32 / 75 bets, including Builder and deterministic fallback compatibility.
