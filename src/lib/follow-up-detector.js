/**
 * Natural Language Follow-Up Classifier
 * Detects whether input describes a follow-up (waiting on others)
 * vs an action item (task I do myself).
 */

const PATTERNS = {
  explicitFollowUp: { weight: 0.6, regex: /follow[\s-]?up/i },
  waitingIndicator: { weight: 0.5, regex: /waiting\s+(for|on)|hear\s+back/i },
  scheduledContact: { weight: 0.4, regex: /check\s+(in|back)|ping|touch\s+base/i },
  createFollow: { weight: 0.5, regex: /create\s+a?\s*follow[\s-]?up/i },
  remindMe: { weight: 0.3, regex: /remind\s+me/i },
  personMention: { weight: 0.15, regex: /\b(with|for|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i },
  dateMention: { weight: 0.1, regex: /\b(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next\s+week|by\s+\w+day)\b/i }
};

const DATE_PATTERNS = /\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday))|by\s+(\w+day)|\b(\d{4}-\d{2}-\d{2})\b/i;

const PERSON_PATTERNS = [
  /(?:with|from|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
  /(?:told|asked)\s+([A-Z][a-z]+)/,
];

/**
 * Detect whether input is a follow-up.
 * @param {string} input
 * @returns {{ isFollowUp: boolean, confidence: number, person: string|null, datePattern: string|null, content: string|null }}
 */
export function detectFollowUp(input) {
  if (!input) {
    return { isFollowUp: false, confidence: 0, person: null, datePattern: null, content: null };
  }

  let confidence = 0;

  for (const [, config] of Object.entries(PATTERNS)) {
    if (config.regex.test(input)) {
      confidence += config.weight;
    }
  }

  // Extract person
  let person = null;
  for (const pattern of PERSON_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      person = match[1];
      break;
    }
  }

  // Extract date
  let datePattern = null;
  const dateMatch = input.match(DATE_PATTERNS);
  if (dateMatch) {
    datePattern = dateMatch[0];
  }

  return {
    isFollowUp: confidence >= 0.5,
    confidence: Math.min(confidence, 1.0),
    person,
    datePattern,
    content: input
  };
}

export default { detectFollowUp };
