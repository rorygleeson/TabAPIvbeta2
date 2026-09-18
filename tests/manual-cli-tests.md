# Manual AWS CLI Smoke Tests — Kubrick V2

Last updated: 2026-09-18

Purpose: deployed-AWS proof for the current deterministic Kubrick V2 planner using the intentionally reused vbeta1 AWS resources.

Commands are Windows CMD compatible.

## 1. Environment

Account:

```text
134387458447
```

Region:

```text
ap-southeast-2
```

Resources:

```text
Planner Lambda : tab-recap-vbeta1-scene-planner
Planning queue : tab-recap-vbeta1-planning
Planning DLQ   : tab-recap-vbeta1-planning-dlq
Rendering queue: tab-recap-vbeta1-rendering
Storage bucket : tab-recap-vbeta1
Jobs table     : tab-recap-vbeta1-jobs
```

Bedrock model/profile:

```text
au.anthropic.claude-sonnet-4-5-20250929-v1:0
```

Source-controlled planner configuration:

```text
Runtime       nodejs22.x
Memory        512 MB
Timeout       240 seconds
Planning lease 300 seconds
```

Planning queue operating policy remains conservative:

```text
VisibilityTimeout = 1440 seconds
maxReceiveCount   = 3
```

## 2. Important source/deployment rule

A GitHub commit is not deployment proof.

The deploy workflow runs from the `deploy` branch.

Before claiming live source equivalence, verify Lambda configuration and, where relevant, the deploy workflow run/commit.

## 3. Identity check

```cmd
aws sts get-caller-identity --region ap-southeast-2
```

Expected account:

```text
134387458447
```

## 4. Standard direct planner regression

Preferred command from repository root:

```cmd
tests\tools\run-planner-test.cmd 5
tests\tools\run-planner-test.cmd 8
tests\tools\run-planner-test.cmd 16
tests\tools\run-planner-test.cmd 32
tests\tools\run-planner-test.cmd 50
tests\tools\run-planner-test.cmd 75
```

The helper:

1. uploads `tests/fixtures/bettings-N.json`;
2. creates a `RECEIVED` job;
3. invokes the planner Lambda directly with no qualifier/alias, therefore `$LATEST`;
4. requires planner status `RENDERING`;
5. downloads `scene.json`;
6. writes a rendering-queue message file;
7. does not send that rendering message automatically.

## 5. Latest direct proof — PASS

On 2026-09-18:

| Bets | Job | Scene count | Status |
|---:|---|---:|---|
| 5 | `test-step10-5-20260918051253` | 8 | RENDERING |
| 8 | `test-step10-8-20260918051209` | 11 | RENDERING |
| 16 | `test-step10-16-20260918051457` | 16 | RENDERING |
| 32 | `test-step10-32-20260918051624` | 20 | RENDERING |
| 50 | `test-step10-50-20260918051812` | 25 | RENDERING |
| 75 | `test-step10-75-20260918051948` | 27 | RENDERING |

The 5 / 8 / 32 / 50 / 75 fixtures use the new real-race dataset.

The 16-bet test uses the retained older baseline fixture.

The 75-bet fixture deliberately has `replayUrl = null` at sequences 74 and 75. The planner still reached `RENDERING`.

## 6. Real SQS happy path

For a full queue-trigger proof, first create/upload the job exactly as the helper would, then send:

```cmd
aws sqs send-message --queue-url https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-planning --message-body "{"schemaVersion":"1.0","jobId":"JOB_ID","bettingsS3Key":"working/JOB_ID/bettings.json","testMode":true}" --region ap-southeast-2
```

Verify state:

```cmd
aws dynamodb get-item --table-name tab-recap-vbeta1-jobs --key "{"jobId":{"S":"JOB_ID"}}" --consistent-read --region ap-southeast-2
```

Expected successful final planner state:

```text
status = RENDERING
sceneS3Key = working/JOB_ID/scene.json
error absent/null
```

Historical SQS happy-path/idempotency/state recovery proofs were completed on the predecessor planner baseline. Re-run a fresh SQS proof after any material deployed orchestration/state-handling change.

## 7. Duplicate / idempotency proof

After a job has reached `RENDERING`, resend the same planning message.

Expected:

- status remains `RENDERING`;
- no second copy generation run;
- no overwrite of a valid completed scene;
- logs indicate already-complete/idempotent handling.

## 8. Existing-scene recovery

If a valid `working/JOB_ID/scene.json` already exists for a recoverable job, planner recovery should avoid unnecessary model work.

This path should be re-proven after any change to state recovery or storage ownership.

## 9. Expired planning lease recovery

A stale `PLANNING` job with an expired lease should be claimable by a new attempt.

Expected:

- old attempt ownership replaced;
- fresh lease written;
- successful run reaches `RENDERING`;
- temporary lease ownership fields cleared after success.

## 10. Invalid canonical input

A deliberately corrupted canonical input must still hard-fail.

Example corruption:

```text
bet 1 profitLoss does not equal return - stake
```

Expected:

- Lambda invocation fails;
- job becomes `FAILED`;
- no successful final `scene.json` is accepted.

Copy fallback does **not** apply to invalid canonical input.

## 11. Missing job

Invoking with a job ID not present in DynamoDB must fail and must not silently auto-create the job.

This remains a hard orchestration/state error.

## 12. Copy fallback proof

Copy failure is deliberately different from structural/input failure.

The planner permits exactly one Bedrock copy attempt.

If that attempt fails because of model invocation, parsing or copy-response validation, planner code must:

1. log a copy fallback event;
2. generate deterministic safe copy;
3. preserve the deterministic scene structure;
4. continue through final scene validation;
5. reach `RENDERING` if no non-copy hard failure exists.

There must be no second Bedrock call.

Relevant implementation:

```text
lambda/scene-planner/llm-copy-fallback.js
```

## 13. Compact 75-bet payload proof

The old rich copy payload once exceeded the model input limit at 75 bets.

Current Bedrock input is the compact projection:

```text
FACT_PARTS_COMPACT_V1
modelPayloadVersion = 1.0
```

The 2026-09-18 75-bet live pass demonstrates that the current compact path handles the full fixture successfully.

Do not revert to sending the full rich validation object to Bedrock.

## 14. Rendering handoff

The planner helper writes:

```text
tests\results\JOB_ID\render-message.json
```

To send it manually:

```cmd
aws sqs send-message --queue-url https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-rendering --message-body file://C:\Dev\TabAPIvbeta2\tests\results\JOB_ID\render-message.json --region ap-southeast-2
```

Then inspect Builder/DynamoDB/S3 output separately.

## 15. Missing replay media proof

Current canonical semantics:

```text
valid HTTPS replayUrl -> replay available
null replayUrl        -> replay unavailable
```

A null replay URL is not a planner failure.

Current deliberate test coverage:

```text
bettings-75 sequence 74 -> null
bettings-75 sequence 75 -> null
```

The 75-bet direct proof passed.

## 16. Current acceptance boundary

### PROVEN

- direct planner path at 5 / 8 / 16 / 32 / 50 / 75;
- large compact copy payload;
- real-data fixture handling;
- missing replay handling;
- deterministic scene structure;
- copy-stage availability fallback from prior targeted proof;
- existing AWS resource reuse.

### Re-run when relevant code changes

- real SQS happy path;
- idempotency;
- stale-lease recovery;
- existing-scene recovery;
- DLQ/poison-message flow;
- rendering-queue Builder handoff.

### Not a hard acceptance failure

Awkward copy such as grammar, repeated words or internal terminology must not be turned into a new hard planner validator.

If copy quality is refined, test it separately as a prompt/copy-quality change.
