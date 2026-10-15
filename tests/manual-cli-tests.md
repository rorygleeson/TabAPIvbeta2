# Manual AWS CLI Smoke Tests

Last updated: 2026-09-19

Purpose: deployed AWS proof for Kubrick while reusing the existing vbeta1-named backend resources.

Kubrick means the complete Orchestrator + Planner + Builder/Renderer backend service. The CSV Normaliser is an isolated sample client and is not part of Kubrick.

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

The script starts the selected fixture at the Planner boundary. The deployed Planner now sends the rendering SQS message automatically, so the harness can prove the downstream Builder/Renderer handoff and poll for the final `READY` state.

This is still a **direct Planner-boundary test**. It does not exercise API Gateway or the Orchestrator. Use the Orchestrator API harness below for public-service proof.

## 3. Public Kubrick API test helper

Use this harness to simulate the public client boundary:

```cmd
tests\tools\run-orchestrator-test.cmd <size> [good|bad]
```

Supported sizes:

```cmd
tests\tools\run-orchestrator-test.cmd 5
tests\tools\run-orchestrator-test.cmd 8
tests\tools\run-orchestrator-test.cmd 16
tests\tools\run-orchestrator-test.cmd 32
tests\tools\run-orchestrator-test.cmd 50
tests\tools\run-orchestrator-test.cmd 75
```

The second argument is optional. Omitting it means `good`.

Examples:

```cmd
tests\tools\run-orchestrator-test.cmd 8
tests\tools\run-orchestrator-test.cmd 8 good
tests\tools\run-orchestrator-test.cmd 8 bad
```

The deployed POC base URL is embedded in the harness. The only client secret is supplied locally through:

```text
TAB_RECAP_API_KEY
```

Never put the API key value in source or documentation.

### GOOD mode client simulation

```text
selected canonical fixture
-> POST /jobs
-> wait for synchronous admission result
-> require HTTP 202 + jobId + RECEIVED
-> poll GET /jobs/{jobId}
-> READY + recapUrl
-> download final recap.html
```

The harness prints the HTTP admission result, generated `jobId`, initial status, each polled lifecycle status and the final client action.

### BAD mode client simulation

BAD mode starts from the selected canonical fixture but **does not modify that fixture**.

It writes a temporary invalid payload under the test run's results directory by changing only:

```text
summary.totalBets
```

so it deliberately disagrees with:

```text
bets.length
```

The expected public-client journey is:

```text
POST /jobs
-> HTTP 400
-> errorCode KUBRICK_INVALID_PAYLOAD
-> no jobId
-> client stops
-> GET polling is skipped
```

If the invalid request is unexpectedly accepted with HTTP 202, the harness fails immediately and reports the unexpected `jobId`.

This keeps one test helper for both the successful and rejected client journeys while preserving all checked-in fixture files unchanged.

GOOD mode is already live-proven across multiple fixture sizes up to 75 bets. BAD mode is ready to prove the strict admission implementation once the Orchestrator change is deployed.

## 4. Latest direct live proof — PASS

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

## 5. Current direct-test acceptance statement

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

## 6. Current copy-quality note

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

## 7. Historical resilience proofs retained

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

## 8. Planning queue operating decision

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

## 9. Optional manual Builder handoff

After a planner helper test passes, the generated render-message file can be sent manually:

```cmd
aws sqs send-message --queue-url https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-rendering --message-body file://PATH_TO_RENDER_MESSAGE.json --region ap-southeast-2
```

Do not send it automatically from the planner test helper.

## 10. Logging expectations

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

## 11. Current manual-test status

### PROVEN

- direct deployed Planner at 5 / 8 / 16 / 32 / 50 / 75;
- automatic Planner -> Rendering SQS -> Builder/Renderer -> READY handoff;
- deployed Orchestrator + API Gateway public boundary;
- both `POST /jobs` and `GET /jobs/{jobId}`;
- API -> Orchestrator -> Planner -> Builder/Renderer -> READY -> `recapUrl`;
- public API runs across multiple fixture sizes up to 75 bets;
- final recap HTML download from returned presigned URL;
- 75-bet payload no longer exceeds model input;
- missing replay URLs are harmless;
- soundtrack playback after CloudFront CORS + anonymous soundtrack loading;
- surrounding vbeta1 S3/Dynamo/SQS topology remains in use.

### RETAINED HISTORICAL EVIDENCE

- SQS idempotency/recovery/failure-path proofs from earlier Step-10 testing.

### REMAINING WHEN REQUIRED

- fresh poison-message/DLQ timing proof if that operational acceptance evidence is still required;
- separate integration testing for any future real client application;
- separate Normaliser-to-Kubrick integration once the isolated sample Normaliser is productionised.


## CloudFront signed recap delivery (staged October 2026)

CloudFront delivery is prepared behind `RECAP_URL_PROVIDER`. Until explicitly switched, the Orchestrator still returns the original S3 presigned `recapUrl`. With `CLOUDFRONT`, the same READY response contains a 365-day CloudFront signed URL. The Normaliser consumes the same HTTPS `recapUrl` field without code changes. Refer to [`docs/CLOUDFRONT_SIGNED_URL_SETUP.md`](../docs/CLOUDFRONT_SIGNED_URL_SETUP.md) for manually configured AWS resources, secret permissions, origin-path mapping, validation and rollback. Signed links are bearer credentials, not user authentication.
