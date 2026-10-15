# Kubrick V2 — CloudFront signed recap URLs (manual setup)

Status: AWS CloudFront resources created manually, Orchestrator integration staged behind a feature flag. This document captures configuration observed on 15 October 2026. **Do not put signing PEM material into Git.**

## AWS inventory

- AWS account: `134387458447`; signing secret region: `ap-southeast-2`.
- Distribution: `kubrick-v2-recaps`, ID `E2AQIDN5G8P4BH`, hostname `d2bs94wi893l8l.cloudfront.net`.
- Origin: `tab-recap-vbeta1.s3.ap-southeast-2.amazonaws.com`; **origin path `/recaps`**.
- OAC/private S3 access enabled; distribution's **Default (*)** behaviour requires signed URLs using trusted key groups.
- Key group: `kubrick-v2-recap-signers`, ID `2c1af34e-8a47-41f8-9c83-d76ca95baa03`.
- CloudFront public key name `kubrick-v2-recaps-public-key`, ID `K1A957H4UJ9LQ9`, RSA 2048.
- Private key: plaintext PEM secret in Secrets Manager, name `kubrick/v2/cloudfront/signing-private-key`; ARN `arn:aws:secretsmanager:ap-southeast-2:134387458447:secret:kubrick/v2/cloudfront/signing-private-key-rXOVco`. Never copy its value into issue reports or logs.
- S3 bucket policy permits CloudFront service principal `s3:GetObject` **only** on `arn:aws:s3:::tab-recap-vbeta1/recaps/*` with AWS:SourceArn constrained to the distribution ARN.
- Existing S3 public access blocks remain enabled. Existing S3 presigning path is preserved as a rollback.

## API integration

On `GET /jobs/{jobId}` when READY, read the persisted `recapS3Key`, and sign a CloudFront viewer URL. **The CloudFront URL must omit `recaps/`** because the origin path already prepends it. Example: `https://d2bs94wi893l8l.cloudfront.net/{jobId}/recap.html?Expires=...&Signature=...&Key-Pair-Id=...`.

CloudFormation settings in `infra/orchestrator.yml`:
- `RECAP_URL_PROVIDER=S3` initially; switch to `CLOUDFRONT` only after independent integration test.
- `CLOUDFRONT_RECAP_DOMAIN`, `CLOUDFRONT_PUBLIC_KEY_ID`, `CLOUDFRONT_SIGNING_SECRET_ID`.
- `CLOUDFRONT_URL_TTL_SECONDS=31536000` (365 days).
- Runtime IAM permits `secretsmanager:GetSecretValue` on the named secret; this uses the AWS-managed `aws/secretsmanager` key.

The signing secret is loaded lazily when a READY result is signed and cached per warm Lambda execution environment. Errors fail the API call rather than printing the PEM. The JSON response field remains `recapUrl`; Normaliser requires no code change.

## Validation before switch

1. Confirm CloudFront deployment completed and unsigned requests yield `MissingKey` (already observed for an absent test object).
2. Test against an existing real recap: signed URL returns 200 and HTML, **the identical path without query signature returns 403**.
3. Attempt `/../working/`-style and ordinary `/working/...` paths; ensure no betting/work data is reachable. Origin path alone is NOT a permission boundary; S3 resource-prefix limitation is essential.
4. Validate 365-day expiry in the response, and that a second GET issues a fresh signature without re-rendering.
5. Verify original `GET /jobs/{jobId}` still returns S3 URL with provider=S3.
6. Change the IaC setting only when ready; deploy via explicit `deploy` branch action. Revert provider to S3 for rollback.

## Remaining security/operations decisions

- Year-long links are bearer credentials: anyone holding them can read the recap until expiry. Existing shared x-api-key is not per-user authorization.
- Ensure S3 object lifecycle retains recaps for intended access length; key removal or object deletion invalidates the link early.
- Rotate signing keys with overlap between old/new public keys. Do not enable generic Secrets Manager rotation without coordinated CloudFront trust changes.
- This distribution/keys/policy were configured manually. Recreate and verify for TAB AWS separately.
