'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { signRecapUrl } = require('./recap-url-signer');

const canonicalValidatorModule = fs.existsSync(path.join(__dirname, 'canonical-bettings-validator.js'))
  ? './canonical-bettings-validator'
  : '../../shared/canonical-bettings-validator';
const { validateCanonicalBettingsSemantics } = require(canonicalValidatorModule);

const schemaPath = fs.existsSync(path.join(__dirname, 'contracts', 'bettings.schema.json'))
  ? path.join(__dirname, 'contracts', 'bettings.schema.json')
  : path.join(__dirname, '..', '..', 'contracts', 'bettings.schema.json');
const bettingsSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateBettingsSchema = ajv.compile(bettingsSchema);

const REGION = process.env.AWS_REGION || 'ap-southeast-2';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET;
const JOBS_TABLE = process.env.JOBS_TABLE;
const PLANNING_QUEUE_URL = process.env.PLANNING_QUEUE_URL;
const RECAP_URL_TTL_SECONDS = Number(process.env.RECAP_URL_TTL_SECONDS || 43200);

const s3 = new S3Client({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });
const sqs = new SQSClient({ region: REGION });

class ApiError extends Error {
  constructor(statusCode, errorCode, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': 'https://d1dcueurs1xl4v.cloudfront.net',
      'Vary': 'Origin'
    },
    body: JSON.stringify(body)
  };
}

function requestIdFor(event) {
  return event?.requestContext?.requestId || randomUUID();
}

function apiErrorResponse(error, requestId) {
  const body = {
    errorCode: error.errorCode,
    message: error.message,
    requestId
  };
  if (Array.isArray(error.details) && error.details.length) {
    body.details = error.details;
  }
  return jsonResponse(error.statusCode, body);
}

function failedJobPublicFields(item) {
  const failedStage = item.sceneS3Key?.S ? 'RENDERING' : 'PLANNING';
  return {
    failureCode: failedStage === 'RENDERING'
      ? 'KUBRICK_RENDERING_FAILED'
      : 'KUBRICK_PLANNING_FAILED',
    failedStage,
    message: failedStage === 'RENDERING'
      ? 'Kubrick could not complete rendering.'
      : 'Kubrick could not complete planning.'
  };
}

function decodeRequestBody(event) {
  if (typeof event?.body !== 'string' || !event.body.trim()) {
    throw new ApiError(
      400,
      'KUBRICK_INVALID_JSON',
      'Request body must contain valid JSON.'
    );
  }

  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

function schemaValidationDetails() {
  return (validateBettingsSchema.errors || []).map(error => {
    const location = error.instancePath || '/';
    return `${location} ${error.message}`.trim();
  });
}

function parseCanonicalBettings(event) {
  const raw = decodeRequestBody(event);

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ApiError(
      400,
      'KUBRICK_INVALID_JSON',
      'Request body must contain valid JSON.'
    );
  }

  if (!validateBettingsSchema(value)) {
    throw new ApiError(
      400,
      'KUBRICK_INVALID_PAYLOAD',
      'Payload failed canonical bettings.json validation.',
      schemaValidationDetails()
    );
  }

  try {
    validateCanonicalBettingsSemantics(value);
  } catch (error) {
    throw new ApiError(
      400,
      'KUBRICK_INVALID_PAYLOAD',
      'Payload failed canonical bettings.json validation.',
      [String(error?.message || error)]
    );
  }

  return {
    bettings: value,
    payloadBytes: Buffer.byteLength(raw, 'utf8'),
    betCount: value.bets.length
  };
}

function admitCanonicalBettings(event, requestId) {
  const startedAt = Date.now();

  try {
    const result = parseCanonicalBettings(event);
    console.log(JSON.stringify({
      event: 'admission-validation',
      requestId,
      payloadBytes: result.payloadBytes,
      betCount: result.betCount,
      validationDurationMs: Date.now() - startedAt,
      validationResult: 'ACCEPTED'
    }));
    return result.bettings;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'admission-validation',
      requestId,
      payloadBytes: typeof event?.body === 'string' ? Buffer.byteLength(event.body, 'utf8') : 0,
      betCount: null,
      validationDurationMs: Date.now() - startedAt,
      validationResult: 'REJECTED',
      errorCode: error?.errorCode || 'KUBRICK_INTERNAL_ERROR'
    }));
    throw error;
  }
}

async function createJob(event, requestId) {
  const bettings = admitCanonicalBettings(event, requestId);

  const jobId = randomUUID();
  const bettingsS3Key = `working/${jobId}/bettings.json`;
  const now = new Date().toISOString();

  await s3.send(new PutObjectCommand({
    Bucket: STORAGE_BUCKET,
    Key: bettingsS3Key,
    Body: JSON.stringify(bettings),
    ContentType: 'application/json'
  }));

  await ddb.send(new PutItemCommand({
    TableName: JOBS_TABLE,
    Item: {
      jobId: { S: jobId },
      status: { S: 'RECEIVED' },
      createdAt: { S: now },
      updatedAt: { S: now }
    },
    ConditionExpression: 'attribute_not_exists(jobId)'
  }));

  const planningMessage = {
    schemaVersion: '1.0',
    jobId,
    bettingsS3Key
  };

  const sqsResult = await sqs.send(new SendMessageCommand({
    QueueUrl: PLANNING_QUEUE_URL,
    MessageBody: JSON.stringify(planningMessage)
  }));

  console.log(JSON.stringify({
    event: 'job-created',
    requestId,
    jobId,
    bettingsS3Key,
    planningMessageId: sqsResult.MessageId || null
  }));

  return jsonResponse(202, {
    jobId,
    status: 'RECEIVED'
  });
}

async function getJobStatus(event, requestId) {
  const jobId = event?.pathParameters?.jobId;
  if (typeof jobId !== 'string' || !jobId.trim()) {
    throw new ApiError(
      400,
      'KUBRICK_INVALID_REQUEST',
      'jobId is required.'
    );
  }

  const response = await ddb.send(new GetItemCommand({
    TableName: JOBS_TABLE,
    Key: { jobId: { S: jobId } },
    ConsistentRead: true
  }));

  if (!response.Item) {
    throw new ApiError(
      404,
      'KUBRICK_JOB_NOT_FOUND',
      'Job not found.'
    );
  }

  const status = response.Item.status?.S || 'UNKNOWN';
  const body = { jobId, status };

  if (status === 'FAILED') {
    Object.assign(body, failedJobPublicFields(response.Item));
  }

  if (status === 'READY' && response.Item.recapS3Key?.S) {
    body.recapUrl = await signRecapUrl({
      key: response.Item.recapS3Key.S,
      provider: process.env.RECAP_URL_PROVIDER || 'S3',
      s3Signer: () => getSignedUrl(s3, new GetObjectCommand({
        Bucket: STORAGE_BUCKET,
        Key: response.Item.recapS3Key.S
      }), { expiresIn: RECAP_URL_TTL_SECONDS })
    });
  }

  return jsonResponse(200, body);
}

function route(event) {
  const method = event?.httpMethod;
  const resource = event?.resource;

  if (method === 'POST' && resource === '/jobs') return 'CREATE_JOB';
  if (method === 'GET' && resource === '/jobs/{jobId}') return 'GET_JOB';
  return null;
}

exports.__test = {
  ApiError,
  jsonResponse,
  apiErrorResponse,
  failedJobPublicFields,
  parseCanonicalBettings,
  admitCanonicalBettings,
  route
};

exports.handler = async event => {
  const requestId = requestIdFor(event);

  try {
    if (!STORAGE_BUCKET || !JOBS_TABLE || !PLANNING_QUEUE_URL) {
      throw new Error('Missing required orchestrator environment configuration.');
    }

    const action = route(event);
    if (action === 'CREATE_JOB') return await createJob(event, requestId);
    if (action === 'GET_JOB') return await getJobStatus(event, requestId);

    throw new ApiError(
      404,
      'KUBRICK_ROUTE_NOT_FOUND',
      'Route not found.'
    );
  } catch (error) {
    if (error instanceof ApiError) {
      console.warn(JSON.stringify({
        event: 'orchestrator-request-rejected',
        requestId,
        errorCode: error.errorCode,
        statusCode: error.statusCode
      }));
      return apiErrorResponse(error, requestId);
    }

    console.error(JSON.stringify({
      event: 'orchestrator-failed',
      requestId,
      errorType: error.name,
      error: String(error.message || error).slice(0, 1000)
    }));

    return apiErrorResponse(
      new ApiError(
        500,
        'KUBRICK_INTERNAL_ERROR',
        'Internal server error.'
      ),
      requestId
    );
  }
};
