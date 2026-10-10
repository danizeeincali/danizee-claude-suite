/**
 * bbs steps — the headings of a command file as the steps a power can land in, and how a typed step names one.
 */

import fs from 'fs/promises';
import path from 'path';

/** A heading as a step name: no leading #s, emoji markers, bold or code ticks; spaces collapsed; lower case. */
export function normalizeStep(text) {
  return String(text).replace(/^#+\s*/, '').replace(/[\p{Extended_Pictographic}*`_]/gu, '').replace(/[\uFE0F\u200D]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The `##`–`####` headings of a command file, as written (outside fenced code). */
export async function stepHeadings(projectDir, file) {
  let text;
  try { text = await fs.readFile(path.join(projectDir, file), 'utf-8'); } catch { return []; }
  const out = [];
  let fence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (!fence && /^#{2,4}\s+\S/.test(line)) out.push(line.replace(/^#+\s*/, '').trim());
  }
  return out;
}

/**
 * A step names a heading when its normalized text equals the heading's, or is the heading's leading words (the prefix
 * ends where a word ends, so "step 1" is not "step 10"). A prefix that leads more than one heading names none: it
 * throws with the candidates rather than pick the first.
 */
export function matchStep(step, headings) {
  const s = normalizeStep(step);
  if (!s) return null;
  const exact = headings.find(h => normalizeStep(h) === s);
  if (exact) return exact;
  const lead = headings.filter(h => { const n = normalizeStep(h); return n.startsWith(s) && !/[\p{L}\p{N}]/u.test(n[s.length]); });
  if (lead.length > 1) throw new Error(`"${s}" leads ${lead.length} headings (${lead.map(h => JSON.stringify(h)).join(', ')}) — name the one you mean`);
  return lead[0] ?? null;
}
