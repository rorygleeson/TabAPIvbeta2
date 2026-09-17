'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

const { buildDeterministicScenePlan } = require('./scene-planner');
const { buildLlmCopyInput } = require('./llm-copy-input');
const { parseJsonObject, validateCopyResponse } = require('./llm-copy-response');
const { mergeCopyIntoPlan } = require('./llm-copy-merge');

const REGION = process.env.AWS_REGION || 'ap-southeast-2';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET;
const JOBS_TABLE = process.env.JOBS_TABLE;
const PLANNER_MODEL_ID = process.env.PLANNER_MODEL_ID;
const PLANNING_LEASE_SECONDS = 300;

const s3 = new S3Client({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });
const bedrock = new BedrockRuntimeClient({ region: REGION });

const ROOT = __dirname;
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = p => JSON.parse(read(p));
const plannerPrompt = read('contracts/planner-prompt.md');
const bettingsSchema = json('contracts/bettings.schema.json');
const scenePlanSchema = json('contracts/scene-plan.schema.json');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateBettingsSchema = ajv.compile(bettingsSchema);
const validateScenePlanSchema = ajv.compile(scenePlanSchema);

function schemaCheck(validate, value, label) {
  if (validate(value)) return;
  const detail = (validate.errors || []).map(e => (e.instancePath || '/') + ' ' + e.message).join('; ');
  throw new Error(label + ' schema validation failed: ' + detail);
}

function validatePlanningMessage(message) {
  if (!message || typeof message !== 'object') throw new Error('Planning message must be an object.');
  if (typeof message.jobId !== 'string' || !message.jobId) throw new Error('jobId is required.');
  if (typeof message.bettingsS3Key !== 'string' || !message.bettingsS3Key) throw new Error('bettingsS3Key is required.');
  const expected = 'working/' + message.jobId + '/bettings.json';
  if (message.bettingsS3Key !== expected) throw new Error('bettingsS3Key must equal ' + expected + '.');
  return message;
}

function normalizeEvent(event) {
  if (Array.isArray(event?.Records)) {
    return event.Records.map(record => ({
      message: validatePlanningMessage(JSON.parse(record.body)),
      source: 'sqs',
      sqsMessageId: record.messageId || null
    }));
  }
  return [{ message: validatePlanningMessage(event), source: 'direct', sqsMessageId: null }];
}

async function getJsonFromS3(key) {
  const response = await s3.send(new GetObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }));
  return JSON.parse(await response.Body.transformToString());
}

async function tryGetJsonFromS3(key) {
  try {
    return await getJsonFromS3(key);
  } catch (error) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

async function putJsonToS3(key, value) {
  await s3.send(new PutObjectCommand({
    Bucket: STORAGE_BUCKET,
    Key: key,
    Body: JSON.stringify(value),
    ContentType: 'application/json'
  }));
}

async function getJob(jobId) {
  const response = await ddb.send(new GetItemCommand({
    TableName: JOBS_TABLE,
    Key: { jobId: { S: jobId } },
    ConsistentRead: true
  }));
  if (!response.Item) throw new Error('Job ' + jobId + ' does not exist.');
  return {
    status: response.Item.status?.S || null,
    sceneS3Key: response.Item.sceneS3Key?.S || null,
    planningAttemptId: response.Item.planningAttemptId?.S || null,
    planningLeaseUntil: Number(response.Item.planningLeaseUntil?.N || 0)
  };
}

async function claimJob(jobId) {
  const attemptId = randomUUID();
  const nowIso = new Date().toISOString();
  const nowEpoch = Math.floor(Date.now() / 1000);
  const leaseUntil = nowEpoch + PLANNING_LEASE_SECONDS;

  try {
    await ddb.send(new UpdateItemCommand({
      TableName: JOBS_TABLE,
      Key: { jobId: { S: jobId } },
      UpdateExpression: 'SET #status = :planning, updatedAt = :updatedAt, #error = :noError, planningAttemptId = :attemptId, planningLeaseUntil = :leaseUntil',
      ConditionExpression: 'attribute_exists(jobId) AND (#status = :received OR #status = :failed OR (#status = :planning AND (attribute_not_exists(planningLeaseUntil) OR planningLeaseUntil < :nowEpoch)))',
      ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
      ExpressionAttributeValues: {
        ':planning': { S: 'PLANNING' },
        ':received': { S: 'RECEIVED' },
        ':failed': { S: 'FAILED' },
        ':updatedAt': { S: nowIso },
        ':noError': { NULL: true },
        ':attemptId': { S: attemptId },
        ':leaseUntil': { N: String(leaseUntil) },
        ':nowEpoch': { N: String(nowEpoch) }
      }
    }));
    return { claimed: true, attemptId };
  } catch (error) {
    if (error?.name !== 'ConditionalCheckFailedException') throw error;
    return { claimed: false, current: await getJob(jobId) };
  }
}

async function markRendering(jobId, attemptId, sceneS3Key) {
  await ddb.send(new UpdateItemCommand({
    TableName: JOBS_TABLE,
    Key: { jobId: { S: jobId } },
    UpdateExpression: 'SET #status = :rendering, updatedAt = :updatedAt, #error = :noError, sceneS3Key = :sceneS3Key REMOVE planningAttemptId, planningLeaseUntil',
    ConditionExpression: '#status = :planning AND planningAttemptId = :attemptId',
    ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
    ExpressionAttributeValues: {
      ':rendering': { S: 'RENDERING' },
      ':planning': { S: 'PLANNING' },
      ':updatedAt': { S: new Date().toISOString() },
      ':noError': { NULL: true },
      ':sceneS3Key': { S: sceneS3Key },
      ':attemptId': { S: attemptId }
    }
  }));
}

async function markFailed(jobId, attemptId, error) {
  await ddb.send(new UpdateItemCommand({
    TableName: JOBS_TABLE,
    Key: { jobId: { S: jobId } },
    UpdateExpression: 'SET #status = :failed, updatedAt = :updatedAt, #error = :error REMOVE planningAttemptId, planningLeaseUntil',
    ConditionExpression: '#status = :planning AND planningAttemptId = :attemptId',
    ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
    ExpressionAttributeValues: {
      ':failed': { S: 'FAILED' },
      ':planning': { S: 'PLANNING' },
      ':updatedAt': { S: new Date().toISOString() },
      ':error': { S: String(error?.message || error).slice(0, 1000) },
      ':attemptId': { S: attemptId }
    }
  }));
}

async function invokeCopyModel(copyInput) {
  const response = await bedrock.send(new ConverseCommand({
    modelId: PLANNER_MODEL_ID,
    system: [{ text: plannerPrompt }],
    messages: [{
      role: 'user',
      content: [{ text: 'copyInput:\n' + JSON.stringify(copyInput) }]
    }],
    inferenceConfig: {
      maxTokens: 8000,
      temperature: 0.35
    }
  }));

  const outputText = (response.output?.message?.content || []).map(x => x.text || '').join('').trim();
  const parsed = parseJsonObject(outputText);
  validateCopyResponse(copyInput, parsed);

  console.log(JSON.stringify({
    event: 'llm-copy-completed',
    inputTokens: response.usage?.inputTokens,
    outputTokens: response.usage?.outputTokens,
    totalTokens: response.usage?.totalTokens,
    latencyMs: response.metrics?.latencyMs
  }));

  return parsed;
}

async function processMessage(context) {
  const { jobId, bettingsS3Key } = context.message;
  const deterministicS3Key = 'working/' + jobId + '/deterministic-scene-plan.json';
  const sceneS3Key = 'working/' + jobId + '/scene.json';

  const before = await getJob(jobId);
  if ((before.status === 'RENDERING' || before.status === 'READY') && before.sceneS3Key) {
    return { jobId, status: before.status, sceneS3Key: before.sceneS3Key, idempotent: true };
  }

  const recovered = await tryGetJsonFromS3(sceneS3Key);
  if (recovered) {
    schemaCheck(validateScenePlanSchema, recovered, 'scene.json');
    return { jobId, status: before.status, sceneS3Key, idempotent: true, recovered: true };
  }

  const claim = await claimJob(jobId);
  if (!claim.claimed) {
    if ((claim.current.status === 'RENDERING' || claim.current.status === 'READY') && claim.current.sceneS3Key) {
      return { jobId, status: claim.current.status, sceneS3Key: claim.current.sceneS3Key, idempotent: true };
    }
    if (claim.current.status === 'PLANNING') {
      return { jobId, status: 'PLANNING', idempotent: true, inFlight: true };
    }
    throw new Error('Job ' + jobId + ' is not claimable from status ' + claim.current.status + '.');
  }

  const attemptId = claim.attemptId;

  try {
    const bettings = await getJsonFromS3(bettingsS3Key);
    schemaCheck(validateBettingsSchema, bettings, 'bettings.json');

    const deterministicPlan = buildDeterministicScenePlan(bettings);
    await putJsonToS3(deterministicS3Key, deterministicPlan);

    const copyInput = buildLlmCopyInput(bettings, deterministicPlan);
    const copyResponse = await invokeCopyModel(copyInput);
    const finalPlan = mergeCopyIntoPlan(deterministicPlan, copyResponse);

    schemaCheck(validateScenePlanSchema, finalPlan, 'scene.json');
    await putJsonToS3(sceneS3Key, finalPlan);
    await markRendering(jobId, attemptId, sceneS3Key);

    return {
      jobId,
      status: 'RENDERING',
      deterministicS3Key,
      sceneS3Key,
      sceneCount: finalPlan.scenes.length
    };
  } catch (error) {
    try { await markFailed(jobId, attemptId, error); } catch (_) {}
    throw error;
  }
}

exports.__test = {
  validatePlanningMessage,
  normalizeEvent,
  invokeCopyModel
};

exports.handler = async event => {
  if (!STORAGE_BUCKET || !JOBS_TABLE || !PLANNER_MODEL_ID) {
    throw new Error('Missing required scene planner environment configuration.');
  }
  const contexts = normalizeEvent(event);
  const results = [];
  for (const context of contexts) results.push(await processMessage(context));
  return { processed: results.length, results };
};
