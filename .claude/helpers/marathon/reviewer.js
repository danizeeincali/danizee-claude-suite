/**
 * Marathon reviewer helpers
 * Angle rotation, review briefs, write-ups and finding ingestion.
 */

import { normalizeFinding } from './findings.js';

/**
 * Review angles rotated round by round. None of them is "confirm the fixes":
 * a reviewer who only re-checks last round's fixes finds nothing new.
 */
export const DEFAULT_ANGLES = [
  'one input method at a time',
  'failure conditions and error paths',
  'older environments and degraded networks',
  'the three safety probes: egress, secrets, sandbox escape',
  'accessibility',
  'facts and content',
  'performance and memory'
];

const SEVERITIES = ['high', 'medium', 'low'];

/**
 * Pick the angle for a 1-based review round, wrapping around the list.
 */
export function pickAngle(round, angles = DEFAULT_ANGLES) {
  const n = Number.isInteger(round) && round > 0 ? round : 1;
  return angles[(n - 1) % angles.length];
}

/**
 * A code fence long enough that nothing inside the diff can close it.
 */
function fenceFor(text) {
  const runs = String(text).match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * Render the brief handed to a fresh-context reviewer.
 */
export function renderBrief({ stream, round, angle, severityMd, diff, tolerance, categories = [] }) {
  const limits = tolerance ?? {};
  const tol = SEVERITIES.map(sev => (
    limits[sev] != null ? `- ${sev}: at most ${limits[sev]} in this round` : `- ${sev}: no limit`
  ));
  if (limits.passes_in_a_row != null) {
    tol.push(`- passes in a row needed: ${limits.passes_in_a_row}`);
  }
  const fence = fenceFor(diff ?? '');

  return [
    `# Review brief — ${stream}`,
    '',
    `Round ${round}. Stream: ${stream}.`,
    `This round's angle: ${angle}`,
    '',
    'You are a fresh-context reviewer. You have not seen the build conversation. Judge only the diff below, through this angle, and report what is wrong with it.',
    '',
    '## Severity definitions',
    '',
    String(severityMd ?? '').trim(),
    '',
    'Grade each finding against these definitions: neither inflate nor deflate severity to move the gate.',
    '',
    '## Tolerance',
    '',
    "Pass or over is computed from this round's counts: the findings you report below. The review passes only when each count stays within these limits:",
    '',
    ...tol,
    '',
    '## Categories',
    '',
    `Use exactly one of: ${categories.join(', ')}.`,
    '',
    '## Rules',
    '',
    '- Report only problems you can point to in the diff; cite file and line.',
    '- Do not suggest edits that weaken tests: never weaken an assertion, delete a test or loosen a property to make a finding go away.',
    '- Do not re-report anything that is already fixed or outside this diff.',
    '',
    '## Output',
    '',
    'Return JSON rows only — no prose. One array, one object per finding:',
    '',
    '```json',
    '[{"severity": "high|medium|low", "category": "<category>", "file": "path/from/repo/root", "line": 0, "title": "short title", "detail": "what is wrong and why it matters", "fix_hint": "smallest fix that works"}]',
    '```',
    '',
    'Return `[]` when you find nothing.',
    '',
    '## Diff',
    '',
    `${fence}diff`,
    String(diff ?? ''),
    fence,
    ''
  ].join('\n');
}

// Finding text comes from a reviewer (a model) and lands in a markdown file the fixer reads:
// neutralise markdown and HTML so a title can't restyle or inject into the write-up.
const plain = (v) => String(v ?? '').replace(/[*_`<>\[\]]/g, (c) => `\\${c}`).replace(/\s+/g, ' ').trim();

function renderFinding(f) {
  const where = f.file ? (f.line != null ? `${f.file}:${f.line}` : f.file) : '—';
  const detail = f.detail ? `: ${plain(f.detail)}` : '';
  const hint = f.fix_hint ? ` — fix: ${plain(f.fix_hint)}` : '';
  return `- **${plain(f.title)}** — \`${where}\` (${f.category ?? 'other'})${detail}${hint}`;
}

/**
 * Render a review write-up: heading, metadata, then findings grouped
 * high → medium → low.
 */
export function renderWriteup(review, findings) {
  const lines = [
    `# Review ${review.id} — ${review.stream}, round ${review.round}`,
    '',
    `- Commit: ${review.commit ?? 'unknown'}`,
    `- Angle: ${review.angle ?? 'n/a'}`,
    `- Result: ${review.pass ? 'pass' : 'over tolerance'}`,
    `- ${findings.length} findings`
  ];

  const known = new Set(SEVERITIES);
  const groups = [
    ...SEVERITIES.map(sev => [sev, findings.filter(f => String(f.severity).toLowerCase() === sev)]),
    ['other', findings.filter(f => !known.has(String(f.severity).toLowerCase()))]
  ];

  for (const [sev, rows] of groups) {
    if (rows.length === 0) continue;
    lines.push('', `## ${sev[0].toUpperCase()}${sev.slice(1)} (${rows.length})`, '');
    for (const f of rows) lines.push(renderFinding(f));
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Normalise reviewer output rows and stamp them with review id and stream.
 * A row's own found_by wins; otherwise the meta found_by is used.
 */
export function ingestFindings(rows, { review_id, stream, found_by } = {}, config) {
  return rows.map(r => {
    const row = { ...r };
    if (row.found_by == null && found_by != null) row.found_by = found_by;
    return { ...normalizeFinding(row, config), review_id, stream };
  });
}
