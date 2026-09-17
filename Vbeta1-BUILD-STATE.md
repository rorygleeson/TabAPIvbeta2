# TAB Daily Recap vbeta1 Build State

Last updated: 2026-09-14

## Proven build steps

### Steps 1–9
**PROVEN**

- vbeta1 repository created from the frozen `TabAPIv3` baseline.
- GitHub Actions CI established.
- Manual deploy workflow established.
- GitHub OIDC and restricted deploy role proven.
- Private S3 storage proven.
- DynamoDB jobs table proven.
- Planning SQS queue + DLQ proven.
- Scene-planner Lambda infrastructure proven.
- SQS -> Scene Planner invocation path proven.

## Step 10 — Fresh LLM scene generation

**IN PROGRESS.**

The existing deployed Kubrick / Scene Planner has already passed direct, SQS, recovery, idempotency and invalid-input tests. Successful jobs intentionally stop at `RENDERING` until the render queue/worker is introduced later.

A separate ten-item source/CI hardening audit has now been worked through. Items 1–9 are implemented and CI-proven; item 10 is the documentation cleanup represented by this update and is complete once its own CI run is green.

A second eight-finding pre-deployment audit was then run against the hardened Scene 8 path. Findings 1–6 were corrected in source/tests, Finding 7 was explicitly accepted as a bounded semantic-only quality risk, and Finding 8 now has an explicit pilot operating decision: **retain `VisibilityTimeout=1440` seconds and `maxReceiveCount=3`**. No queue values are being reduced merely to make the DLQ test faster.

**Do not confuse source/CI proof with AWS deployment proof.** The latest hardening changes have not yet been deployed to AWS.

### Current deployed AWS baseline

The currently deployed planner is still the older live baseline used for the successful Step 10 tests below. In particular, live AWS has not yet been updated to the new source targets of:
- Planner Lambda timeout: 240 seconds.
- Planning SQS visibility timeout: 1440 seconds.
- Planning SQS redrive count: `maxReceiveCount=3` retained for the pilot.
- Latest Scene 8 headline category/diversity/meaning enforcement and repair orchestration.
- Latest optional-call remaining-time guard and bounded optional Bedrock timeout.

Those capabilities are source/CI-proven only until deployment and live verification.

### Current live Step 10 evidence

- Direct happy path: **PASS**.
- Real SQS happy path: **PASS** — `test-step10-sqs-75-20260913071119`.
- Duplicate/idempotency: **PASS** — duplicate did not rewrite state or rerun Bedrock.
- Existing-scene recovery: **PASS** — `test-step10-existing-scene-20260913072355`; existing valid scene recovered without Bedrock.
- Expired planning lease recovery: **PASS** — `test-step10-expired-lease-20260913072844`; stale lease reclaimed and completed to `RENDERING`.
- Invalid bettings failure: **PASS** — `test-step10-invalid-bettings-20260913081923`; bad `profitLoss` rejected and job ended `FAILED` with deterministic error.
- Missing job failure: **PASS** — `test-step10-missing-job-20260913082450`; invocation failed and planner did not auto-create the DynamoDB row.
- Final hardened direct pass on the previously deployed baseline: **PASS** — `test-step10-final-direct-20260913083410`.
- Final hardened SQS pass on the previously deployed baseline: **PASS** — `test-step10-final-sqs-20260913083816`.
- Retry / DLQ proof on the older live queue configuration: **IN PROGRESS / HISTORICAL ONLY** — poison job `test-step10-dlq-20260913083000`, message `f0eefad6-de29-4943-8c47-0990d30ac9bb`.

The outstanding poison-message test started against the older live queue configuration with `VisibilityTimeout=1080` and `maxReceiveCount=3`. First failure was observed at `2026-09-13T08:33:33Z` with `Job test-step10-dlq-20260913083000 does not exist.` Because the final source decision is now 1440/3, that older poison test is historical evidence only; final Step 10 acceptance requires a fresh retry/DLQ proof after the source-controlled queue configuration is deployed.

Step 10 is not complete until the fresh retry/DLQ proof and the new hardened-planner live proof are both recorded and explicitly accepted.

## Ten-item Step 10 hardening audit

Detailed status is maintained in `docs/STEP10-SCENE8-AUDIT-10-ISSUES.md`.

Source/CI-proven corrections now include:

1. Planner timeout / queue visibility alignment: source target is 240s Lambda / 1440s SQS visibility.
2. Remaining-time guards before optional Scene 8 repair and optional Scene 4 narration.
3. Cents-safe Scene 8 grouped exposure, pre-block P&L eligibility and stake-pattern comparisons, plus fail-closed category eligibility.
4. Deterministic headline/category meaning checks where a safe factual anchor exists, with an explicit semantic boundary for categories that still require prompt/live inspection.
5. Contract clarification that headline diversity/meaning is a soft post-hard-validation quality gate with safe fallback.
6. Canonical `scene-contracts.json` boundary aligned to one hard repair/regeneration plus separate optional Scene 8 and Scene 4 calls.
7. Builder independently checks Scene 8 target-duration eligibility and exact Scene 4 midpoint/checkpoint consistency.
8. End-to-end `processMessage()` orchestration regression tests cover successful headline repair and invalid-repair fallback while protecting non-headline structure.
9. CI deploy-package smoke test now actually loads packaged `index.js` and verifies the Lambda `handler` export.
10. Build-state documentation no longer relies on fragile permanently-current HEAD/CI claims and clearly separates source proof from live AWS proof.

## Second Step 10 pre-deployment audit

Detailed findings are maintained in `docs/STEP10-SECOND-PREDEPLOY-AUDIT.md`.

Current resolution state:
- Findings 1–6: corrected in source/tests and individually CI-proven.
- Finding 7: resolved by explicit semantic-risk acceptance in `docs/STEP10-FINDING7-SEMANTIC-RISK-ACCEPTANCE.md`.
- Finding 8: resolved by pilot operating decision — keep `VisibilityTimeout=1440` and `maxReceiveCount=3`.

### Finding 8 operating decision

For the pilot, keep the planning queue at **1440 seconds visibility** with **`maxReceiveCount=3`**.

This deliberately accepts slow poison-message progression. With three receives, a permanently failing message may take roughly 48+ minutes after the first failed receive before it reaches the DLQ, excluding processing and trigger scheduling overhead. The 300-second DynamoDB planning lease does not shorten SQS invisibility.

The queue will **not** be shortened solely to speed testing. The 1440-second visibility is six times the 240-second Lambda timeout target, providing a conservative buffer against overlapping redelivery while a long planner invocation is still running. `maxReceiveCount=3` gives the initial attempt plus two retries before dead-lettering, which is acceptable for the small internal pilot.

Final post-deployment proof must verify the live queue is actually 1440/3, submit a fresh poison message, observe the expected repeated failures, and confirm that exact message eventually lands in `tab-recap-vbeta1-planning-dlq`. This deliberate latency is part of the acceptance test, not a reason to alter production-like queue safety settings.

## Scene 8 headline-quality behaviour in source

The hardened source flow is:

fresh plan -> hard deterministic validation/repair -> deterministic Scene 8 eligibility/diversity/meaning check using pre-result `bettings.json` facts -> at most one headline/category-only optional repair -> full plan revalidation + quality re-check -> safe fallback to the original hard-valid plan if the optional quality repair cannot be used -> optional Scene 4 final narration.

The headline-only repair cannot intentionally modify scene order, scene types, bet grouping, comments, Scene 4, replay placement, duration logic or P&L fields. CI now contains orchestration tests specifically protecting that boundary.

Fresh Scene 8 generation is still expected to emit `headlineCategory` and follow the taxonomy/diversity policy. The quality gate is intentionally non-fatal after hard validation, so time-budget exhaustion or invalid optional repair can fall back without discarding an otherwise hard-valid recap plan.

## Headline wording proof boundary

Deterministic source checks now verify category meaning for factual categories where the relationship can be proven safely from supplied data. Categories whose meaning is more semantic remain prompt-enforced rather than being reduced to brittle string heuristics.

Therefore the future live 75-bet acceptance test must inspect both:
- `headlineCategory` distribution/eligibility; and
- the **actual headline wording** for genuine variety and category match.

Category counts alone are not sufficient live proof.

## Planner hardening already proven live before the latest audit changes

Previously deployed behaviour already includes validated private-S3 `bettings.json`, Bedrock AU Claude Sonnet 4.5 planning, strict schema and deterministic semantic validation, factual-grounding enforcement, one-extra-call hard plan repair/regeneration limit, deterministic Scene 4 midpoint anchoring with separate final narration and safe fallback, Scene 2/5/8 chronological coverage, adaptive bounded duration with a 300-second hard maximum, idempotency, existing-scene recovery, planning lease ownership/reclamation, conditional S3 write protection, deterministic invalid-input failure, and no auto-creation of missing jobs.

The latest audit changes are **not yet claimed as deployed or live-proven**.

## Scene 4 status

Scene 4 midpoint behaviour on the existing deployed baseline is **PASS** and should not be changed without new concrete failure evidence. Recent 75-bet live output anchored Scene 4 at bet 39 with grounded completed-day facts and a specific upcoming teaser while preserving no-future-result leakage.

Builder source now additionally enforces exact midpoint/checkpoint consistency independently of Planner generation; that new Builder guard is source/CI-proven and awaits future end-to-end deployment use with the renderer path.

## Scene 8 / bounded-duration status

Scene 8 Fast Results Run is implemented and proven in live large-day planning on the existing deployed baseline. Scene 2 covers 1 primary bet, Scene 5 covers 2–3, Scene 8 is planner-constrained to 4–5 when needed for duration, coverage remains chronological and exactly once, Scene 4 never splits a Scene 8 block, and the conservative hard maximum remains 300 seconds.

The original 75-bet live proof produced 13 Scene 8 blocks but exposed repetitive odds/price-style headlines. The new source hardening is designed to correct that quality problem without changing deterministic structure. A fresh 75-bet live proof is still required after deployment.

## Current CI gate

`.github/workflows/ci.yml` now validates planner/builder contracts and regression tests including:
- syntax and JSON parsing;
- canonical/builder contract parity;
- Scene 8 taxonomy/schema parity;
- Scene 8 diversity, eligibility, meaning and cents-safe money tests;
- optional-call time-budget and bounded-timeout tests;
- end-to-end headline-repair and worst-case orchestration tests;
- recovery-quality inspection tests;
- Builder independent Planner-invariant tests;
- required templates/baseline files; and
- a deploy-like Scene Planner package smoke test that loads the packaged bootstrap handler.

GitHub CI remains separate from live AWS deployment proof. A green main-branch run does not mean AWS has been updated.

## Final pre-deployment gate

Once the final Finding 8 documentation commit itself has a green CI run:

1. Perform one final source audit of the complete second-audit corrective set.
2. Confirm exact HEAD CI is green.
3. Only then deploy through the existing controlled deploy workflow.

No AWS deployment should occur before that final audit.

## Required post-deployment Step 10 proof

After the controlled deployment:

1. Verify live Scene Planner Lambda timeout is 240 seconds.
2. Verify live planning SQS visibility timeout is 1440 seconds and `maxReceiveCount=3`.
3. Verify the deployed planner package starts/loads correctly.
4. Run a **fresh** 75-bet test using the newly deployed hardened planner.
5. Inspect every Scene 8 `headlineCategory` and actual `headline` wording.
6. Confirm category distribution, factual eligibility, no-spoiler behaviour and wording/category match, including manual inspection of the three accepted semantic-only categories.
7. Confirm primary chronological coverage, grouping, Scene 4 placement and duration remain correct.
8. Inspect logs for whether optional headline repair ran, was skipped, aborted or fell back.
9. Run a fresh poison-message retry/DLQ proof under the final 1440/3 queue configuration and wait for the real redrive progression.
10. Update `tests/manual-cli-tests.md` and this build-state document with the new live evidence.
11. Explicitly accept Step 10 before moving on.

## Next user-designated step

**Step 11 is the Planner prompt simplification experiment. It has NOT started.**

The aim is to shorten `contracts/planner-prompt.md` so contracts/code remain the machine-enforced law while the prompt concentrates on grounding, no-spoiler safety, story judgement, Scene 8 category allocation/wording quality and raw JSON discipline.

The v2.4 prompt remains the known-good baseline in Git history. No prompt experiment begins until Step 10 is live-proven and explicitly signed off.

### Architecture sequence after the prompt experiment

The older roadmap previously called the rendering queue "Step 11". That numbering is now superseded by the user-designated Step 11 prompt experiment. To avoid silently inventing a new architecture numbering scheme, the subsequent architecture components remain queued **without final renumbering** until Step 11 is complete:

- Rendering queue + DLQ.
- Render Lambda / deterministic Builder.
- Planner -> renderer handoff.
- Orchestrator Lambda.
- CSV ingestion / normalization.
- API Gateway.
- Pilot frontend.
- Pilot access control.
- Private recap delivery.
- Lifecycle cleanup.
- Tracking / observability.
- Final hardening.

Their new step numbers will be agreed before work resumes on that architecture sequence.

## Detailed CLI test record

The authoritative deployed-AWS test procedure and live evidence is maintained in `tests/manual-cli-tests.md`.
