# Manual AWS CLI Smoke Tests

Last updated: 2026-09-18

Purpose: deployed AWS proof for the current Kubrick V2 planner while reusing the existing vbeta1-named backend resources.

All commands are Windows CMD-compatible unless stated otherwise.

## Environment

Account:

```text
134387458447
```

Region:

```text
ap-southeast-2
```

Planner Lambda:

```text
tab-recap-vbeta1-scene-planner
```

Storage:

```text
tab-recap-vbeta1
```

Jobs table:

```text
tab-recap-vbeta1-jobs
```

Planning queue:

```text
https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-planning
```

Rendering queue:

```text
https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-rendering
```

Bedrock model/profile:

```text
au.anthropic.claude-sonnet-4-5-20250929-v1:0
```

Current source-controlled planner timeout:

```text
240 seconds
```

Planning lease:

```text
300 seconds
```

The vbeta1 resource names are intentional. Do not create parallel vbeta2 AWS resources merely because the source repo is now TabAPIvbeta2.

## 1. Identity

```cmd
aws sts get-caller-identity --region ap-southeast-2
```

Expected account:

```text
134387458447
```

## 2. Primary direct planner test helper

Current helper:

```cmd
tests\tools\run-planner-test.cmd <size>
```

Examples:

```cmd
tests\tools\run-planner-test.cmd 5
tests\tools\run-planner-test.cmd 8
tests\tools\run-planner-test.cmd 16
tests\tools\run-planner-test.cmd 32
tests\tools\run-planner-test.cmd 50
tests\tools\run-planner-test.cmd 75
```

The script:

1. uploads the selected fixture to S3;
2. creates a fresh DynamoDB `RECEIVED` job;
3. creates a direct planner event;
4. invokes `tab-recap-vbeta1-scene-planner` at `$LATEST`;
5. requires returned status `RENDERING`;
6. downloads final `scene.json`;
7. writes a render-message file for optional manual Builder handoff.

It does not automatically send the rendering SQS message.

## 3. Latest direct live proof — PASS

All of the following were run against deployed `$LATEST` on 2026-09-18.

### 5 bets

Job:

```text
test-step10-5-20260918051253
```

Observed:

```text
status     = RENDERING
sceneCount = 8
```

Result: **PASS**

### 8 bets

Job:

```text
test-step10-8-20260918051209
```

Observed:

```text
status     = RENDERING
sceneCount = 11
```

Result: **PASS**

### 16 bets

Job:

```text
test-step10-16-20260918051457
```

Observed:

```text
status     = RENDERING
sceneCount = 16
```

Result: **PASS**

Note: this fixture remains the older retained baseline data set.

### 32 bets

Job:

```text
test-step10-32-20260918051624
```

Observed:

```text
status     = RENDERING
sceneCount = 20
```

Result: **PASS**

### 50 bets

Job:

```text
test-step10-50-20260918051812
```

Observed:

```text
status     = RENDERING
sceneCount = 25
```

Result: **PASS**

### 75 bets

Job:

```text
test-step10-75-20260918051948
```

Observed:

```text
status     = RENDERING
sceneCount = 27
```

Result: **PASS**

The 75-bet fixture deliberately had `replayUrl = null` at sequences 74 and 75. Planning still completed successfully.

## 4. Current direct-test acceptance statement

The deployed planner boundary is proven across:

```text
5 -> 8 -> 16 -> 32 -> 50 -> 75 bets
```

Current direct tests prove:

- canonical fixture acceptance;
- deterministic scene structure;
- Scene 5 / Scene 8 scaling;
- Scene 4 midpoint placement;
- replay selection;
- missing replay URL handling;
- 75-bet compact model payload;
- successful transition to `RENDERING`.

The tests do not prove perfect prose quality.

## 5. Current copy-quality note

Valid plans still occasionally contain awkward LLM wording.

Examples seen in live output:

```text
The block lost $45.
profit for the day day.
Backed 8 backed runners won their races.
delivered The bet made $2800 profit.
```

Do not convert these into planner hard failures.

If copy polish is attempted, keep it prompt-only first and compare 5- and 75-bet outputs.

## 6. Historical resilience proofs retained

Earlier live testing already proved these backend behaviours and the evidence remains useful:

- direct happy path;
- real planning-SQS happy path;
- duplicate/idempotent message handling;
- existing-scene recovery;
- expired planning lease recovery;
- invalid bettings rejection;
- missing DynamoDB job rejection;
- final direct/SQS happy path.

Those tests were performed against earlier deployed planner generations. They demonstrate the surrounding S3/SQS/DynamoDB operating model, but they are not evidence that old LLM repair-loop behaviour still exists.

Kubrick V2 intentionally removed that old copy/plan repair architecture.

## 7. Planning queue operating decision

Current source-controlled queue policy remains intentionally conservative:

```text
VisibilityTimeout = 1440 seconds
maxReceiveCount   = 3
```

This favours non-overlapping redelivery over quick poison-message tests.

A permanent failure may take roughly 48+ minutes after the first failed receive to progress to the DLQ.

Verify live queue configuration when needed:

```cmd
aws sqs get-queue-attributes --queue-url https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-planning --attribute-names RedrivePolicy VisibilityTimeout --region ap-southeast-2
```

## 8. Optional manual Builder handoff

After a planner helper test passes, the generated render-message file can be sent manually:

```cmd
aws sqs send-message --queue-url https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-rendering --message-body file://PATH_TO_RENDER_MESSAGE.json --region ap-southeast-2
```

Do not send it automatically from the planner test helper.

## 9. Logging expectations

Normal planner happy path should contain the applicable events for:

- planning message accepted;
- job claimed;
- bettings validated;
- deterministic plan created/stored;
- one LLM copy request attempted;
- valid copy merged OR copy fallback used;
- final scene plan validated/stored;
- job moved to `RENDERING`.

Copy fallback is an availability path, not a second model attempt.

## 10. Current manual-test status

### PROVEN

- direct deployed planner at 5 / 8 / 16 / 32 / 50 / 75;
- 75-bet payload no longer exceeds model input;
- missing replay URLs are harmless;
- surrounding vbeta1 S3/Dynamo/SQS topology remains in use.

### RETAINED HISTORICAL EVIDENCE

- SQS idempotency/recovery/failure-path proofs from earlier Step-10 testing.

### REMAINING WHEN REQUIRED

- fresh full Builder/rendered-HTML proof using the new real fixtures;
- fresh poison-message/DLQ timing proof if that operational acceptance evidence is still required;
- any final end-to-end frontend/orchestrator/normaliser flow proof once those planned components are integrated.
