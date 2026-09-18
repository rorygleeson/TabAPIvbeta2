'use strict';

const ATOM_ID_PATTERN = /^[A-Z][A-Z0-9_]*$/u;
const RAW_CONCRETE_PATTERN = /[$%@]|\d/u;
const POSITION_WORD = '(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)';
const POSITION_CLAIM_PATTERN = new RegExp(
  '\\b(?:finished|finishing|ran|placed|came)\\s+' + POSITION_WORD + '\\b' +
  '|\\b(?:both|all)\\s+(?:(?:the\\s+)?(?:runners?|horses?)\\s+)?(?:finished\\s+|ran\\s+|placed\\s+|came\\s+)?' + POSITION_WORD + '\\b',
  'iu'
);

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
    const allowed = new Set(['sceneIndex', ...Object.keys(fieldRules)]);
    for (const key of Object.keys(item)) {
      if (!allowed.has(key)) throw new Error('LLM copy scene ' + index + ' returned unexpected field ' + key + '.');
    }

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

function normalizeGroundedValue(value, rule, source, sceneIndex, field, copyInput) {
  if (rule.responseType === 'enum' || rule.enum) return clone(value);

  if (rule.responseType === 'parts') {
    return composeParts(value, source, rule.phase, null, sceneIndex, field, copyInput);
  }

  if (rule.responseType === 'partsArray') {
    if (!Array.isArray(value)) {
      throw new Error('Scene ' + sceneIndex + ' field ' + field + ' must be an array of part arrays.');
    }
    return value.map((parts, itemIndex) =>
      composeParts(parts, source, rule.phase, itemIndex, sceneIndex, field, copyInput)
    );
  }

  throw new Error('Scene ' + sceneIndex + ' field ' + field + ' has unsupported responseType.');
}

function composeParts(parts, source, phase, itemIndex, sceneIndex, field, copyInput) {
  const label = 'Scene ' + sceneIndex + ' field ' + field + (itemIndex === null ? '' : '[' + itemIndex + ']');
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error(label + ' must be a non-empty array of text/fact parts.');
  }

  const atomMap = atomsForPhase(source, phase, itemIndex, copyInput);
  const rendered = [];

  parts.forEach((part, partIndex) => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      throw new Error(label + ' part ' + partIndex + ' must be an object.');
    }

    if (part.type === 'fact') {
      const keys = Object.keys(part);
      if (keys.length !== 2 || !keys.includes('type') || !keys.includes('id')) {
        throw new Error(label + ' fact part ' + partIndex + ' must contain only type and id.');
      }
      if (typeof part.id !== 'string' || !ATOM_ID_PATTERN.test(part.id)) {
        throw new Error(label + ' fact part ' + partIndex + ' has invalid atom id.');
      }
      if (!Object.prototype.hasOwnProperty.call(atomMap, part.id)) {
        throw new Error(label + ' references unknown or wrong-phase fact atom ' + part.id + '.');
      }
      const text = String(atomMap[part.id]);
      rendered.push({ kind: isClauseAtom(text) ? 'clause' : 'inline', text, partIndex });
      return;
    }

    if (part.type === 'text') {
      const keys = Object.keys(part);
      if (keys.length !== 2 || !keys.includes('type') || !keys.includes('text')) {
        throw new Error(label + ' text part ' + partIndex + ' must contain only type and text.');
      }
      if (typeof part.text !== 'string' || !part.text.length) {
        throw new Error(label + ' text part ' + partIndex + ' must contain non-empty text.');
      }
      validateNarrativeText(part.text, source, label + ' text part ' + partIndex, copyInput);
      rendered.push({ kind: 'text', text: part.text, partIndex });
      return;
    }

    throw new Error(label + ' part ' + partIndex + ' has unsupported type.');
  });


  let output = '';
  rendered.forEach((part, index) => {
    if (index === 0) {
      output = part.text;
      return;
    }
    const previous = rendered[index - 1];
    if (previous.kind === 'clause' || part.kind === 'clause') {
      output = output.trimEnd() + ' ' + part.text.trimStart();
    } else {
      output += part.text;
    }
  });

  if (!output.trim()) throw new Error(label + ' must not resolve to empty text.');
  return output;
}

function isClauseAtom(text) {
  return /[.!?]\s*$/u.test(String(text || ''));
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

function validateNarrativeText(rawText, source, label, copyInput) {
  const text = String(rawText || '');
  if (RAW_CONCRETE_PATTERN.test(text) || POSITION_CLAIM_PATTERN.test(text)) {
    throw new Error(label + ' contains raw concrete factual wording; use a fact part instead.');
  }

  const lower = text.toLocaleLowerCase('en-AU');
  const protectedTerms = [...new Set([...(copyInput?.protectedTerms || []), ...(source.context?.protectedTerms || [])])];
  for (const term of protectedTerms) {
    const normalized = String(term || '').trim().toLocaleLowerCase('en-AU');
    if (normalized && containsProtectedTerm(lower, normalized)) {
      throw new Error(label + ' contains protected factual text; use a fact part instead: ' + term + '.');
    }
  }
}

function containsProtectedTerm(lowerText, normalizedTerm) {
  const escaped = normalizedTerm.replace(/[.*+?^$\{\}()|[\]\\]/gu, '\\$&');
  const startsWord = /[\p{L}\p{N}]/u.test(normalizedTerm[0] || '');
  const endsWord = /[\p{L}\p{N}]/u.test(normalizedTerm[normalizedTerm.length - 1] || '');
  const left = startsWord ? '(?<![\\p{L}\\p{N}])' : '';
  const right = endsWord ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(left + escaped + right, 'iu').test(lowerText);
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
    const hardMaxChars = hardCharLimit(rule.maxChars);
    if (hardMaxChars && value.length > hardMaxChars) throw new Error(label + ' exceeds hard maxChars tolerance (' + hardMaxChars + ').');
    if (/[<>]/u.test(value)) throw new Error(label + ' contains forbidden markup.');
    return;
  }

  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) throw new Error(label + ' has too few items.');
    if (rule.maxItems !== undefined && value.length > rule.maxItems) throw new Error(label + ' has too many items.');
    for (const item of value) {
      if (typeof item !== 'string' || !item.trim()) throw new Error(label + ' items must be non-empty strings.');
      const hardItemMaxChars = hardCharLimit(rule.itemMaxChars);
      if (hardItemMaxChars && item.length > hardItemMaxChars) throw new Error(label + ' item exceeds hard itemMaxChars tolerance (' + hardItemMaxChars + ').');
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  parseJsonObject,
  validateCopyResponse,
  countWords,
  hardCharLimit,
  __test: {
    atomsForPhase,
    composeParts,
    isClauseAtom,
    validateNarrativeText,
    containsProtectedTerm
  }
};
