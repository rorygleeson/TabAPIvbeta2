'use strict';

const assert = require('assert');

process.env.STORAGE_BUCKET = 'test-bucket';
process.env.JOBS_TABLE = 'test-jobs';
process.env.PLANNER_MODEL_ID = 'test-model';
process.env.RENDERING_QUEUE_URL = 'https://sqs.ap-southeast-2.amazonaws.com/123456789012/test-rendering';

const planner = require('./index');

assert.deepStrictEqual(
  planner.__test.validatePlanningMessage({
    jobId: 'abc',
    bettingsS3Key: 'working/abc/bettings.json'
  }),
  {
    jobId: 'abc',
    bettingsS3Key: 'working/abc/bettings.json'
  }
);

assert.throws(
  () => planner.__test.validatePlanningMessage({
    jobId: 'abc',
    bettingsS3Key: 'working/other/bettings.json'
  }),
  /bettingsS3Key must equal/
);

const normalized = planner.__test.normalizeEvent({
  jobId: 'abc',
  bettingsS3Key: 'working/abc/bettings.json'
});
assert.strictEqual(normalized.length, 1);
assert.strictEqual(normalized[0].source, 'direct');

assert.deepStrictEqual(
  planner.__test.buildRenderingMessage(
    'abc',
    'working/abc/bettings.json',
    'working/abc/scene.json'
  ),
  {
    schemaVersion: '1.0',
    jobId: 'abc',
    bettingsS3Key: 'working/abc/bettings.json',
    sceneS3Key: 'working/abc/scene.json'
  }
);

console.log('Scene planner Lambda entrypoint smoke tests passed.');
