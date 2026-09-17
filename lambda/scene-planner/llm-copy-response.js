'use strict';

const ATOM_PATTERN = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
const SENSITIVE_RAW_PATTERN = /(?:[$%@]|\d|\b(?:win|wins|winner|winners|winning|won|loss|losses|lost|lose|losing|profit|profits|return|returns|returned|stake|staked|odds|finished|finishing|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\b)/iu;

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
      const value = normalizeGroundedValue(item[field], rule, source, index, field);
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

function normalizeGroundedValue(value, rule, source, sceneIndex, field) {
  if (rule.enum) return clone(value);

  if (typeof value === 'string') {
    return expandGroundedString(value, source, rule.phase, null, sceneIndex, field);
  }

  if (Array.isArray(value)) {
    return value.map((item, itemIndex) => {
      if (typeof item !== 'string') return item;
      return expandGroundedString(item, source, rule.phase, itemIndex, sceneIndex, field);
    });
  }

  return value;
}

function expandGroundedString(rawValue, source, phase, itemIndex, sceneIndex, field) {
  const raw = String(rawValue);
  const label = 'Scene ' + sceneIndex + ' field ' + field + (itemIndex === null ? '' : '[' + itemIndex + ']');
  const atomMap = atomsForPhase(source, phase, itemIndex);
  const referenced = [];

  const withoutAtoms = raw.replace(ATOM_PATTERN, (_, id) => {
    referenced.push(id);
    if (!Object.prototype.hasOwnProperty.call(atomMap, id)) {
      throw new Error(label + ' references unknown or wrong-phase fact atom ' + id + '.');
    }
    return ' ';
  });

  if (/[{}]/u.test(withoutAtoms)) {
    throw new Error(label + ' contains malformed fact atom syntax.');
  }

  validateUngroundedRawText(withoutAtoms, source, label);

  return raw.replace(ATOM_PATTERN, (_, id) => String(atomMap[id]));
}

function atomsForPhase(source, phase, itemIndex) {
  const scoped = source.context?.factAtomsByPhase?.[phase];
  if (Array.isArray(scoped)) {
    if (!Number.isInteger(itemIndex) || !scoped[itemIndex] || typeof scoped[itemIndex] !== 'object') {
      return {};
    }
    return scoped[itemIndex];
  }
  return scoped && typeof scoped === 'object' ? scoped : {};
}

function validateUngroundedRawText(rawText, source, label) {
  const text = String(rawText || '');
  if (SENSITIVE_RAW_PATTERN.test(text)) {
    throw new Error(label + ' contains a concrete fact outside a fact atom.');
  }

  const lower = text.toLocaleLowerCase('en-AU');
  for (const term of source.context?.protectedTerms || []) {
    const normalized = String(term || '').trim().toLocaleLowerCase('en-AU');
    if (normalized && lower.includes(normalized)) {
      throw new Error(label + ' contains protected factual text outside a fact atom: ' + term + '.');
    }
  }
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
    expandGroundedString,
    validateUngroundedRawText
  }
};
