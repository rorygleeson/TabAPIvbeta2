'use strict';

const ATOM_ID_PATTERN = /^[A-Z][A-Z0-9_]*$/u;
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
  if (!Array.isArray(response.scenes)) {
    throw new Error('LLM copy response must contain a scenes array.');
  }
  if (response.scenes.length !== copyInput.scenes.length) {
    throw new Error('LLM copy response scene count does not match copy input.');
  }

  const normalized = { scenes: [] };

  response.scenes.forEach((item, index) => {
    const source = copyInput.scenes[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('LLM copy scene ' + index + ' must be an object.');
    }
    if (item.sceneIndex !== index) {
      throw new Error('LLM copy sceneIndex mismatch at scene ' + index + '.');
    }

    const fieldRules = source.requiredFields || {};
    const normalizedItem = { sceneIndex: index };

    for (const [field, rule] of Object.entries(fieldRules)) {
      if (!Object.prototype.hasOwnProperty.call(item, field)) {
        throw new Error('LLM copy scene ' + index + ' missing field ' + field + '.');
      }
      const value = normalizeGroundedValue(item[field], rule, source, index, field, copyInput);
      validateField(value, rule, index, field);
      normalizedItem[field] = value;
    }

    if (source.sceneType === 8 && Array.isArray(normalizedItem.comments)) {
      if (normalizedItem.comments.length !== source.betSequences.length) {
        throw new Error('Scene 8 comments count must equal betSequences count.');
      }
    }

    if (source.sceneType === 6 && normalizedItem.standoutHighlightType) {
      const eligible = new Set((source.context?.standoutOptions || []).map(x => x.type));
      if (!eligible.has(normalizedItem.standoutHighlightType)) {
        throw new Error('Scene 6 standoutHighlightType is not eligible.');
      }
    }

    if (source.sceneType === 7 && Array.isArray(normalizedItem.selectedFinalHighlights)) {
      const eligible = new Set((source.context?.availableFinalHighlights || []).map(x => x.type));
      for (const value of normalizedItem.selectedFinalHighlights) {
        if (!eligible.has(value)) throw new Error('Scene 7 selectedFinalHighlights contains ineligible value ' + value + '.');
      }
      if (new Set(normalizedItem.selectedFinalHighlights).size !== normalizedItem.selectedFinalHighlights.length) {
        throw new Error('Scene 7 selectedFinalHighlights must be unique.');
      }
    }

    normalized.scenes.push(normalizedItem);
  });

  return normalized;
}

function validateCopyResponseWithFieldFallback(copyInput, response, fallbackCopy) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('LLM copy response must be an object.');
  }
  if (!Array.isArray(response.scenes)) {
    throw new Error('LLM copy response must contain a scenes array.');
  }
  if (response.scenes.length !== copyInput.scenes.length) {
    throw new Error('LLM copy response scene count does not match copy input.');
  }
  if (!fallbackCopy || !Array.isArray(fallbackCopy.scenes) || fallbackCopy.scenes.length !== copyInput.scenes.length) {
    throw new Error('Field fallback copy does not match copy input.');
  }

  const normalized = { scenes: [] };
  const repairs = [];

  response.scenes.forEach((item, index) => {
    const source = copyInput.scenes[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('LLM copy scene ' + index + ' must be an object.');
    }
    if (item.sceneIndex !== index) {
      throw new Error('LLM copy sceneIndex mismatch at scene ' + index + '.');
    }

    const fallbackItem = fallbackCopy.scenes[index] || {};
    const normalizedItem = { sceneIndex: index };

    for (const [field, rule] of Object.entries(source.requiredFields || {})) {
      try {
        if (!Object.prototype.hasOwnProperty.call(item, field)) {
          throw new Error('LLM copy scene ' + index + ' missing field ' + field + '.');
        }
        const value = normalizeGroundedValue(item[field], rule, source, index, field, copyInput);
        validateField(value, rule, index, field);
        validateSceneSpecificField(source, field, value);
        normalizedItem[field] = value;
      } catch (error) {
        if (!Object.prototype.hasOwnProperty.call(fallbackItem, field)) throw error;
        const fallbackValue = normalizeGroundedValue(fallbackItem[field], rule, source, index, field, copyInput);
        validateField(fallbackValue, rule, index, field);
        validateSceneSpecificField(source, field, fallbackValue);
        normalizedItem[field] = fallbackValue;
        repairs.push({
          sceneIndex: index,
          field,
          reason: String(error?.message || error).slice(0, 1000)
        });
      }
    }

    normalized.scenes.push(normalizedItem);
  });

  return { copy: normalized, repairs };
}

function validateSceneSpecificField(source, field, value) {
  if (source.sceneType === 8 && field === 'comments') {
    if (!Array.isArray(value) || value.length !== source.betSequences.length) {
      throw new Error('Scene 8 comments count must equal betSequences count.');
    }
  }

  if (source.sceneType === 6 && field === 'standoutHighlightType') {
    const eligible = new Set((source.context?.standoutOptions || []).map(x => x.type));
    if (!eligible.has(value)) throw new Error('Scene 6 standoutHighlightType is not eligible.');
  }

  if (source.sceneType === 7 && field === 'selectedFinalHighlights') {
    const eligible = new Set((source.context?.availableFinalHighlights || []).map(x => x.type));
    for (const item of value) {
      if (!eligible.has(item)) throw new Error('Scene 7 selectedFinalHighlights contains ineligible value ' + item + '.');
    }
    if (new Set(value).size !== value.length) {
      throw new Error('Scene 7 selectedFinalHighlights must be unique.');
    }
  }
}

function normalizeGroundedValue(value, rule, source, sceneIndex, field, copyInput) {
  if (rule.responseType === 'enum' || rule.enum) return clone(value);

  if (rule.responseType === 'groundedText') {
    return expandGroundedText(value, source, rule.phase, null, sceneIndex, field, copyInput);
  }

  if (rule.responseType === 'groundedTextArray') {
    if (!Array.isArray(value)) {
      throw new Error('Scene ' + sceneIndex + ' field ' + field + ' must be an array of grounded strings.');
    }
    return value.map((item, itemIndex) =>
      expandGroundedText(item, source, rule.phase, itemIndex, sceneIndex, field, copyInput)
    );
  }

  throw new Error('Scene ' + sceneIndex + ' field ' + field + ' has unsupported responseType.');
}

function expandGroundedText(value, source, phase, itemIndex, sceneIndex, field, copyInput) {
  const label = 'Scene ' + sceneIndex + ' field ' + field + (itemIndex === null ? '' : '[' + itemIndex + ']');
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(label + ' must be a non-empty grounded string.');
  }

  // Grounded facts use compact <ATOM_ID> references. Any other angle-bracket
  // syntax is rejected so malformed placeholders or markup cannot leak through.
  const placeholderPattern = /<([A-Z][A-Z0-9_]*)>/gu;
  const withoutValidPlaceholders = value.replace(placeholderPattern, '');
  if (/[<>]/u.test(withoutValidPlaceholders)) {
    throw new Error(label + ' contains malformed fact placeholder syntax.');
  }

  const atomMap = atomsForPhase(source, phase, itemIndex, copyInput);
  return value.replace(placeholderPattern, (token, id) => {
    if (!ATOM_ID_PATTERN.test(id) || !Object.prototype.hasOwnProperty.call(atomMap, id)) {
      throw new Error(label + ' references unknown or wrong-phase fact atom ' + id + '.');
    }
    return String(atomMap[id]);
  });
}

function atomsForPhase(source, phase, itemIndex, copyInput) {
  const localScoped = source.context?.factAtomsByPhase?.[phase];
  let localAtoms = {};
  if (Array.isArray(localScoped)) {
    if (Number.isInteger(itemIndex) && localScoped[itemIndex] && typeof localScoped[itemIndex] === 'object') {
      localAtoms = localScoped[itemIndex];
    }
  } else if (localScoped && typeof localScoped === 'object') {
    localAtoms = localScoped;
  }

  const allowedScoped = source.context?.allowedGlobalFactIdsByPhase?.[phase];
  let allowedIds = [];
  if (Array.isArray(allowedScoped) && allowedScoped.length > 0 && Array.isArray(allowedScoped[0])) {
    allowedIds = Number.isInteger(itemIndex) ? (allowedScoped[itemIndex] || []) : [];
  } else if (Array.isArray(allowedScoped)) {
    allowedIds = allowedScoped;
  }

  const catalog = copyInput?.factCatalog || {};
  const globalAtoms = {};
  for (const id of allowedIds) {
    if (Object.prototype.hasOwnProperty.call(catalog, id)) globalAtoms[id] = catalog[id];
  }

  return { ...globalAtoms, ...localAtoms };
}

function hardCharLimit(target) {
  const n = Number(target);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n + Math.min(Math.ceil(n * 0.10), 12);
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
    return;
  }

  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) throw new Error(label + ' has too few items.');
    if (rule.maxItems !== undefined && value.length > rule.maxItems) throw new Error(label + ' has too many items.');
    for (const item of value) {
      if (typeof item !== 'string' || !item.trim()) throw new Error(label + ' items must be non-empty strings.');
    }
    return;
  }

  if (rule.enum) return;
  throw new Error(label + ' has unsupported value type.');
}

function countWords(value) {
  return String(value).trim().split(/\s+/u).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  parseJsonObject,
  validateCopyResponse,
  validateCopyResponseWithFieldFallback,
  countWords,
  hardCharLimit,
  __test: {
    atomsForPhase,
    expandGroundedText
  }
};
