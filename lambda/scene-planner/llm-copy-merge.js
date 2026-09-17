'use strict';

const { loadContract } = require('./contract-loader');
const sceneContracts = loadContract('scene-contracts.json');

function mergeCopyIntoPlan(deterministicPlan, copyResponse, contracts = sceneContracts) {
  validateDeterministicPlanEnvelope(deterministicPlan);
  validateCopyEnvelope(copyResponse, deterministicPlan);

  const scenes = deterministicPlan.scenes.map((scene, sceneIndex) => {
    const copyScene = copyResponse.scenes[sceneIndex];
    const allowedFields = llmFieldsForScene(scene.sceneType, contracts);

    validateCopyScene(copyScene, sceneIndex, allowedFields);

    const merged = { ...scene };
    for (const field of allowedFields) {
      merged[field] = clone(copyScene[field]);
    }
    return merged;
  });

  return {
    planVersion: '2.0',
    scenes
  };
}

function validateDeterministicPlanEnvelope(plan) {
  if (!plan || plan.artifactType !== 'deterministicScenePlan' ||
      plan.artifactVersion !== '1.0' || !Array.isArray(plan.scenes)) {
    throw new TypeError('deterministicPlan must be artifactType deterministicScenePlan version 1.0.');
  }
}

function validateCopyEnvelope(copyResponse, deterministicPlan) {
  if (!copyResponse || typeof copyResponse !== 'object' || !Array.isArray(copyResponse.scenes)) {
    throw new TypeError('copyResponse.scenes must be an array.');
  }

  if (copyResponse.scenes.length !== deterministicPlan.scenes.length) {
    throw new Error(
      'copyResponse must contain exactly one copy item for every deterministic scene.'
    );
  }
}

function llmFieldsForScene(sceneType, contracts) {
  const fields = contracts.scenes?.[String(sceneType)]?.fields;
  if (!fields) throw new Error('Missing scene contract for sceneType ' + sceneType + '.');

  return Object.entries(fields)
    .filter(([, definition]) =>
      definition && typeof definition === 'object' && definition.source === 'LLM'
    )
    .map(([name]) => name);
}

function validateCopyScene(copyScene, sceneIndex, allowedFields) {
  if (!copyScene || typeof copyScene !== 'object' || Array.isArray(copyScene)) {
    throw new TypeError('copyResponse scene ' + sceneIndex + ' must be an object.');
  }

  if (copyScene.sceneIndex !== sceneIndex) {
    throw new Error(
      'copyResponse scene index mismatch at position ' + sceneIndex + '.'
    );
  }

  const allowedKeys = new Set(['sceneIndex', ...allowedFields]);
  for (const key of Object.keys(copyScene)) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        'copyResponse scene ' + sceneIndex + ' contains non-LLM field ' + key + '.'
      );
    }
  }

  for (const field of allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(copyScene, field)) {
      throw new Error(
        'copyResponse scene ' + sceneIndex + ' is missing required LLM field ' + field + '.'
      );
    }
  }
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  }
  return value;
}

module.exports = {
  mergeCopyIntoPlan,
  llmFieldsForScene
};
