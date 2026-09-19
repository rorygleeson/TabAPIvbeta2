'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const scriptDir = __dirname;
const repoRoot = path.resolve(scriptDir, '..', '..');
const orchestratorPackage = path.join(repoRoot, 'lambda', 'orchestrator', 'package.json');
const requireFromOrchestrator = createRequire(orchestratorPackage);

let Ajv2020;
let addFormats;
try {
  Ajv2020 = requireFromOrchestrator('ajv/dist/2020');
  addFormats = requireFromOrchestrator('ajv-formats');
} catch (error) {
  process.stderr.write(JSON.stringify({
    valid: false,
    validatorError: true,
    errorCode: 'KUBRICK_VALIDATOR_DEPENDENCY_MISSING',
    message: 'Kubrick validator dependencies are not installed under lambda/orchestrator. Run npm install in lambda/orchestrator.',
    details: [String(error && error.message ? error.message : error)]
  }));
  process.exit(2);
}

const schemaPath = path.join(repoRoot, 'contracts', 'bettings.schema.json');
const semanticPath = path.join(repoRoot, 'shared', 'canonical-bettings-validator.js');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const { validateCanonicalBettingsSemantics } = require(semanticPath);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function schemaValidationDetails() {
  return (validateSchema.errors || []).map(error => {
    const location = error.instancePath || '/';
    return `${location} ${error.message}`.trim();
  });
}

function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    process.stderr.write(JSON.stringify({
      valid: false,
      validatorError: true,
      errorCode: 'KUBRICK_VALIDATOR_USAGE',
      message: 'Usage: node validate-kubrick.js <bettings.json>',
      details: []
    }));
    process.exit(2);
  }

  let value;
  try {
    value = JSON.parse(fs.readFileSync(path.resolve(payloadPath), 'utf8'));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      valid: false,
      validatorError: false,
      errorCode: 'KUBRICK_INVALID_JSON',
      message: 'Request body must contain valid JSON.',
      details: [String(error && error.message ? error.message : error)]
    }));
    process.exit(1);
  }

  if (!validateSchema(value)) {
    process.stdout.write(JSON.stringify({
      valid: false,
      validatorError: false,
      errorCode: 'KUBRICK_INVALID_PAYLOAD',
      message: 'Payload failed canonical bettings.json validation.',
      details: schemaValidationDetails()
    }));
    process.exit(1);
  }

  try {
    validateCanonicalBettingsSemantics(value);
  } catch (error) {
    process.stdout.write(JSON.stringify({
      valid: false,
      validatorError: false,
      errorCode: 'KUBRICK_INVALID_PAYLOAD',
      message: 'Payload failed canonical bettings.json validation.',
      details: [String(error && error.message ? error.message : error)]
    }));
    process.exit(1);
  }

  process.stdout.write(JSON.stringify({
    valid: true,
    validatorError: false,
    errorCode: null,
    message: 'Payload passed Kubrick canonical schema and semantic validation.',
    details: []
  }));
}

main();
