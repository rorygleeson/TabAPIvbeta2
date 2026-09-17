'use strict';

const assert = require('assert');

process.env.STORAGE_BUCKET = 'test-bucket';
process.env.JOBS_TABLE = 'test-jobs';
process.env.PLANNER_MODEL_ID = 'test-model';

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

console.log('Scene planner Lambda entrypoint smoke tests passed.');
