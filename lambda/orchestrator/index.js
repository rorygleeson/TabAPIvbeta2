'use strict';

const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REGION = process.env.AWS_REGION || 'ap-southeast-2';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET;
const JOBS_TABLE = process.env.JOBS_TABLE;
const PLANNING_QUEUE_URL = process.env.PLANNING_QUEUE_URL;
const RECAP_URL_TTL_SECONDS = Number(process.env.RECAP_URL_TTL_SECONDS || 900);

const s3 = new S3Client({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });
const sqs = new SQSClient({ region: REGION });

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function parseCanonicalBettings(event) {
  if (typeof event?.body !== 'string' || !event.body.trim()) {
    throw new Error('Request body must contain canonical bettings.json.');
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Canonical bettings.json must be a JSON object.');
  }
  if (!Array.isArray(value.bets) || value.bets.length === 0) {
    throw new Error('Canonical bettings.json requires a non-empty bets array.');
  }
  return value;
}

async function createJob(event) {
  let bettings;
  try {
    bettings = parseCanonicalBettings(event);
  } catch (error) {
    return jsonResponse(400, { error: String(error.message || error) });
  }

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
    jobId,
    bettingsS3Key,
    planningMessageId: sqsResult.MessageId || null
  }));

  return jsonResponse(202, {
    jobId,
    status: 'RECEIVED'
  });
}

async function getJobStatus(event) {
  const jobId = event?.pathParameters?.jobId;
  if (typeof jobId !== 'string' || !jobId.trim()) {
    return jsonResponse(400, { error: 'jobId is required.' });
  }

  const response = await ddb.send(new GetItemCommand({
    TableName: JOBS_TABLE,
    Key: { jobId: { S: jobId } },
    ConsistentRead: true
  }));

  if (!response.Item) {
    return jsonResponse(404, { error: 'Job not found.' });
  }

  const status = response.Item.status?.S || 'UNKNOWN';
  const body = { jobId, status };

  if (status === 'FAILED' && response.Item.error?.S) {
    body.error = response.Item.error.S;
  }

  if (status === 'READY' && response.Item.recapS3Key?.S) {
    body.recapUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: STORAGE_BUCKET,
        Key: response.Item.recapS3Key.S
      }),
      { expiresIn: RECAP_URL_TTL_SECONDS }
    );
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
  jsonResponse,
  parseCanonicalBettings,
  route
};

exports.handler = async event => {
  if (!STORAGE_BUCKET || !JOBS_TABLE || !PLANNING_QUEUE_URL) {
    throw new Error('Missing required orchestrator environment configuration.');
  }

  try {
    const action = route(event);
    if (action === 'CREATE_JOB') return await createJob(event);
    if (action === 'GET_JOB') return await getJobStatus(event);
    return jsonResponse(404, { error: 'Route not found.' });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'orchestrator-failed',
      errorType: error.name,
      error: String(error.message || error).slice(0, 1000)
    }));
    return jsonResponse(500, { error: 'Internal server error.' });
  }
};
