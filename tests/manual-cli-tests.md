# Manual AWS CLI Smoke Tests

Purpose: deployed AWS proof for the vbeta1 backend. Commands are intentionally single-line Windows CMD commands.

## Preconditions

Target account: `134387458447`

Target region: `ap-southeast-2`

Planner Lambda: `tab-recap-vbeta1-scene-planner`

Planning queue: `https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-planning`

Planning DLQ: `https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-planning-dlq`

Storage bucket: `tab-recap-vbeta1`

Jobs table: `tab-recap-vbeta1-jobs`

Bedrock model/profile: `au.anthropic.claude-sonnet-4-5-20250929-v1:0`

Current source-controlled planner timeout target: `240` seconds. Planning lease remains `300` seconds. Verify the deployed Lambda reflects the timeout after the next deployment before running the new Scene 8 live proof.

Final pilot planning-queue operating decision: retain `VisibilityTimeout=1440` seconds and `maxReceiveCount=3`. This intentionally favours conservative non-overlapping redelivery over fast poison-message testing. A permanently failing message may take roughly 48+ minutes after its first failed receive to progress through the remaining receives and reach the DLQ. Do not shorten the queue solely to speed the test.

The Lambda role currently retains Bedrock `InvokeModel` and the scoped Marketplace entitlement permissions required during Step 10 diagnosis. IAM minimisation is a separate controlled cleanup after the full Step 10 resilience gate passes.

## A. Pre-deploy identity

```cmd
aws sts get-caller-identity --region ap-southeast-2
```

Expected account: `134387458447`.

## B. Direct happy path

Use a fresh job ID for every live LLM proof.

```cmd
aws dynamodb put-item --region ap-southeast-2 --table-name tab-recap-vbeta1-jobs --item "{\"jobId\":{\"S\":\"JOB_ID\"},\"status\":{\"S\":\"RECEIVED\"},\"bettingsS3Key\":{\"S\":\"working/JOB_ID/bettings.json\"},\"createdAt\":{\"S\":\"TIMESTAMP\"},\"updatedAt\":{\"S\":\"TIMESTAMP\"}}"
```

```cmd
aws s3 cp bettings.json s3://tab-recap-vbeta1/working/JOB_ID/bettings.json --region ap-southeast-2
```

```cmd
aws lambda invoke --region ap-southeast-2 --function-name tab-recap-vbeta1-scene-planner --cli-binary-format raw-in-base64-out --payload "{\"schemaVersion\":\"1.0\",\"jobId\":\"JOB_ID\",\"bettingsS3Key\":\"working/JOB_ID/bettings.json\",\"testMode\":true}" %TEMP%\step10-response.json
```

```cmd
aws dynamodb get-item --region ap-southeast-2 --table-name tab-recap-vbeta1-jobs --key "{\"jobId\":{\"S\":\"JOB_ID\"}}" --consistent-read
```

Expected: `status=RENDERING`, matching `sceneS3Key`, `error=NULL`.

Status: **PASS** from prior Step 10 direct live proofs.

## C. Real SQS happy path

```cmd
aws sqs send-message --region ap-southeast-2 --queue-url https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-planning --message-body "{\"schemaVersion\":\"1.0\",\"jobId\":\"JOB_ID\",\"bettingsS3Key\":\"working/JOB_ID/bettings.json\",\"testMode\":true}"
```

### Live result — PASS

Job: `test-step10-sqs-75-20260913071119`

Message: `3c86ab20-7a3c-4817-ac1c-7f10b394f346`

Observed:
- real SQS invocation claimed and processed the job;
- 75-bet fixture validated;
- one Scene 7 word-limit violation triggered the allowed single field-repair call;
- plan validated and stored;
- DynamoDB ended `RENDERING`, matching `sceneS3Key`, `error=NULL`;
- generated plan preserved complete 75-bet chronological coverage and remained below the 300-second hard maximum.

## D. Duplicate / idempotency

Resend the same SQS message after the job is already `RENDERING`.

### Live result — PASS

Job: `test-step10-sqs-75-20260913071119`

Duplicate message: `e9732210-810c-4403-9f2d-f6e04537f893`

Observed:
- DynamoDB remained `RENDERING`;
- `updatedAt` remained `2026-09-13T07:14:28.749Z`;
- logs contained `planning-message-already-complete`;
- no second Bedrock planning run occurred.

## E. Existing-scene recovery

Pre-populate `working/JOB_ID/scene.json` with a previously validated scene, create a fresh job, then invoke the planner.

```cmd
aws s3 cp "s3://tab-recap-vbeta1/working/SOURCE_JOB_ID/scene.json" "s3://tab-recap-vbeta1/working/JOB_ID/scene.json" --region ap-southeast-2
```

### Live result — PASS

Job: `test-step10-existing-scene-20260913072355`

Source scene: `working/test-step10-sqs-75-20260913071119/scene.json`

Message: `019291a8-9bb1-49c3-a5c4-9debc3faca21`

Observed:
- planner claimed the fresh job;
- logs contained `scene-plan-recovered`;
- no Bedrock generation was logged;
- DynamoDB ended `RENDERING`, matching `sceneS3Key`, `error=NULL`.

## F. Expired planning lease recovery

Create a test job in `PLANNING` with an expired lease and no completed scene.

```cmd
aws dynamodb put-item --table-name tab-recap-vbeta1-jobs --item "{\"jobId\":{\"S\":\"JOB_ID\"},\"status\":{\"S\":\"PLANNING\"},\"createdAt\":{\"S\":\"TIMESTAMP\"},\"updatedAt\":{\"S\":\"TIMESTAMP\"},\"planningAttemptId\":{\"S\":\"dead-test-attempt\"},\"planningLeaseUntil\":{\"N\":\"1\"}}" --region ap-southeast-2
```

### Live result — PASS

Job: `test-step10-expired-lease-20260913072844`

Message: `5933321c-a47e-4c5f-894b-3b408e14afdc`

Observed:
- stale attempt `dead-test-attempt` was replaced by fresh attempt `8fd2b2c4-abc6-47ff-a09a-330f43e0e16b`;
- fresh lease was written;
- planning completed successfully;
- DynamoDB ended `RENDERING` with `sceneS3Key=working/test-step10-expired-lease-20260913072844/scene.json` and `error=NULL`;
- lease ownership fields were removed after success.

## G. Invalid bettings failure

Create a deliberately invalid copy of a known-good fixture:

```cmd
node -e "const fs=require('fs'),path=require('path');const p='C:\\Dev\\TabAPIvbeta1\\tests\\fixtures\\bettings-75.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.bets[0].profitLoss=999999;const out=path.join(process.env.TEMP,'bettings-invalid.json');fs.writeFileSync(out,JSON.stringify(j,null,2));console.log(out);"
```

Upload it, create a fresh `RECEIVED` job, then invoke directly.

### Live result — PASS

Job: `test-step10-invalid-bettings-20260913081923`

Observed:
- test fixture was corrupted by setting bet 1 `profitLoss` to `999999`;
- Lambda returned `FunctionError=Unhandled`;
- DynamoDB ended `FAILED`;
- persisted error was exactly `Bet 1: profitLoss mismatch.`;
- no successful scene plan was produced.

## H. Missing job failure

Invoke the planner with a unique job ID that does not exist in DynamoDB.

```cmd
aws lambda invoke --region ap-southeast-2 --function-name tab-recap-vbeta1-scene-planner --cli-binary-format raw-in-base64-out --payload "{\"schemaVersion\":\"1.0\",\"jobId\":\"JOB_ID\",\"bettingsS3Key\":\"working/JOB_ID/bettings.json\",\"testMode\":true}" "%TEMP%\step10-missing-job-response.json"
```

Verify the job was not auto-created:

```cmd
aws dynamodb get-item --table-name tab-recap-vbeta1-jobs --key "{\"jobId\":{\"S\":\"JOB_ID\"}}" --region ap-southeast-2
```

### Live result — PASS

Job: `test-step10-missing-job-20260913082450`

Observed:
- direct Lambda invocation returned `FunctionError=Unhandled`;
- DynamoDB returned no item;
- planner did not auto-create the missing job.

## I. Retry / DLQ proof

### Final pilot operating decision

Source-controlled target:
- `VisibilityTimeout=1440` seconds;
- `maxReceiveCount=3`;
- Planner Lambda timeout target `240` seconds.

Decision: **ACCEPT 1440/3 for the pilot.** Do not reduce visibility or receive count merely to make this proof complete faster. The 1440-second visibility is six times the 240-second Lambda timeout target and deliberately provides a conservative redelivery buffer. `maxReceiveCount=3` means the initial receive plus two retries before dead-lettering.

Expected poison-message timing: after the first failed receive, subsequent receives are separated by roughly the 24-minute visibility period, so DLQ arrival can take roughly 48+ minutes after the first failure, excluding processing and Lambda/SQS trigger scheduling overhead. The 300-second DynamoDB planning lease does not make SQS redeliver earlier.

Before the final proof, verify the deployed queue configuration:

```cmd
aws sqs get-queue-attributes --queue-url https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-planning --attribute-names RedrivePolicy VisibilityTimeout --region ap-southeast-2
```

Final expected configuration after deployment:
- `VisibilityTimeout=1440`;
- `maxReceiveCount=3`;
- DLQ `tab-recap-vbeta1-planning-dlq`.

### Historical older-config poison test

The existing poison-message evidence below was started against the older live configuration and therefore does **not** complete the final 1440/3 acceptance proof.

Older observed configuration:
- `maxReceiveCount=3`;
- `VisibilityTimeout=1080` seconds;
- DLQ `tab-recap-vbeta1-planning-dlq`.

Historical poison-message job: `test-step10-dlq-20260913083000`

SQS message ID: `f0eefad6-de29-4943-8c47-0990d30ac9bb`

The job deliberately does not exist in DynamoDB, so every receive must fail.

Attempt #1 observed at `2026-09-13T08:33:33Z`:
- `planning-message-accepted`;
- error `Job test-step10-dlq-20260913083000 does not exist.`

Historical status: **IN PROGRESS / NOT FINAL ACCEPTANCE EVIDENCE**.

### Fresh final 1440/3 proof after deployment

Use a new unique poison job ID that does not exist in DynamoDB, send exactly one SQS message, record its message ID, and allow the real queue to retry naturally. Do not manually receive/delete from the source queue and do not alter queue visibility during the proof.

Check retry logs:

```cmd
aws logs tail /aws/lambda/tab-recap-vbeta1-scene-planner --region ap-southeast-2 --since 6h | findstr "JOB_ID"
```

Check the DLQ without consuming the message:

```cmd
aws sqs receive-message --queue-url https://sqs.ap-southeast-2.amazonaws.com/134387458447/tab-recap-vbeta1-planning-dlq --attribute-names All --message-attribute-names All --max-number-of-messages 10 --visibility-timeout 0 --wait-time-seconds 1 --region ap-southeast-2
```

Final acceptance requires:
- live source queue verified at `VisibilityTimeout=1440` and `maxReceiveCount=3`;
- the same poison message is observed failing on repeated receives;
- no successful planner state is created for the missing job;
- after the third receive/failure, that exact message is visible in `tab-recap-vbeta1-planning-dlq`;
- the observed receive/DLQ timing is recorded rather than inferred.

## J. Final hardened pass

### Direct final proof — PASS

Job: `test-step10-final-direct-20260913083410`

Observed:
- direct Lambda invocation returned status 200 with no `FunctionError`;
- DynamoDB ended `RENDERING`;
- `sceneS3Key=working/test-step10-final-direct-20260913083410/scene.json`;
- `error=NULL`.

### SQS final proof — PASS

Job: `test-step10-final-sqs-20260913083816`

Message: `2119e101-5d3d-4493-aa69-e1ac2e62d7b2`

Observed:
- SQS accepted the message;
- DynamoDB moved `RECEIVED -> PLANNING -> RENDERING`;
- final `sceneS3Key=working/test-step10-final-sqs-20260913083816/scene.json`;
- `error=NULL`.

## K. Scene 8 headline-diversity live proof

Status: **PENDING DEPLOYMENT / LIVE TEST**.

Source/CI state before live proof:
- six-item compatibility audit tracked in GitHub Issue #4;
- deterministic category eligibility implemented from pre-result `bettings.json` facts;
- repair payload supplies `eligibleHeadlineCategories` per Scene 8 block;
- both initial and post-repair diversity checks use `bettings.json` eligibility;
- Scene 8 taxonomy/category meaning/diversity policy canonical in `scene-contracts.json`;
- schema enum/taxonomy parity is enforced in CI;
- deployable package including `headline-diversity.js` is smoke-tested in CI;
- headline repair is constrained to `headlineCategory` + `headline` only and remains non-fatal;
- current source-controlled Lambda timeout target is 240s with a 300s planning lease;
- latest second-audit source hardening also includes deterministic no-spoiler protection, normalized duplicate/template checks, tightened category-meaning edge cases, recovery-quality inspection, bounded optional Bedrock calls, and a worst-case orchestration regression test.

Before running the fresh 75-bet proof, verify deployed configuration:

```cmd
aws lambda get-function-configuration --function-name tab-recap-vbeta1-scene-planner --region ap-southeast-2 --query "{Timeout:Timeout,Runtime:Runtime,LastModified:LastModified,CodeSha256:CodeSha256}" --output table
```

Expected after deployment: `Timeout=240`.

Use a fresh 75-bet job and inspect its stored scene plan:

```cmd
aws s3 cp s3://tab-recap-vbeta1/working/JOB_ID/scene.json "%TEMP%\scene75.json" --region ap-southeast-2
```

```cmd
node -e "const j=require(process.env.TEMP+'\\scene75.json');const s=j.scenes.filter(x=>x.sceneType===8);console.log('Scene8 count:',s.length);s.forEach((x,i)=>console.log(i+1,x.headlineCategory,'|',x.headline,'|',x.betSequences.join(',')));"
```

Acceptance for the fresh 75-bet proof:
- all Scene 8 blocks have a valid `headlineCategory`;
- declared categories are deterministically eligible for each block;
- for 13 Scene 8 blocks, at least 4 distinct categories are used, no category exceeds 35% of blocks, and no category repeats more than twice consecutively;
- headlines are grounded in supplied facts, use the declared category lens, stay within 6 words / 80 chars, and do not leak grouped or future outcomes;
- exact normalized duplicate headlines and same-template/different-number repetition are absent;
- the three semantic-only categories from Finding 7 are manually inspected for genuine wording/category match rather than accepted from metadata alone;
- complete primary bet coverage remains exactly `1..75`, chronological and once only;
- Scene 8 blocks remain 4–5 consecutive bets only;
- Scene 4 placement, replay placement, comments, duration logic and P&L data are not altered by headline repair;
- if the initial plan fails the diversity/eligibility gate, logs show exactly one `llm-headline-diversity-repair` attempt followed by either `scene8-headline-diversity-validated` or safe `scene8-headline-diversity-fallback-used`;
- a headline-quality failure does not fail the entire otherwise-valid recap.

Relevant new log events:
- `scene8-headline-diversity-repair-requested`
- `llm-headline-diversity-repair-started`
- `llm-headline-diversity-repair-completed`
- `scene8-headline-diversity-validated`
- `scene8-headline-diversity-fallback-used`

Inspect the fresh job logs:

```cmd
aws logs tail /aws/lambda/tab-recap-vbeta1-scene-planner --region ap-southeast-2 --since 30m | findstr "JOB_ID scene8-headline llm-headline-diversity"
```

Do not mark this section PASS until the hardened code is actually deployed and a fresh generated 75-bet plan is inspected.

## Planner logging expectations

Normal happy path contains the applicable events:
- `planning-message-accepted`
- `planning-job-claimed`
- `bettings-validated`
- `llm-request-started`
- `llm-request-completed`
- optional normal validation/repair events
- optional Scene 8 headline-diversity events listed in section K
- optional Scene 4 final narration events
- `scene-plan-validated`
- `scene-plan-stored`

Recovery/idempotency paths may contain:
- `planning-message-already-complete`
- `scene-plan-recovered`
- `planning-message-duplicate-in-flight`
- `scene-plan-write-race-recovered`

## Step 10 acceptance gate

Current live status as of 2026-09-14:

- B Direct happy path: **PASS**.
- C Real SQS happy path: **PASS**.
- D Duplicate / idempotency: **PASS**.
- E Existing-scene recovery: **PASS on older deployed baseline; fresh recovery-quality proof required after deployment**.
- F Expired planning lease recovery: **PASS**.
- G Invalid bettings failure: **PASS**.
- H Missing job failure: **PASS**.
- I Retry / DLQ proof: **FINAL POLICY ACCEPTED; FRESH 1440/3 LIVE PROOF PENDING DEPLOYMENT**.
- J Final hardened pass: **PASS** for the previously deployed planner baseline.
- K Scene 8 headline-diversity live proof: **PENDING DEPLOYMENT / LIVE TEST**.

Do not start Step 11 until the final deployed-AWS Step 10 proof is completed, recorded, and Step 10 is explicitly signed off.
