'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { getSignedUrl: signCloudFrontUrl } = require('@aws-sdk/cloudfront-signer');

const client = new SecretsManagerClient({});
let cachedKeyPromise;

async function loadPrivateKey(secretId) {
  if (!cachedKeyPromise) {
    cachedKeyPromise = client.send(new GetSecretValueCommand({ SecretId: secretId }))
      .then(result => {
        const privateKey = result.SecretString ||
          (result.SecretBinary && Buffer.from(result.SecretBinary).toString('utf8'));
        if (!privateKey || !privateKey.includes('PRIVATE KEY-----')) {
          throw new Error('CloudFront signing secret must contain a PEM private key.');
        }
        return privateKey;
      }).catch(error => {
        cachedKeyPromise = undefined;
        throw error;
      });
  }
  return cachedKeyPromise;
}

function cloudFrontPath(key) {
  // Origin path is /recaps, so do not include that prefix in the viewer URL.
  if (typeof key !== 'string' || !/^recaps\/[0-9a-fA-F-]{36}\/recap\.html$/.test(key)) {
    throw new Error('Invalid recap object key for CloudFront URL.');
  }
  return key.slice('recaps/'.length).split('/').map(encodeURIComponent).join('/');
}

async function signRecapUrl({ key, provider, s3Signer }) {
  if (provider === 'S3') return s3Signer();
  if (provider !== 'CLOUDFRONT') throw new Error('Unsupported RECAP_URL_PROVIDER.');

  const domain = process.env.CLOUDFRONT_RECAP_DOMAIN;
  const keyPairId = process.env.CLOUDFRONT_PUBLIC_KEY_ID;
  const secretId = process.env.CLOUDFRONT_SIGNING_SECRET_ID;
  const ttl = Number(process.env.CLOUDFRONT_URL_TTL_SECONDS);
  if (!/^[a-z0-9.-]+\.cloudfront\.net$/.test(domain || '') ||
      !keyPairId || !secretId || !Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new Error('Invalid CloudFront signing configuration.');
  }

  const url = 'https://' + domain + '/' + cloudFrontPath(key);
  const privateKey = await loadPrivateKey(secretId);
  return signCloudFrontUrl({
    url,
    keyPairId,
    privateKey,
    dateLessThan: new Date(Date.now() + ttl * 1000).toISOString()
  });
}

module.exports = { signRecapUrl, cloudFrontPath };
