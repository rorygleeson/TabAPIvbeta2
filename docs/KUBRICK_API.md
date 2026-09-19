# Kubrick API

Last updated: 2026-09-19

## Purpose

Kubrick is the complete recap-generation backend:

```text
Kubrick
  = Orchestrator Lambda
  + Planner Lambda
  + Builder / Renderer Lambda
```

This document defines how an external client consumes Kubrick.

The CSV Normaliser is **not** part of Kubrick. It is one isolated sample client/use case: it converts a TAB account-history CSV into canonical `bettings.json`, then submits that JSON to Kubrick. Other clients can call the same API directly as long as they produce the canonical input contract.

## POC base URL

```text
https://fbhuqhy5cf.execute-api.ap-southeast-2.amazonaws.com/poc
```

## Authentication / API access

The POC currently uses an API Gateway API key.

Every client request must include:

```http
x-api-key: <POC API KEY>
```

The API key value is intentionally not stored in GitHub or repository documentation.

This shared key is POC access control and throttling, not end-user authentication.

API-key rejection happens at **API Gateway before the Orchestrator Lambda runs**. A missing or invalid key therefore must not create a Kubrick job, S3 input object, DynamoDB record or SQS message.

Kubrick treats API admission failures and job-processing failures as two different failure planes:

```text
PRE-JOB / API ADMISSION FAILURE
  -> direct HTTP response to the request
  -> API errorCode
  -> no jobId
  -> no DynamoDB job
  -> client must NOT start polling

POST ACCEPTED
  -> HTTP 202 + jobId
  -> DynamoDB lifecycle begins
  -> client may poll GET /jobs/{jobId}

POST-ACCEPTANCE / JOB PROCESSING FAILURE
  -> GET /jobs/{jobId} succeeds
  -> DynamoDB status = FAILED
  -> job failure metadata is returned
```

These concepts must remain separate. An API admission error is **not** a DynamoDB job status.

## API surface

Kubrick exposes exactly two public endpoints:

```text
POST /jobs
GET  /jobs/{jobId}
```

Clients do not call the Planner or Builder/Renderer directly.

## 1. Create a recap job

### Request

```http
POST /jobs
Content-Type: application/json
x-api-key: <POC API KEY>
```

The request body is the complete canonical `bettings.json` JSON object.

Conceptually:

```json
{
  "schemaVersion": "1.0",
  "user": { "...": "..." },
  "day": { "...": "..." },
  "bets": [
    { "...": "canonical bet data" }
  ],
  "summary": { "...": "..." }
}
```

The public Kubrick admission contract requires the Orchestrator to perform **strict canonical validation before any job is created**.

The admission gate must validate:

- JSON parsing;
- the canonical `contracts/bettings.schema.json` structure;
- required properties and types;
- rejection of unexpected properties;
- schema version;
- deterministic semantic invariants such as exact sequence coverage, financial arithmetic, summary consistency and replay URL validity.

Only a payload that passes the complete admission gate may receive a `jobId`.

The Planner still performs defensive validation internally, but Planner validation is not the public admission gate.

**Implementation status:** strict Orchestrator admission validation is implemented. The Orchestrator parses JSON, validates the canonical schema, runs the shared canonical semantic validator, records admission telemetry and only then begins job creation.

### Admission timing and execution rules

Admission validation is intentionally **synchronous, deterministic and local to the Orchestrator**.

The POST request must complete this admission sequence before a Kubrick job is accepted:

```text
API Gateway API-key check
  -> parse JSON
  -> validate canonical schema
  -> validate deterministic semantic invariants
  -> only then begin job creation
```

Admission validation must not call Bedrock, TAB APIs, historical-result services, enrichment services or any other external business-data service. It must not perform planning or rendering.

For the currently supported recap sizes, this work is expected to be CPU-local and fast. Validation latency should be instrumented so unusually slow admission can be detected rather than silently consuming the Orchestrator/API timeout budget.

Admission telemetry currently records:

```text
requestId
payloadBytes
betCount
validationDurationMs
validationResult
```

A client waits synchronously for this admission result. There are only two public outcomes from `POST /jobs`:

```text
REJECTED
  -> direct HTTP error + errorCode
  -> no jobId returned
  -> client does not poll

ACCEPTED
  -> HTTP 202 Accepted
  -> jobId + status RECEIVED
  -> client begins polling
```

HTTP `202` is deliberate: Kubrick has accepted asynchronous work, but the recap has not completed yet.

### Durable acceptance boundary

Kubrick must return `202 Accepted` **only after the validated request has been durably handed to the asynchronous processing pipeline**.

The intended creation order is:

```text
validated canonical payload
  -> generate UUID jobId
  -> persist working/<jobId>/bettings.json
  -> persist DynamoDB job state
  -> successfully submit Planning SQS message
  -> return HTTP 202
```

A successful `202` therefore means all of the following are true:

- canonical admission validation passed;
- the canonical input was durably persisted;
- a DynamoDB job record exists;
- the planning message was accepted by SQS;
- the client can safely begin polling the returned `jobId`.

If any job-creation step fails before Planning SQS confirms submission, the POST must **not** return `202`.

Partial internal writes are an implementation/resiliency concern and must not be confused with an accepted client job. The implementation must perform rollback/reconciliation where practical, log the precise failure, and must not expose a successful admission response until the queue handoff has succeeded.

This is especially important for failures such as:

```text
S3 write succeeds
DynamoDB write succeeds
Planning SQS send fails
```

That condition must never be reported to the caller as an accepted job. The resiliency audit will define the exact cleanup/reconciliation behaviour for every partial-creation failure path.

### Success response

HTTP `202 Accepted`:

```json
{
  "jobId": "bbd2681d-8cfe-47df-8c34-3397f99c764c",
  "status": "RECEIVED"
}
```

The `jobId` is generated by the Orchestrator using a UUID. The client must retain it and use it for status polling.

### What Kubrick does after POST

```text
Orchestrator
  -> generate UUID jobId
  -> write working/<jobId>/bettings.json to private S3
  -> create DynamoDB job with RECEIVED
  -> send planning SQS message
  -> return 202 immediately
```

The POST request starts asynchronous processing. A successful `202` means Kubrick has completed synchronous admission, durably created the job and successfully handed it to Planning SQS; it does **not** mean the recap is complete.

### Pre-job API/admission failures

Failures before acceptance are returned directly by the API call. They do **not** appear later through `GET /jobs/{jobId}`, because no Kubrick job exists.

The stable public error envelope is:

```json
{
  "errorCode": "KUBRICK_INVALID_PAYLOAD",
  "message": "Payload failed canonical bettings.json validation.",
  "details": [
    "summary.totalBets must equal bets.length"
  ],
  "requestId": "..."
}
```

`details` is optional and is intended for safe validation detail. Clients must make decisions using `errorCode`, not by parsing the human-readable `message`.

The current **Orchestrator-owned** admission/error catalogue is:

| HTTP | errorCode | Meaning | Job created? |
| ---: | --- | --- | --- |
| 400 | `KUBRICK_INVALID_JSON` | Request body is not valid JSON | No |
| 400 | `KUBRICK_INVALID_PAYLOAD` | JSON is parseable but fails canonical schema or semantic validation | No |
| 400 | `KUBRICK_INVALID_REQUEST` | Request is structurally invalid, such as a missing required jobId on a status lookup | No |
| 404 | `KUBRICK_ROUTE_NOT_FOUND` | Requested Orchestrator route does not exist | No |
| 404 | `KUBRICK_JOB_NOT_FOUND` | Requested job does not exist | No |
| 500 | `KUBRICK_INTERNAL_ERROR` | Unexpected Orchestrator/service failure | No |

API-key rejection and usage-plan throttling originate at API Gateway **before the Orchestrator runs**. The current infrastructure requires the key and applies throttling, but does not define custom API Gateway `GatewayResponse` mappings. Therefore clients must not yet assume Gateway-owned 403/429 responses use the Kubrick JSON envelope or distinct `KUBRICK_API_KEY_REQUIRED`, `KUBRICK_API_KEY_INVALID` and `KUBRICK_RATE_LIMITED` codes. Regardless of body shape, these Gateway rejections create no Kubrick job.

For `POST /jobs`, the hard rule is:

```text
anything except a successful 202
-> no accepted Kubrick job
-> client must not poll
```

A valid accepted response remains:

```json
{
  "jobId": "...",
  "status": "RECEIVED"
}
```

Only after this response does the job lifecycle begin.

## 2. Poll job status

### Request

```http
GET /jobs/{jobId}
x-api-key: <POC API KEY>
```

Example path:

```text
GET /jobs/bbd2681d-8cfe-47df-8c34-3397f99c764c
```

### Processing response

While work is in progress, the response is HTTP `200` and contains the current state:

```json
{
  "jobId": "bbd2681d-8cfe-47df-8c34-3397f99c764c",
  "status": "PLANNING"
}
```

Statuses observed by clients can include:

```text
RECEIVED
PLANNING
RENDERING
READY
FAILED
```

A client should continue polling while the job is not terminal.

### READY response

When the Builder/Renderer has completed:

```json
{
  "jobId": "bbd2681d-8cfe-47df-8c34-3397f99c764c",
  "status": "READY",
  "recapUrl": "https://..."
}
```

`recapUrl` is a fresh short-lived S3 presigned URL generated by the Orchestrator from the persisted `recapS3Key`.

Current configured TTL:

```text
12 hours (43,200 seconds)
```

Because the URL is signed by the Orchestrator Lambda using temporary AWS credentials, the effective lifetime can be shorter if the signing credentials expire first. The 12-hour setting therefore needs live duration testing before it is treated as guaranteed.

The presigned URL is never stored as job state. Calling GET again while the job remains READY can generate a fresh URL.

### FAILED response

A processing failure after a job has been accepted is **not an API admission error**.

The GET request itself succeeded, so the status endpoint returns HTTP `200` with the job lifecycle state:

```json
{
  "jobId": "...",
  "status": "FAILED",
  "failureCode": "KUBRICK_RENDERING_FAILED",
  "failedStage": "RENDERING",
  "message": "Kubrick could not complete rendering."
}
```

Job failure fields are deliberately named `failureCode`, `failedStage` and `message` to distinguish them from pre-job API `errorCode` responses.

The public failure code reflects the failed backend stage:

- `KUBRICK_PLANNING_FAILED` with `failedStage: "PLANNING"`;
- `KUBRICK_RENDERING_FAILED` with `failedStage: "RENDERING"`.

The persisted/internal failure record may retain more diagnostic detail than is exposed to the client. Clients must not depend on raw Lambda/AWS exception text.

### Unknown job

An unknown `jobId` returns HTTP `404` with a direct API error response such as:

```json
{
  "errorCode": "KUBRICK_JOB_NOT_FOUND",
  "message": "Job not found.",
  "requestId": "..."
}
```

This is a request-level lookup error, not `status: "FAILED"`, because the requested job does not exist.

## Client consumption pattern

The client must treat **POST admission** and **job polling** as separate phases:

```text
1. Produce canonical bettings.json.

2. POST /jobs with:
     Content-Type: application/json
     x-api-key: <POC API KEY>

3. Inspect the direct POST response.

   NON-202:
     -> handle errorCode immediately
     -> there is no accepted job
     -> do NOT poll

   202:
     -> read and retain jobId
     -> accepted Kubrick job now exists

4. Poll GET /jobs/{jobId} with the same x-api-key.

5. Handle the GET response.

   request-level error:
     -> handle HTTP status + errorCode

   status RECEIVED / PLANNING / RENDERING:
     -> wait and poll again

   status FAILED:
     -> stop polling
     -> handle failureCode / failedStage

   status READY:
     -> read recapUrl
     -> present the recap while the URL is valid
```

The client does not need to know about S3 keys, DynamoDB, SQS, Bedrock, scenes, Planner logic or Builder templates.

### Error/status naming rule

The naming distinction is intentional:

```text
errorCode
  = direct API/request failure
  = request was not successfully serviced/accepted
  = may exist without any job

status
  = DynamoDB-backed lifecycle of an accepted job

failureCode
  = terminal processing failure for an accepted job
  = only meaningful when status = FAILED
```

A client must never interpret a pre-job `errorCode` as a job status, and must never expect admission failures to appear later through the status endpoint.

## Example client flow

```text
Sample CSV Normaliser client
  |
  +--> parse/enrich CSV
  +--> produce canonical bettings.json
  |
  v
POST /jobs
  |
  v
{ jobId, status:"RECEIVED" }
  |
  v
poll GET /jobs/{jobId}
  |
  +--> RECEIVED
  +--> PLANNING
  +--> RENDERING
  |
  v
READY + recapUrl
  |
  v
present final interactive recap to user
```

The same Kubrick API can be consumed by a mobile app, web application, another Lambda, a batch process, a future TAB service, or any other client that can produce canonical `bettings.json`.

## Internal Kubrick flow

```text
API Gateway
  -> Orchestrator
  -> Planning SQS
  -> Planner
  -> Rendering SQS
  -> Builder / Renderer
  -> private recap.html
  -> DynamoDB READY
  -> Orchestrator status endpoint
  -> fresh recapUrl
```

### Orchestrator responsibilities

- API boundary;
- API request routing;
- strict canonical admission validation before job creation;
- stable direct API error responses for Orchestrator-owned admission failures;
- UUID job creation;
- canonical input persistence;
- initial job-state creation;
- planning queue submission;
- job-status reads;
- final presigned URL generation.

### Planner responsibilities

- canonical input validation;
- deterministic scene planning;
- replay/midpoint/grouping/duration decisions;
- exactly one grounded Bedrock copy call;
- deterministic copy fallback;
- final `scene.json`;
- transition to `RENDERING`;
- Rendering SQS handoff.

### Builder / Renderer responsibilities

- consume `bettings.json` and `scene.json`;
- deterministic template rendering;
- runtime HTML/CSS/JavaScript generation;
- replay and soundtrack runtime behaviour;
- write `recaps/<jobId>/recap.html`;
- transition the job to `READY`;
- persist `recapS3Key`.

## Fault model — locked contract

Kubrick's public fault model is:

```text
API Gateway admission
  -> API key / throttling
  -> direct HTTP errorCode
  -> no job

Orchestrator admission
  -> JSON / canonical payload validation
  -> direct HTTP errorCode
  -> no job

Accepted job
  -> DynamoDB lifecycle
  -> RECEIVED / PLANNING / RENDERING / READY / FAILED

Accepted job failure
  -> GET returns HTTP 200
  -> status = FAILED
  -> failureCode + failedStage
```

This separation is mandatory for all future resiliency work.

Admission validation must remain comfortably inside the synchronous API/Orchestrator timeout envelope. If validation latency approaches infrastructure timeouts, that is treated as a defect to investigate rather than a reason to move canonical admission behind SQS.

Strict Orchestrator admission, telemetry and Orchestrator-owned stable error envelopes are implemented and live-proven. The remaining backend reliability work is the separate resiliency audit: queue/Lambda timeout behaviour, retry/DLQ handling, partial-creation cleanup/reconciliation and prevention of accepted jobs becoming permanently stuck in non-terminal DynamoDB states.

## Test harness

The deployed API is exercised with:

```cmd
tests\tools\run-orchestrator-test.cmd <size>
```

Supported fixture sizes:

```text
5
8
16
32
50
75
```

The harness proves both endpoints:

```text
POST /jobs
GET /jobs/{jobId}
```

It then uses the returned `recapUrl` to download the final `recap.html`.

Bad-mode admission testing is also supported:

```cmd
tests\tools\run-orchestrator-test.cmd 8 bad
```

On 2026-09-19 this live test returned HTTP 400 with `KUBRICK_INVALID_PAYLOAD`, `requestId`, semantic validation `details`, no `jobId`, and correctly performed no polling.

Only the API key is expected as a local secret:

```cmd
set TAB_RECAP_API_KEY=<POC API KEY>
```

The test script contains the deployed POC base URL. The API key value must not be committed.
