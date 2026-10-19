'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.STORAGE_BUCKET = 'test-bucket';
process.env.JOBS_TABLE = 'test-jobs';
process.env.PLANNING_QUEUE_URL = 'https://sqs.ap-southeast-2.amazonaws.com/123456789012/test-planning';

const orchestrator = require('./index');

const baseline = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'fixtures', 'bettings-baseline.json'), 'utf8')
);

function postEvent(body) {
  return {
    httpMethod: 'POST',
    resource: '/jobs',
    body,
    isBase64Encoded: false,
    requestContext: { requestId: 'test-request-id' }
  };
}

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

// Response headers are additive; status codes and bodies remain unchanged.
const corsResponse = orchestrator.__test.jsonResponse(202, { jobId: 'test', status: 'RECEIVED' });
assert.strictEqual(corsResponse.headers['Access-Control-Allow-Origin'], 'https://d1dcueurs1xl4v.cloudfront.net');
assert.strictEqual(corsResponse.headers['Content-Type'], 'application/json');
assert.strictEqual(corsResponse.statusCode, 202);
assert.deepStrictEqual(JSON.parse(corsResponse.body), { jobId: 'test', status: 'RECEIVED' });
const corsError = orchestrator.__test.apiErrorResponse(new orchestrator.__test.ApiError(400, 'BAD', 'Bad request'), 'req-1');
assert.strictEqual(corsError.headers['Access-Control-Allow-Origin'], 'https://d1dcueurs1xl4v.cloudfront.net');
assert.strictEqual(corsError.statusCode, 400);

const parsed = orchestrator.__test.parseCanonicalBettings(
  postEvent(JSON.stringify(baseline))
);
assert.strictEqual(parsed.bettings.bets.length, baseline.bets.length);
assert.strictEqual(parsed.betCount, baseline.bets.length);
assert.ok(parsed.payloadBytes > 0);

// Trifecta is admitted using the shared contract and semantic validator.
const trifectaPayload = structuredClone(baseline);
const trifectaBet = trifectaPayload.bets.find(bet => bet.result === 'LOSS');
assert.ok(trifectaBet, 'baseline must contain a losing bet');
delete trifectaBet.runnerId;
trifectaBet.betType = 'TRIFECTA';
trifectaBet.runnerNumber = null;
trifectaBet.runnerName = null;
trifectaBet.odds = null;
trifectaBet.finishingPosition = null;
trifectaBet.selectedRunners = [
  { runnerNumber: 2, runnerName: 'RUNNER TWO', finishingPosition: 0 },
  { runnerNumber: 8, runnerName: 'RUNNER EIGHT', finishingPosition: 2 },
  { runnerNumber: 11, runnerName: 'RUNNER ELEVEN', finishingPosition: null }
];
const admittedTrifecta = orchestrator.__test.parseCanonicalBettings(
  postEvent(JSON.stringify(trifectaPayload))
);
assert.strictEqual(admittedTrifecta.bettings.bets.find(bet => bet.betType === 'TRIFECTA').selectedRunners.length, 3);

const invalidTrifectaPayload = structuredClone(trifectaPayload);
invalidTrifectaPayload.bets.find(bet => bet.betType === 'TRIFECTA').selectedRunners[1].runnerNumber = 2;
assert.throws(
  () => orchestrator.__test.parseCanonicalBettings(postEvent(JSON.stringify(invalidTrifectaPayload))),
  error => error.errorCode === 'KUBRICK_INVALID_PAYLOAD' && error.statusCode === 400
);

const baselineWithoutOptionalIds = structuredClone(baseline);
baselineWithoutOptionalIds.bets.forEach(bet => {
  delete bet.raceId;
  delete bet.runnerId;
});
const parsedWithoutOptionalIds = orchestrator.__test.parseCanonicalBettings(
  postEvent(JSON.stringify(baselineWithoutOptionalIds))
);
assert.strictEqual(parsedWithoutOptionalIds.bettings.bets.length, baseline.bets.length);
assert.ok(parsedWithoutOptionalIds.bettings.bets.every(
  bet => !Object.prototype.hasOwnProperty.call(bet, 'raceId') &&
         !Object.prototype.hasOwnProperty.call(bet, 'runnerId')
));

assert.throws(
  () => orchestrator.__test.parseCanonicalBettings(postEvent('{bad json')),
  error =>
    error.errorCode === 'KUBRICK_INVALID_JSON' &&
    error.statusCode === 400
);

assert.throws(
  () => orchestrator.__test.parseCanonicalBettings(
    postEvent(JSON.stringify({ bets: [{ sequence: 1 }] }))
  ),
  error =>
    error.errorCode === 'KUBRICK_INVALID_PAYLOAD' &&
    error.statusCode === 400 &&
    Array.isArray(error.details) &&
    error.details.length > 0
);

const badTotalBets = structuredClone(baseline);
badTotalBets.summary.totalBets += 1;
assert.throws(
  () => orchestrator.__test.parseCanonicalBettings(
    postEvent(JSON.stringify(badTotalBets))
  ),
  error =>
    error.errorCode === 'KUBRICK_INVALID_PAYLOAD' &&
    error.details.some(detail => /summary\.totalBets does not equal bets\.length/.test(detail))
);

const badRunningPnl = structuredClone(baseline);
badRunningPnl.bets[1].runningPnl += 1;
assert.throws(
  () => orchestrator.__test.parseCanonicalBettings(
    postEvent(JSON.stringify(badRunningPnl))
  ),
  error =>
    error.errorCode === 'KUBRICK_INVALID_PAYLOAD' &&
    error.details.some(detail => /runningPnl is inconsistent/.test(detail))
);

const badReplayUrl = structuredClone(baseline);
badReplayUrl.bets[0].replayUrl = 'http://example.com/replay.mp4';
assert.throws(
  () => orchestrator.__test.parseCanonicalBettings(
    postEvent(JSON.stringify(badReplayUrl))
  ),
  error =>
    error.errorCode === 'KUBRICK_INVALID_PAYLOAD' &&
    error.details.some(detail => /replayUrl must be a valid non-empty HTTPS URL or null/.test(detail))
);

const response = orchestrator.__test.jsonResponse(202, { jobId: 'abc', status: 'RECEIVED' });
assert.strictEqual(response.statusCode, 202);
assert.strictEqual(JSON.parse(response.body).status, 'RECEIVED');

const planningFailure = orchestrator.__test.failedJobPublicFields({});
assert.deepStrictEqual(planningFailure, {
  failureCode: 'KUBRICK_PLANNING_FAILED',
  failedStage: 'PLANNING',
  message: 'Kubrick could not complete planning.'
});

const renderingFailure = orchestrator.__test.failedJobPublicFields({
  sceneS3Key: { S: 'working/job/scene.json' }
});
assert.deepStrictEqual(renderingFailure, {
  failureCode: 'KUBRICK_RENDERING_FAILED',
  failedStage: 'RENDERING',
  message: 'Kubrick could not complete rendering.'
});

(async () => {
  const invalidResponse = await orchestrator.handler(
    postEvent(JSON.stringify(badTotalBets))
  );
  assert.strictEqual(invalidResponse.statusCode, 400);
  const invalidBody = JSON.parse(invalidResponse.body);
  assert.strictEqual(invalidBody.errorCode, 'KUBRICK_INVALID_PAYLOAD');
  assert.strictEqual(invalidBody.requestId, 'test-request-id');
  assert.ok(!Object.prototype.hasOwnProperty.call(invalidBody, 'jobId'));

  const badJsonResponse = await orchestrator.handler(postEvent('{bad json'));
  assert.strictEqual(badJsonResponse.statusCode, 400);
  assert.strictEqual(
    JSON.parse(badJsonResponse.body).errorCode,
    'KUBRICK_INVALID_JSON'
  );

  const routeResponse = await orchestrator.handler({
    httpMethod: 'DELETE',
    resource: '/jobs/{jobId}',
    requestContext: { requestId: 'route-request-id' }
  });
  assert.strictEqual(routeResponse.statusCode, 404);
  const routeBody = JSON.parse(routeResponse.body);
  assert.strictEqual(routeBody.errorCode, 'KUBRICK_ROUTE_NOT_FOUND');
  assert.strictEqual(routeBody.requestId, 'route-request-id');

  console.log('Orchestrator strict admission and direct error tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
