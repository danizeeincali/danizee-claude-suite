/**
 * Auto Category Detection from git diff
 * Uses weighted pattern matching to classify changes.
 */

const CATEGORIES = {
  security: {
    weight: 3,
    patterns: [
      /injection/gi, /vulnerability/gi, /sanitize/gi, /xss/gi, /csrf/gi,
      /auth/gi, /encrypt/gi, /decrypt/gi, /token/gi, /secret/gi,
      /permission/gi, /access.?control/gi, /cors/gi, /helmet/gi
    ]
  },
  bug: {
    weight: 2,
    patterns: [
      /\bfix\b/gi, /\bbug\b/gi, /\bpatch\b/gi, /\bhotfix\b/gi,
      /handle.*missing/gi, /error.?handling/gi, /fallback/gi,
      /undefined/gi, /null.?check/gi, /off.?by.?one/gi, /race.?condition/gi
    ]
  },
  performance: {
    weight: 2,
    patterns: [
      /cache/gi, /optimize/gi, /\bWAL\b/g, /batch/gi, /lazy/gi,
      /memoize/gi, /throttle/gi, /debounce/gi, /index/gi,
      /concurrent/gi, /parallel/gi, /pool/gi, /buffer/gi
    ]
  },
  architecture: {
    weight: 2,
    patterns: [
      /refactor/gi, /redesign/gi, /restructure/gi, /migration/gi,
      /rename/gi, /extract/gi, /decouple/gi, /modular/gi,
      /abstract/gi, /interface/gi, /pattern/gi
    ]
  },
  feature: {
    weight: 1,
    patterns: [
      /export\s+function/g, /new\s+file\s+mode/g, /CREATE\s+TABLE/gi,
      /\badd\b/gi, /\bcreate\b/gi, /\bimplement\b/gi, /\bnew\b/gi
    ]
  }
};

/**
 * Detect the category of changes from a git diff string.
 * @param {string} diff - The git diff output
 * @returns {'feature' | 'bug' | 'security' | 'performance' | 'architecture'}
 */
export function detectCategory(diff) {
  if (!diff || diff.trim() === '') return 'feature';

  const scores = {};
  for (const [category, config] of Object.entries(CATEGORIES)) {
    scores[category] = 0;
    for (const pattern of config.patterns) {
      const matches = diff.match(pattern);
      if (matches) {
        scores[category] += matches.length * config.weight;
      }
    }
  }

  let best = 'feature';
  let bestScore = 0;
  for (const [category, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }

  return best;
}

export default { detectCategory };
