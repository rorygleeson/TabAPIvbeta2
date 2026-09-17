'use strict';

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { buildRecap } = require('./recap-builder');
const { validateBuilderPlanInvariants } = require('./builder-plan-guard');

const REGION = process.env.AWS_REGION || 'ap-southeast-2';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET;
const JOBS_TABLE = process.env.JOBS_TABLE;

const s3 = new S3Client({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });

function validateRenderingMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error('Rendering message must be an object.');
  }
  if (message.schemaVersion !== '1.0') {
    throw new Error(`Unsupported schemaVersion: ${message.schemaVersion}`);
  }
  if (typeof message.jobId !== 'string' || !message.jobId.trim()) {
    throw new Error('Rendering message requires a non-empty jobId string.');
  }
  if (typeof message.bettingsS3Key !== 'string' || !message.bettingsS3Key.trim()) {
    throw new Error('Rendering message requires a non-empty bettingsS3Key string.');
  }
  if (typeof message.sceneS3Key !== 'string' || !message.sceneS3Key.trim()) {
    throw new Error('Rendering message requires a non-empty sceneS3Key string.');
  }

  const expectedBettingsKey = `working/${message.jobId}/bettings.json`;
  const expectedSceneKey = `working/${message.jobId}/scene.json`;
  if (message.bettingsS3Key !== expectedBettingsKey) {
    throw new Error(`bettingsS3Key must exactly match ${expectedBettingsKey}.`);
  }
  if (message.sceneS3Key !== expectedSceneKey) {
    throw new Error(`sceneS3Key must exactly match ${expectedSceneKey}.`);
  }

  return message;
}

function normalizeEvent(event) {
  if (Array.isArray(event?.Records)) {
    return event.Records.map(record => {
      let body;
      try {
        body = JSON.parse(record.body);
      } catch (error) {
        throw new Error(`Rendering message is not valid JSON: ${error.message}`);
      }
      return {
        message: validateRenderingMessage(body),
        sqsMessageId: record.messageId || null,
        source: 'sqs'
      };
    });
  }

  return [{
    message: validateRenderingMessage(event),
    sqsMessageId: null,
    source: 'direct'
  }];
}

async function getJsonFromS3(key) {
  const response = await s3.send(new GetObjectCommand({
    Bucket: STORAGE_BUCKET,
    Key: key
  }));
  return JSON.parse(await response.Body.transformToString());
}

async function getJob(jobId) {
  const response = await ddb.send(new GetItemCommand({
    TableName: JOBS_TABLE,
    Key: { jobId: { S: jobId } },
    ConsistentRead: true
  }));

  if (!response.Item) throw new Error(`Job ${jobId} does not exist.`);

  return {
    status: response.Item.status?.S || null,
    sceneS3Key: response.Item.sceneS3Key?.S || null,
    recapS3Key: response.Item.recapS3Key?.S || null
  };
}

async function markReady(jobId, recapS3Key) {
  await ddb.send(new UpdateItemCommand({
    TableName: JOBS_TABLE,
    Key: { jobId: { S: jobId } },
    UpdateExpression: 'SET #status = :ready, updatedAt = :updatedAt, #error = :noError, recapS3Key = :recapS3Key',
    ConditionExpression: 'attribute_exists(jobId) AND (#status = :rendering OR #status = :failed)',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#error': 'error'
    },
    ExpressionAttributeValues: {
      ':ready': { S: 'READY' },
      ':rendering': { S: 'RENDERING' },
      ':failed': { S: 'FAILED' },
      ':updatedAt': { S: new Date().toISOString() },
      ':noError': { NULL: true },
      ':recapS3Key': { S: recapS3Key }
    }
  }));
}

async function markFailed(jobId, errorMessage) {
  await ddb.send(new UpdateItemCommand({
    TableName: JOBS_TABLE,
    Key: { jobId: { S: jobId } },
    UpdateExpression: 'SET #status = :failed, updatedAt = :updatedAt, #error = :error',
    ConditionExpression: 'attribute_exists(jobId) AND (#status = :rendering OR #status = :failed)',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#error': 'error'
    },
    ExpressionAttributeValues: {
      ':failed': { S: 'FAILED' },
      ':rendering': { S: 'RENDERING' },
      ':updatedAt': { S: new Date().toISOString() },
      ':error': { S: String(errorMessage).slice(0, 1000) }
    }
  }));
}

async function processMessage(context) {
  const { message, source, sqsMessageId } = context;
  const { jobId, bettingsS3Key, sceneS3Key } = message;
  const recapS3Key = `recaps/${jobId}/recap.html`;

  console.log(JSON.stringify({
    event: 'rendering-message-accepted',
    source,
    schemaVersion: message.schemaVersion,
    jobId,
    bettingsS3Key,
    sceneS3Key,
    sqsMessageId
  }));

  const before = await getJob(jobId);
  if (before.status === 'READY' && before.recapS3Key) {
    console.log(JSON.stringify({
      event: 'rendering-message-already-complete',
      jobId,
      recapS3Key: before.recapS3Key
    }));
    return {
      jobId,
      status: 'READY',
      recapS3Key: before.recapS3Key,
      idempotent: true
    };
  }

  if (before.sceneS3Key && before.sceneS3Key !== sceneS3Key) {
    throw new Error(`Job ${jobId} sceneS3Key does not match the rendering message.`);
  }
  if (before.status !== 'RENDERING' && before.status !== 'FAILED') {
    throw new Error(`Job ${jobId} cannot be rendered from status ${before.status}.`);
  }

  try {
    const [bettings, scenePlan] = await Promise.all([
      getJsonFromS3(bettingsS3Key),
      getJsonFromS3(sceneS3Key)
    ]);

    validateBuilderPlanInvariants(bettings, scenePlan);
    const result = buildRecap({ bettings, scenePlan });

    await s3.send(new PutObjectCommand({
      Bucket: STORAGE_BUCKET,
      Key: recapS3Key,
      Body: result.html,
      ContentType: 'text/html; charset=utf-8',
      CacheControl: 'no-cache'
    }));

    try {
      await markReady(jobId, recapS3Key);
    } catch (error) {
      if (error?.name !== 'ConditionalCheckFailedException') throw error;
      const current = await getJob(jobId);
      if (current.status !== 'READY' || !current.recapS3Key) throw error;
      console.log(JSON.stringify({
        event: 'rendering-ready-race-recovered',
        jobId,
        recapS3Key: current.recapS3Key
      }));
      return {
        jobId,
        status: 'READY',
        recapS3Key: current.recapS3Key,
        idempotent: true
      };
    }

    console.log(JSON.stringify({
      event: 'recap-stored',
      jobId,
      recapS3Key,
      sceneCount: result.sceneCount,
      betCount: result.betCount,
      replayCount: result.replayCount,
      finalPnl: result.finalPnl
    }));

    return {
      jobId,
      status: 'READY',
      recapS3Key,
      sceneCount: result.sceneCount,
      betCount: result.betCount,
      replayCount: result.replayCount,
      finalPnl: result.finalPnl,
      idempotent: false
    };
  } catch (error) {
    console.error(JSON.stringify({
      event: 'rendering-failed',
      jobId,
      errorType: error.name,
      error: error.message
    }));

    try {
      await markFailed(jobId, error.message);
    } catch (stateError) {
      if (stateError?.name === 'ConditionalCheckFailedException') {
        console.warn(JSON.stringify({ event: 'rendering-failure-status-not-owned', jobId }));
      } else {
        console.error(JSON.stringify({
          event: 'rendering-failure-status-update-failed',
          jobId,
          error: stateError.message
        }));
      }
    }

    throw error;
  }
}

exports.__test = {
  validateRenderingMessage,
  normalizeEvent
};

exports.handler = async event => {
  if (!STORAGE_BUCKET || !JOBS_TABLE) {
    throw new Error('Missing required builder environment configuration.');
  }

  const contexts = normalizeEvent(event);
  const results = [];
  for (const context of contexts) {
    results.push(await processMessage(context));
  }
  return { processed: results.length, results };
};
