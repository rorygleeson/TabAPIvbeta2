'use strict';

const assert = require('assert');

process.env.STORAGE_BUCKET = 'test-bucket';
process.env.JOBS_TABLE = 'test-jobs';
process.env.PLANNING_QUEUE_URL = 'https://sqs.ap-southeast-2.amazonaws.com/123456789012/test-planning';

const orchestrator = require('./index');

assert.strictEqual(
  orchestrator.__test.route({ httpMethod: 'POST', resource: '/jobs' }),
  'CREATE_JOB'
);
assert.strictEqual(
  orchestrator.__test.route({ httpMethod: 'GET', resource: '/jobs/{jobId}' }),
  'GET_JOB'
);
assert.strictEqual(
  orchestrator.__test.route({ httpMethod: 'DELETE', resource: '/jobs/{jobId}' }),
  null
);

const parsed = orchestrator.__test.parseCanonicalBettings({
  body: JSON.stringify({ bets: [{ sequence: 1 }] }),
  isBase64Encoded: false
});
assert.strictEqual(parsed.bets.length, 1);

assert.throws(
  () => orchestrator.__test.parseCanonicalBettings({ body: '{}' }),
  /non-empty bets array/
);

const response = orchestrator.__test.jsonResponse(202, { jobId: 'abc', status: 'RECEIVED' });
assert.strictEqual(response.statusCode, 202);
assert.strictEqual(JSON.parse(response.body).status, 'RECEIVED');

console.log('Orchestrator Lambda entrypoint smoke tests passed.');
