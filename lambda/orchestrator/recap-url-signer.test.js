'use strict';
const assert = require('assert');
const { signRecapUrl, cloudFrontPath } = require('./recap-url-signer');
(async () => {
  assert.strictEqual(
    cloudFrontPath('recaps/123e4567-e89b-12d3-a456-426614174000/recap.html'),
    '123e4567-e89b-12d3-a456-426614174000/recap.html'
  );
  assert.throws(() => cloudFrontPath('working/abc/bettings.json'), /Invalid recap/);
  assert.throws(() => cloudFrontPath('recaps/../working/abc'), /Invalid recap/);
  assert.strictEqual(await signRecapUrl({provider:'S3',s3Signer:async()=> 's3-signed-url'}), 's3-signed-url');
  await assert.rejects(signRecapUrl({provider:'BOGUS',s3Signer:async()=>''}), /Unsupported/);
  process.env.CLOUDFRONT_RECAP_DOMAIN = 'd2bs94wi893l8l.cloudfront.net';
  process.env.CLOUDFRONT_PUBLIC_KEY_ID = 'test-public-key';
  process.env.CLOUDFRONT_SIGNING_SECRET_ID = 'test-secret';
  process.env.CLOUDFRONT_URL_TTL_SECONDS = '0';
  await assert.rejects(signRecapUrl({
    key:'recaps/123e4567-e89b-12d3-a456-426614174000/recap.html',provider:'CLOUDFRONT'
  }), /Invalid CloudFront signing configuration/);
  console.log('Recap URL signer validation and S3 fallback tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
