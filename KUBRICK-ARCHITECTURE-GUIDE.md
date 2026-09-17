# Kubrick Architecture Guide

> Detailed study guide for the TAB Daily Recap vbeta1 architecture, with emphasis on the Scene Planner (internally nicknamed **Kubrick**), contracts, templates, builder responsibilities, S3/DynamoDB/SQS flow, retries, leases and failure handling.

Last updated: 2026-09-13

---

## 1. The simplest mental model

The whole system can be understood as five layers:

1. **Facts** — `bettings.json` says what actually happened.
2. **Rules** — contracts and deterministic planner code define what is legal.
3. **Direction** — Kubrick decides how to tell the story and writes editorial copy.
4. **Presentation** — the builder combines the plan with authoritative facts and renders fixed templates.
5. **Reliability** — S3, DynamoDB and SQS make the async workflow durable, retryable and idempotent.

A useful shorthand is:

```text
bettings.json = factual truth
scene.json    = storyboard / editorial plan
templates     = visual shells
builder       = deterministic renderer
DynamoDB      = job state + ownership
SQS           = delivery + retry
S3            = durable artifacts
```

The core design principle is **single ownership of truth**. Facts are not duplicated into the scene plan when they can be looked up deterministically from `bettings.json`.

---

## 2. End-to-end target flow

The intended pilot flow is:

```text
User
  |
  v
Pilot web page / frontend
  |
  v
API Gateway                      [NOT BUILT YET]
  |
  v
Orchestrator Lambda              [NOT BUILT YET]
  |
  +--> create DynamoDB job row
  |       status = RECEIVED
  |
  +--> write normalized bettings.json to S3
  |
  +--> send planning message to SQS
          |
          v
Planning SQS
  tab-recap-vbeta1-planning
          |
          v
Kubrick / Scene Planner Lambda
  tab-recap-vbeta1-scene-planner
          |
          +--> claim job in DynamoDB
          |       RECEIVED -> PLANNING
          |
          +--> read bettings.json from S3
          |
          +--> validate bettings
          |
          +--> call Amazon Bedrock / Claude Sonnet
          |
          +--> canonicalize safe planner-owned placements
          |
          +--> validate full scene plan
          |
          +--> optionally repair/regenerate once
          |
          +--> place/finalize Scene 4 midpoint narration
          |
          +--> write scene.json to S3
          |
          +--> update DynamoDB
                  PLANNING -> RENDERING
          |
          v
Rendering SQS                    [STEP 11 - NOT BUILT YET]
          |
          v
Render Lambda                    [STEP 12 - NOT BUILT YET]
          |
          +--> read bettings.json
          +--> read scene.json
          +--> run deterministic builder
          +--> produce recap.html
          +--> write recap.html to private S3
          +--> update DynamoDB to READY
          |
          v
Private recap URL
```

The current project is still in **Step 10**. The planner itself is working strongly; formal resilience testing is still being completed before Step 11 begins.

---

## 3. What exists today vs what is simulated

### Already built and proven

- private S3 bucket: `tab-recap-vbeta1`
- DynamoDB jobs table: `tab-recap-vbeta1-jobs`
- planning queue: `tab-recap-vbeta1-planning`
- planning DLQ: `tab-recap-vbeta1-planning-dlq`
- Scene Planner Lambda: `tab-recap-vbeta1-scene-planner`
- Scene Planner execution role
- Amazon Bedrock invocation from the planner
- canonical contracts
- planner validation / repair / regeneration logic
- Scene 1-8 builder support
- Scene 1-8 production templates
- direct live tests producing `scene.json`
- CI regression gates

### Not built yet

- API Gateway
- Orchestrator Lambda
- CSV ingestion into normalized `bettings.json`
- rendering queue
- Render Lambda
- final browser delivery flow
- pilot access control
- lifecycle/cleanup policies
- final observability/hardening

### What the test scripts currently simulate

Because the Orchestrator does not exist yet, test tooling manually performs the work the Orchestrator will later own:

```text
1. create jobId
2. upload bettings.json to S3
3. create DynamoDB job row with status RECEIVED
4. invoke Lambda directly OR send SQS planning message
5. allow Scene Planner to take over
```

The goal of the upcoming SQS test is to stop invoking the planner directly and prove:

```text
SQS -> Scene Planner -> Bedrock -> scene.json -> DynamoDB RENDERING
```

---

## 4. S3 artifact model

The bucket is private. The planned object structure is:

```text
uploads/{jobId}/input.csv
working/{jobId}/bettings.json
working/{jobId}/scene.json
recaps/{jobId}/recap.html
```

### `input.csv`

Original uploaded user input. The future ingestion/orchestrator path will normalize it.

### `bettings.json`

The canonical factual input for the recap. This is the source of truth for bets and summary facts.

### `scene.json`

Kubrick's validated scene plan. It says **how to tell the story**, not a duplicated copy of all factual source data.

### `recap.html`

The final deterministic rendered recap.

---

## 5. `bettings.json` — the factual source of truth

`bettings.json` is the authoritative factual record used by both Kubrick and the builder.

Typical bet-level facts include things such as:

- sequence
- meeting
- race number
- race time
- runner name
- bet type
- stake
- odds
- result
- finishing position
- return
- profit/loss
- running P&L
- replay eligibility / replay URL

The summary contains deterministic whole-day facts such as:

- total bets
- wins / losses
- meetings
- total staked
- total returned
- final P&L
- biggest stake
- biggest win sequence
- biggest loss sequence
- highest-odds winner sequence

### Why the builder still needs `bettings.json`

The scene plan deliberately does not duplicate every factual field.

For example, Kubrick may produce:

```json
{
  "sceneType": 8,
  "betSequences": [35, 36, 37, 38, 39],
  "headline": "$585 ahead, $170 in play",
  "comments": [
    "Sixth, no show",
    "Runner-up at 21.00",
    "Autumn Note wins!",
    "Fifth, miss",
    "Dark Sapphire wins!"
  ]
}
```

That is a storyboard instruction. The builder then looks up bets 35-39 in `bettings.json` to render the authoritative runner, meeting, race, stake, odds, result, return, bet P&L and running P&L.

This avoids two competing copies of factual truth.

The design is therefore:

```text
bettings.json = what happened
scene.json    = what to show / say about what happened
```

---

## 6. Contracts — why there are several

There is intentionally no single giant contract. Different files own different concerns.

Canonical contract files live under:

```text
contracts/
```

The builder has bundled copies under:

```text
lambda/builder-recap/contracts/
```

CI verifies those copies cannot drift from the canonical root versions.

### 6.1 `bettings.schema.json`

Purpose: validate the structure of `bettings.json`.

It answers questions such as:

- are required fields present?
- are types correct?
- are values structurally valid?

The planner then performs additional semantic validation beyond JSON Schema, for example:

- sequences must be contiguous
- `profitLoss = return - stake`
- `runningPnl` must accumulate correctly
- summary totals must match the bets
- replay URLs must be valid HTTPS when supplied

### 6.2 `planner-prompt.md`

Purpose: editorial and behavioural instructions for Kubrick.

This is the high-level directing brief for the LLM. It covers concerns such as:

- which scene types are appropriate
- grounding all factual claims in validated data
- no external racing facts
- no prompt injection from user data
- no future-result leakage
- scene variety
- Scene 8 use
- Scene 4 behaviour
- concise prose
- raw JSON output

The prompt is important, but it is **not trusted as the only enforcement mechanism**. Deterministic code validates the model output afterward.

### 6.3 `scene-contracts.json`

Purpose: define what each scene type means and who owns each field.

The important ownership idea is that fields can come from different authorities, for example:

- **FACT** — copied from factual input
- **DERIVED** — calculated deterministically
- **LLM** — editorial prose generated by Kubrick
- **CONTROLLED** — planner/code-owned control values
- **RUNTIME** — values owned by runtime behaviour

This is central to the architecture. Kubrick is not allowed to invent values that belong to deterministic or factual layers.

### 6.4 `scene-plan.schema.json`

Purpose: validate the shape of `scene.json`.

It defines the legal JSON envelope and allowed structure for each scene type.

The current scene plan contract version is:

```text
planVersion: 2.0
```

There are exactly eight scene types.

### 6.5 `runtime-contract.json`

Purpose: define timing and playback behaviour.

Examples include:

- Scene 1 duration
- Scene 2 duration
- replay timing
- Scene 4 duration
- Scene 5 duration by race count
- Scene 8 duration by bet count
- transition duration
- target duration bands
- hard maximum duration

Kubrick uses duration guidance while planning, and both planner and builder can validate that a plan is feasible.

### 6.6 `template-contract-audit.md`

Purpose: document/audit the relationship between scene contracts and the production templates.

It exists so the scene/data contract and rendered HTML remain aligned.

---

## 7. Scene types 1-8

The current architecture has exactly eight scene types.

### Scene 1 — Opening

Opening teaser / setup for the day.

### Scene 2 — Single bet / race card

Used when one bet deserves individual treatment.

References one `betSequence`.

### Scene 3 — Replay

Optional replay scene. It is only legal when the referenced bet is replay eligible.

It must follow the matching Scene 2.

### Scene 4 — Midpoint status / story

Optional, at most once.

Important: the LLM does **not** own its final placement.

Kubrick's deterministic code places Scene 4 on the legal primary-scene boundary closest to 50% of the day's bets. It never splits a Scene 8 group just to hit exactly 50%.

After that placement is known, a narrow final Bedrock call writes the final midpoint narration from the exact checkpoint context.

The final Scene 4 context includes completed information such as:

- bets completed
- bets remaining
- current running P&L
- wins/losses so far
- last completed bet
- best completed win
- biggest completed loss
- previous rendered scene

For the look-ahead, the LLM receives only **pre-result facts** for the next primary block, so it cannot legally leak future results.

The final narrator is required to ground its text in concrete supplied facts rather than generic phrases.

### Scene 5 — Multi-race scene

Used for compact treatment of 2-3 consecutive bets.

### Scene 6 — Daily summary / verdict

Second-last scene. Whole-day summary and standout highlight.

### Scene 7 — Final share scene

Always last. Final summary, selected final highlights and share copy.

### Scene 8 — Fast Results Run

Used for 4-5 consecutive bets when needed to keep larger days within target duration.

Current planner rule:

```text
1 bet  -> Scene 2
2-3    -> Scene 5
4-5    -> Scene 8 when Scene 8 is allowed/needed by duration policy
```

Scene 8 is not simply a stylistic preference. Kubrick receives deterministic duration guidance that tells it whether Scene 8 is allowed for the current total bet count.

The builder/runtime still understands 2/3-row Scene 8 for compatibility, but Kubrick's current planning rule is 4-5 only.

---

## 8. What Kubrick actually does

Kubrick is the Scene Planner Lambda plus its contracts, deterministic validation and Bedrock calls.

It is not simply "send JSON to an LLM and trust the answer".

A normal fresh planning attempt roughly does this:

```text
1. accept planning message
2. read DynamoDB job
3. claim job
4. read bettings.json from S3
5. validate bettings schema
6. validate bettings semantics
7. calculate duration feasibility
8. check whether an existing valid scene.json can be recovered
9. call Bedrock for an initial plan
10. parse raw model JSON
11. apply safe deterministic canonicalization
12. validate schema + semantics + duration + narrative limits
13. if needed, use the one permitted repair/regeneration call
14. validate again
15. if Scene 4 exists, finalize Scene 4 narration after deterministic midpoint placement
16. validate final plan again
17. write scene.json to S3
18. mark DynamoDB RENDERING
```

---

## 9. What the LLM controls vs what deterministic code controls

This is one of the most important concepts in the system.

### Kubrick / LLM can decide

- scene mix within allowed rules
- which legal bets receive individual vs grouped storytelling treatment
- editorial emphasis
- headlines
- comments
- tension/reaction lines
- Scene 4 prose
- daily verdict prose
- final summary/share prose

### Deterministic code owns or validates

- factual source data
- bet chronology
- exact primary coverage 1..N
- Scene 1 first
- Scene 6 second-last
- Scene 7 last
- Scene 3 replay eligibility/attachment
- Scene 4 final checkpoint/placement
- Scene 8 eligibility by duration policy
- Scene 8 legal group sizes
- plan duration hard maximum
- word/character ceilings
- no markup in LLM prose
- schema correctness
- S3 object paths
- DynamoDB state transitions
- lease ownership
- idempotency/recovery logic

### Builder owns

The builder should not make new storytelling decisions.

Its job is:

```text
validated bettings.json
        +
validated scene.json
        +
fixed templates/runtime
        =
deterministic recap HTML
```

---

## 10. Safe canonicalization

Kubrick has a small deterministic canonicalization layer before final validation.

It intentionally only performs changes considered context-safe and lossless, such as:

- move the one Scene 1 to the front
- move the one Scene 6/7 pair to the final positions
- attach an eligible unique replay to its matching Scene 2 when coverage is already canonical
- remove any LLM-authored Scene 4 checkpoint
- calculate and set the real Scene 4 checkpoint
- move Scene 4 to the correct legal midpoint boundary

It deliberately does **not** reorder Scene 2/5/8 chronology or arbitrarily split/merge groups to repair a model plan.

That is important because chronology, running P&L and narration are context-sensitive.

---

## 11. Repair and regeneration policy

The planner is intentionally bounded so it does not enter an uncontrolled LLM loop.

Current rule:

```text
MAX_EXTRA_LLM_CALLS = 1
```

That one extra call applies to the main plan generation/repair path.

Examples:

- malformed JSON -> one complete regeneration may be attempted
- prose-only word/character/markup violations -> one field-scoped repair may be attempted
- structural/schema/coverage failures -> one complete plan repair may be attempted

The result is validated again after repair.

The final Scene 4 narration call is a separate narrow finalization call performed only after the main plan is already valid.

If final Scene 4 narration fails, the planner has a safe fallback: it retains and revalidates the already-valid provisional plan rather than failing the whole job solely because of the optional final narration pass.

---

## 12. Scene 4 final narration flow

Scene 4 deserves special attention because it demonstrates the hybrid LLM + deterministic design.

The initial LLM may include provisional Scene 4 copy, but at that point the final legal midpoint may not yet be known.

The planner then:

```text
initial scene plan
      |
      v
deterministic midpoint calculation
      |
      v
move/anchor Scene 4 at legal closest-to-50% boundary
      |
      v
construct exact checkpoint context
      |
      v
narrow final Scene 4 Bedrock call
      |
      v
replace only lookingBackStory / lookingAheadTeaser
      |
      v
validate final plan again
```

A recent successful 75-bet proof placed Scene 4 after bet 39 and produced grounded copy based on the real running position and the next pre-result block.

This is a good example of the intended architecture:

**code decides where; LLM decides how to say it.**

---

## 13. Builder / renderer

The vbeta1 builder evolved from the known-good TabAPIv3 renderer rather than replacing it.

Important files:

```text
lambda/builder-recap/index.js
lambda/builder-recap/recap-builder.js
lambda/builder-recap/recap-builder.test.js
lambda/builder-recap/templates/
lambda/builder-recap/runtime/
lambda/builder-recap/contracts/
```

The builder consumes both:

```text
bettings.json + scene.json
```

It validates both independently before rendering.

It supports all eight current scene types, including the dedicated Scene 8 template:

```text
lambda/builder-recap/templates/scene-8-fast-results-template.html
```

The builder is deliberately deterministic. Kubrick chooses the story; the builder renders that story against authoritative facts.

---

## 14. Templates

Production templates currently exist for all eight scene types:

```text
scene-1-opening-pre-race-template.html
scene-2-single-race-card-template.html
scene-3-race-replay-template.html
scene-4-status-story-summary-template.html
scene-5-multi-race-scene-template.html
scene-6-daily-summary-template.html
scene-7-final-share-template.html
scene-8-fast-results-template.html
```

Templates are visual/presentation assets. They should not become a second planner.

They receive values already chosen or derived elsewhere and render them consistently.

---

## 15. DynamoDB job state model

DynamoDB is not used as the factual source for scene content. It is the **job-state and ownership record**.

The intended main progression is:

```text
RECEIVED -> PLANNING -> RENDERING -> READY
                |
                +-> FAILED
```

### `RECEIVED`

The job exists and is ready for planning.

In the real future flow, the Orchestrator creates this record before sending the planning SQS message.

In current tests, the test script/manual setup creates it because the Orchestrator does not exist yet.

### `PLANNING`

A Scene Planner invocation has successfully claimed ownership of the job.

During planning, the row also carries:

```text
planningAttemptId
planningLeaseUntil
```

### `RENDERING`

Kubrick successfully produced and stored a valid `scene.json`.

The row includes the `sceneS3Key`.

Step 10 intentionally stops here because the render queue/worker is not built yet.

### `READY`

Future state after the renderer produces the final recap and delivery artifact.

### `FAILED`

A planner-owned error was caught and recorded. The error text is stored in the job row, and planning ownership fields are removed.

The current planner permits appropriate failed jobs to be reclaimed for a retry.

---

## 16. Why there is a planning lease

The planning lease exists mainly to recover safely from crashes or hard Lambda timeouts.

Current timing:

```text
Lambda timeout          = 180 seconds
Planning lease          = 300 seconds
SQS visibility timeout  = 1080 seconds
```

When a planner claims a job, it writes:

```text
status = PLANNING
planningAttemptId = <unique invocation ownership id>
planningLeaseUntil = <about 5 minutes ahead>
```

The `planningAttemptId` means "this particular planning attempt owns the job."

The lease means "if this owner disappears and does not finish, ownership eventually expires."

### Normal caught failure

If Bedrock or planner code throws an error while JavaScript is still running:

```text
try/catch executes
      |
      v
markFailed()
      |
      v
DynamoDB = FAILED
```

### Hard Lambda timeout

If AWS terminates the Lambda at the 180-second hard timeout, JavaScript does not get a chance to run its `catch` block.

DynamoDB may therefore remain:

```text
PLANNING
```

The lease prevents that state from remaining permanently owned by a dead invocation.

After 300 seconds the ownership is considered expired and a later retry is allowed to reclaim the job.

---

## 17. SQS planning queue behaviour

Planning queue:

```text
tab-recap-vbeta1-planning
```

DLQ:

```text
tab-recap-vbeta1-planning-dlq
```

Current key settings:

```text
visibility timeout = 1080 seconds
maxReceiveCount    = 3
```

### What SQS does

SQS is the delivery and retry mechanism for planning work.

A normal production message will conceptually contain:

```json
{
  "schemaVersion": "1.0",
  "jobId": "...",
  "bettingsS3Key": "working/<jobId>/bettings.json",
  "testMode": false
}
```

The planner validates that the key exactly matches the job ID.

### Successful processing

```text
SQS delivers message
      |
      v
Lambda succeeds
      |
      v
Lambda event-source integration deletes message
```

The caller does not receive `scene.json` as a synchronous SQS response.

Success is observed later through:

- S3: `scene.json` exists
- DynamoDB: job is `RENDERING`

### Failed processing

If the Lambda invocation fails, the message is not successfully deleted. After the visibility timeout it can become available for delivery again.

### Why visibility timeout is longer than Lambda timeout and lease

The relationship is intentional:

```text
180s Lambda timeout < 300s planning lease < 1080s SQS visibility timeout
```

Example hard-timeout sequence:

```text
00:00 message delivered
00:01 planner claims job; lease set ~5 minutes ahead
03:00 Lambda reaches hard timeout and dies
05:01 planning lease is expired
18:00 SQS visibility expires; message may be retried
18:00 retry sees old lease is long expired and can reclaim the job
```

This reduces the risk of two live planner attempts concurrently owning the same job.

---

## 18. DLQ behaviour

`maxReceiveCount = 3` means a poison message/job that repeatedly fails is eventually quarantined in the planning DLQ rather than retrying forever.

The DLQ is not the normal error store. It is the evidence/quarantine path for work that repeatedly cannot complete.

This is useful operationally because a failed job can then be inspected without endlessly hammering Bedrock or downstream systems.

Formal Step 10 DLQ proof is still outstanding.

---

## 19. Idempotency and duplicate handling

Distributed systems can deliver the same logical work more than once. The planner is designed around that reality.

### Duplicate arrives after planning is complete

If DynamoDB already says `RENDERING` or `READY` and has a valid `sceneS3Key`, the planner returns an idempotent completion rather than generating another plan.

### Duplicate arrives while planning is in flight

If the row is already `PLANNING` with a valid unexpired lease, the duplicate does not start another Bedrock request. It is treated as an in-flight duplicate.

### Existing `scene.json` recovery

If a planner invocation owns the job but discovers an existing valid `scene.json` in S3, it can validate/recover that artifact and move the job to `RENDERING` without paying for another fresh Bedrock generation.

### S3 write race

The planner uses a conditional write for `scene.json`. If another valid writer already created it, the planner can read and validate the existing artifact rather than blindly overwriting it.

---

## 20. Why the Lambda is not "public" just because CLI can invoke it

The Scene Planner currently does not need a public function URL.

When the AWS CLI invokes it, the path is conceptually:

```text
AWS CLI
  |
  v
AWS Lambda service HTTPS API
  |
  v
IAM authentication / authorization
  |
  v
lambda:InvokeFunction
  |
  v
Scene Planner Lambda
```

The public AWS service endpoint is reachable, but the individual function is not an unauthenticated public website.

Not being attached to a VPC does not automatically make a Lambda function public.

The Lambda execution-role trust policy is a separate concern: it lets the AWS Lambda service assume the execution role so the running function can access its permitted AWS resources.

---

## 21. IAM mental model

Two permission questions are easy to confuse.

### Who may invoke Kubrick?

Governed by the caller's IAM permissions and, where relevant, the Lambda resource policy.

The key API permission is:

```text
lambda:InvokeFunction
```

### What may Kubrick do after it starts?

Governed by the Scene Planner's execution role permissions.

Examples of required capabilities include access to:

```text
S3
DynamoDB
Bedrock
CloudWatch Logs
```

The execution role trust policy normally trusts:

```text
lambda.amazonaws.com
```

That says the Lambda service can assume the execution role. It does not itself mean that arbitrary users may invoke the function.

---

## 22. Duration planning and why Scene 8 exists

The recap is not allowed to grow indefinitely with the number of bets.

The runtime contract defines target duration bands and a hard maximum of 300 seconds.

Kubrick receives deterministic guidance including:

```text
totalBets
softMinimumSeconds
targetDurationSeconds
hardMaxSeconds
minimumFeasibleSeconds
minimumScene2And5Seconds
scene8Allowed
```

The key decision is whether a day can be represented using only Scene 2 and Scene 5 within the duration target.

If yes, Scene 8 is forbidden for planning.

If no, Scene 8 becomes available so 4-5 consecutive bets can be covered much more efficiently.

This keeps the LLM from deciding duration purely by intuition.

---

## 23. Current important runtime timings

The current runtime contract includes the following known timings used in planning/validation:

```text
Scene 1          14.0s
Scene 2           9.0s
Scene 4           8.0s
Scene 5 (2 bets) 10.4s
Scene 5 (3 bets) 13.3s
Scene 6           9.5s
Scene 7           0s timeline contribution
Scene 8 (4 bets)  8.0s
Scene 8 (5 bets)  9.5s
Transition         0.3s
```

The runtime retains Scene 8 duration definitions for 2/3 rows for compatibility even though Kubrick's current planner rule is 4-5 only.

Replay duration uses the runtime contract and conservative timeout allowances when the planner validates the hard maximum.

---

## 24. What `scene.json` looks like conceptually

A final plan is an ordered list of scene instructions:

```json
{
  "planVersion": "2.0",
  "scenes": [
    {
      "sceneType": 1,
      "openingTeaser": "..."
    },
    {
      "sceneType": 2,
      "betSequence": 1,
      "tensionLine": "...",
      "reactionLine": "..."
    },
    {
      "sceneType": 8,
      "betSequences": [2, 3, 4, 5, 6],
      "headline": "...",
      "comments": ["...", "...", "...", "...", "..."]
    },
    {
      "sceneType": 4,
      "lookingBackStory": "...",
      "lookingAheadTeaser": "...",
      "checkpointAfterBetSequence": 6
    },
    {
      "sceneType": 6,
      "dayVerdict": "...",
      "standoutHighlightType": "biggestWin",
      "standoutCopy": "..."
    },
    {
      "sceneType": 7,
      "selectedFinalHighlights": ["totalBets", "wins", "finalPnl"],
      "finalSummary": "...",
      "shareCaption": "..."
    }
  ]
}
```

The plan is not HTML. It is not the final recap. It is a validated storyboard contract consumed by the deterministic builder.

---

## 25. Current testing model

The main live planner test tool is:

```text
tests/tools/run-planner-test.cmd
```

It exercises the deployed AWS Scene Planner and stores downloaded results under:

```text
tests/results/<jobId>/
```

Those result artifacts are intentionally not committed to Git.

The fixture set includes several bet-count sizes so planner behaviour can be exercised at different duration/scene-mix boundaries.

Large live tests have already demonstrated:

- 75-bet full coverage
- Scene 8 groups of legal size
- Scene 4 midpoint anchoring
- grounded final Scene 4 narration
- plan storage
- DynamoDB transition to `RENDERING`

---

## 26. Step 10 resilience gate still to prove

Before Step 10 is signed off, the remaining focus is reliability rather than more prose tuning.

Required proofs:

1. **Real SQS happy path** — send a planning message to the queue and prove SQS-triggered generation reaches `RENDERING`.
2. **Duplicate/idempotency** — duplicate work does not trigger a second unnecessary plan.
3. **Existing scene recovery** — a valid existing `scene.json` can be recovered without regeneration.
4. **Expired lease recovery** — a stuck `PLANNING` job becomes reclaimable after lease expiry.
5. **Invalid bettings failure** — invalid factual input fails cleanly and records appropriate state.
6. **Missing job failure** — planner does not silently create or invent a job record.
7. **Retry / DLQ proof** — repeated unprocessable work eventually lands in the planning DLQ.

Only after these are proven should Step 10 be declared complete.

---

## 27. Build order from here

The project build sequence is intentionally incremental:

```text
1.  Create vbeta1 Repo                         PROVEN
2.  Create GitHub Actions CI Workflow          PROVEN
3.  Create Manual Deploy Workflow              PROVEN
4.  Configure GitHub OIDC to AWS               PROVEN
5.  Create AWS Deployment Role                 PROVEN
6.  Create Private S3 Storage                  PROVEN
7.  Create DynamoDB Jobs Table                 PROVEN
8.  Create Planning Queue + DLQ                 PROVEN
9.  Build Scene Planner Lambda                  PROVEN
10. Fresh LLM Scene Generation + Resilience    IN PROGRESS
11. Create Rendering Queue + DLQ                NOT STARTED
12. Build Render Lambda                         NOT STARTED
13. Connect Planner -> Renderer                 NOT STARTED
14. Build Orchestrator                          NOT STARTED
15. CSV Ingestion                               NOT STARTED
16. API Gateway                                 NOT STARTED
17. Frontend                                    NOT STARTED
18. Pilot Access                                NOT STARTED
19. Private Recap Delivery                      NOT STARTED
20. Lifecycle / Cleanup                         NOT STARTED
21. Tracking / Observability                    NOT STARTED
22. Final Hardening                             NOT STARTED
```

Do not jump ahead simply because a later component is interesting. The project rule is one controlled, proven change at a time.

---

## 28. Architecture principles worth remembering

### Facts are centralized

`bettings.json` is the factual truth. Do not create competing copies unnecessarily.

### LLM is constrained, not trusted blindly

Kubrick provides editorial intelligence, but schema, semantic, timing and ownership rules are enforced deterministically.

### Planner and renderer are separate concerns

Kubrick decides the story. The builder renders it.

### Async stages communicate through durable state

SQS messages trigger work; DynamoDB records job state; S3 stores durable artifacts.

### Every retry must be safe

Idempotency, leases, conditional writes and recovery logic exist because messages and invocations can happen more than once.

### The planner is backend-only

Kubrick does not need to become a public HTTP endpoint. The future public/front-door API should call the Orchestrator, not expose the planner directly.

### Preserve failed evidence

Failed jobs, logs, DLQ messages and artifacts are useful debugging evidence. Do not automatically erase them while the pilot is being hardened.

---

## 29. One-page study summary

If you only remember one flow, remember this:

```text
                         FUTURE FRONT HALF

User -> API Gateway -> Orchestrator
                         |
                         +--> DynamoDB: RECEIVED
                         +--> S3: bettings.json
                         +--> SQS: planning message

                         CURRENT CORE

Planning SQS
    |
    v
Kubrick / Scene Planner
    |
    +--> claim DynamoDB job: PLANNING + lease
    +--> read/validate bettings.json
    +--> Bedrock creates editorial plan
    +--> deterministic code validates/canonicalizes
    +--> final Scene 4 narration after real midpoint placement
    +--> S3 writes scene.json
    +--> DynamoDB: RENDERING

                         FUTURE BACK HALF

Rendering SQS -> Render Lambda
                      |
                      +--> read bettings.json
                      +--> read scene.json
                      +--> deterministic builder + templates
                      +--> S3 writes recap.html
                      +--> DynamoDB: READY
```

And remember the ownership split:

```text
BETTINGS.JSON
"What actually happened?"

KUBRICK / SCENE.JSON
"How should we tell the story?"

BUILDER + TEMPLATES
"Render that story consistently."

DYNAMODB + SQS + S3
"Make the whole workflow reliable."
```

---

## 30. Related repository files

For deeper study, start with these files:

```text
Vbeta1-BUILD-STATE.md
contracts/bettings.schema.json
contracts/planner-prompt.md
contracts/scene-contracts.json
contracts/scene-plan.schema.json
contracts/runtime-contract.json
contracts/template-contract-audit.md
lambda/scene-planner/index.js
lambda/scene-planner/index.test.js
lambda/scene-planner/scene4-narration.test.js
lambda/builder-recap/recap-builder.js
lambda/builder-recap/recap-builder.test.js
lambda/builder-recap/templates/
lambda/builder-recap/runtime/
tests/tools/run-planner-test.cmd
```

`Vbeta1-BUILD-STATE.md` should remain the project/status tracker.

This document should remain the architecture/study guide explaining how the pieces fit together and why they exist.
