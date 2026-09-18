'use strict';

const FALLBACK_TEXT = {
  openingTeaser: 'A full racing day is ready to unfold.',
  tensionLine: 'The next moment is set.',
  reactionLine: 'That result moves the story on.',
  replayLabel: 'Watch it again.',
  lookingBackStory: 'The day has already taken a few turns.',
  lookingAheadTeaser: 'There is still more to come.',
  setupKicker: 'Next up',
  setupHeadline: 'A quick run of races',
  payoffHeadline: 'Those results are in',
  contextLine: 'The day keeps moving.',
  dayVerdict: 'A racing day with plenty of movement from start to finish.',
  standoutCopy: 'One moment stood out from the rest.',
  finalSummary: 'That wraps the racing day.',
  shareCaption: 'My racing day recap is complete.',
  headline: 'Next up'
};

function fallbackText(field) {
  return FALLBACK_TEXT[field] || 'The recap moves on.';
}

function fallbackEnum(scene, field, rule) {
  if (field === 'standoutHighlightType') {
    return scene.context?.standoutOptions?.[0]?.type || rule.enum?.[0];
  }
  if (field === 'selectedFinalHighlights') {
    const values = (scene.context?.availableFinalHighlights || []).map(x => x.type);
    const min = Math.max(3, Number(rule.minItems || 3));
    return values.slice(0, min);
  }
  if (field === 'headlineCategory') {
    return rule.enum?.[0];
  }
  return Array.isArray(rule.enum) ? rule.enum[0] : null;
}

function fallbackArray(scene, field, rule) {
  if (field === 'comments' && Array.isArray(scene.betSequences)) {
    return scene.betSequences.map(() => 'Result in.');
  }

  const count = Math.max(1, Number(rule.minItems || 1));
  if (field === 'replayComments') {
    return Array.from({ length: count }, (_, i) => i === 0 ? 'Here it comes.' : 'That is the moment.');
  }

  return Array.from({ length: count }, () => fallbackText(field));
}

function buildFallbackCopy(copyInput) {
  return {
    scenes: copyInput.scenes.map(scene => {
      const out = { sceneIndex: scene.sceneIndex };
      for (const [field, rule] of Object.entries(scene.requiredFields || {})) {
        if (rule.responseType === 'enum' || rule.enum) {
          out[field] = fallbackEnum(scene, field, rule);
        } else if (rule.responseType === 'groundedTextArray') {
          out[field] = fallbackArray(scene, field, rule);
        } else {
          out[field] = fallbackText(field);
        }
      }
      return out;
    })
  };
}

module.exports = { buildFallbackCopy };
