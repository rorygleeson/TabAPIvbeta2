'use strict';

function parseJsonObject(text) {
  const source = String(text || '').trim();
  if (!source) throw new Error('LLM returned no text content.');

  try {
    return JSON.parse(source);
  } catch (_) {
    const first = source.indexOf('{');
    const last = source.lastIndexOf('}');
    if (first < 0 || last <= first) throw new Error('LLM output is not valid JSON.');
    try {
      return JSON.parse(source.slice(first, last + 1));
    } catch (error) {
      throw new Error('LLM output is not valid JSON: ' + error.message);
    }
  }
}

function validateCopyResponse(copyInput, response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('LLM copy response must be an object.');
  }
  const topKeys = Object.keys(response);
  if (topKeys.length !== 1 || topKeys[0] !== 'scenes' || !Array.isArray(response.scenes)) {
    throw new Error('LLM copy response must contain only a scenes array.');
  }
  if (response.scenes.length !== copyInput.scenes.length) {
    throw new Error('LLM copy response scene count does not match copy input.');
  }

  response.scenes.forEach((item, index) => {
    const source = copyInput.scenes[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('LLM copy scene ' + index + ' must be an object.');
    }
    if (item.sceneIndex !== index) {
      throw new Error('LLM copy sceneIndex mismatch at scene ' + index + '.');
    }

    const fieldRules = source.requiredFields || {};
    const allowed = new Set(['sceneIndex', ...Object.keys(fieldRules)]);
    for (const key of Object.keys(item)) {
      if (!allowed.has(key)) throw new Error('LLM copy scene ' + index + ' returned unexpected field ' + key + '.');
    }

    for (const [field, rule] of Object.entries(fieldRules)) {
      if (!Object.prototype.hasOwnProperty.call(item, field)) {
        throw new Error('LLM copy scene ' + index + ' missing field ' + field + '.');
      }
      validateField(item[field], rule, index, field);
    }

    if (source.sceneType === 8 && Array.isArray(item.comments)) {
      if (item.comments.length !== source.betSequences.length) {
        throw new Error('Scene 8 comments count must equal betSequences count.');
      }
    }

    if (source.sceneType === 6 && item.standoutHighlightType) {
      const eligible = new Set((source.context?.standoutOptions || []).map(x => x.type));
      if (!eligible.has(item.standoutHighlightType)) {
        throw new Error('Scene 6 standoutHighlightType is not eligible.');
      }
    }

    if (source.sceneType === 7 && Array.isArray(item.selectedFinalHighlights)) {
      const eligible = new Set((source.context?.availableFinalHighlights || []).map(x => x.type));
      for (const value of item.selectedFinalHighlights) {
        if (!eligible.has(value)) throw new Error('Scene 7 selectedFinalHighlights contains ineligible value ' + value + '.');
      }
      if (new Set(item.selectedFinalHighlights).size !== item.selectedFinalHighlights.length) {
        throw new Error('Scene 7 selectedFinalHighlights must be unique.');
      }
    }
  });

  return response;
}

function validateField(value, rule, sceneIndex, field) {
  const label = 'Scene ' + sceneIndex + ' field ' + field;

  if (rule.enum) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!rule.enum.includes(item)) throw new Error(label + ' contains value outside enum.');
      }
    } else if (!rule.enum.includes(value)) {
      throw new Error(label + ' is outside enum.');
    }
  }

  if (typeof value === 'string') {
    if (!value.trim()) throw new Error(label + ' must not be empty.');
    if (rule.maxChars && value.length > rule.maxChars) throw new Error(label + ' exceeds maxChars.');
    if (rule.maxWords && countWords(value) > rule.maxWords) throw new Error(label + ' exceeds maxWords.');
    if (/[<>]/u.test(value)) throw new Error(label + ' contains forbidden markup.');
    return;
  }

  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) throw new Error(label + ' has too few items.');
    if (rule.maxItems !== undefined && value.length > rule.maxItems) throw new Error(label + ' has too many items.');
    for (const item of value) {
      if (typeof item !== 'string' || !item.trim()) throw new Error(label + ' items must be non-empty strings.');
      if (rule.itemMaxChars && item.length > rule.itemMaxChars) throw new Error(label + ' item exceeds itemMaxChars.');
      if (rule.itemMaxWords && countWords(item) > rule.itemMaxWords) throw new Error(label + ' item exceeds itemMaxWords.');
      if (/[<>]/u.test(item)) throw new Error(label + ' item contains forbidden markup.');
    }
    return;
  }

  if (rule.enum) return;
  throw new Error(label + ' has unsupported value type.');
}

function countWords(value) {
  return String(value).trim().split(/\s+/u).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
}

module.exports = {
  parseJsonObject,
  validateCopyResponse,
  countWords
};
