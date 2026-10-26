/**
 * design-brief — gather everything a design build needs in ONE round of questions, and where an answer is missing,
 * state a one-sentence assumption and carry on instead of waiting. Pure: it reads JSON and prints JSON.
 *
 *   design-brief questions [--file <f>]   → { kind, batch: [{ field, question, why }], complete, warnings }
 *   design-brief assume    [--file <f>]   → { kind, brief, assumptions: [{ field, value, line }], warnings }
 *
 * Input (a JSON file or stdin, at most 8 MiB):
 *   { kind: "landing"|"ui"|"motion", answers?: { offer, primary_action, audience, objections, proof, brand, references } }
 * Every answer may be missing, null, empty or blank (all count as missing). Text fields take a string; objections,
 * proof and references also take an array of strings. primary_action must be ONE action: an array of two or more is
 * a finding in `warnings` (the first is kept in the brief). Unknown keys and wrong types are refused (exit 1).
 * Fields always come out in the fixed order offer, primary_action, audience, objections, proof, brand, references.
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'design-brief';
export const usage = 'cli.js design-brief questions|assume [--file <f>]  (input {kind: landing|ui|motion, answers:{offer, primary_action, audience, objections, proof, brand, references}} on stdin or --file)';

export const KINDS = ['landing', 'ui', 'motion'];
export const FIELDS = ['offer', 'primary_action', 'audience', 'objections', 'proof', 'brand', 'references'];
const LIST_FIELDS = ['objections', 'proof', 'references', 'primary_action'];
const MAX_BYTES = 8 * 1024 * 1024;

const bad = m => new KitExit(m, 1);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// Per field: the question, why it matters, and the default we assume when it stays unanswered.
// A kind can override any of the three; the base wording covers the rest.
const BASE = {
  offer: {
    question: 'What exactly is being offered, in one sentence, and what is the single outcome the visitor gets from it?',
    why: 'The headline, hero and every later section hang off the offer; a vague offer gives a vague page.',
    value: 'a single product or service whose main outcome is stated in the request',
  },
  primary_action: {
    question: 'What ONE thing should a visitor do next (for example "start a free trial", "book a call", "buy")?',
    why: 'One primary action keeps the layout and the button copy focused; two equal asks split attention.',
    value: 'start (a free trial or sign-up) as the single primary action',
  },
  audience: {
    question: 'Who is this for: their role or situation, and what are they trying to get done when they arrive?',
    why: 'It sets vocabulary, depth of detail and which problem the page leads with.',
    value: 'a busy non-expert who knows the problem but not this product',
  },
  objections: {
    question: 'What are the top one to three things that make that person hesitate (price, effort to switch, trust, "will it work for me")?',
    why: 'Objections decide the FAQ, the risk-reversal line and which proof goes near the action.',
    value: 'cost, effort to get started and trust are the top three hesitations',
  },
  proof: {
    question: 'What proof exists today: customer names, quotes, numbers, logos, press, ratings, a demo or screenshots?',
    why: 'Real proof goes next to the primary action; if none exists we must not invent any and design around its absence.',
    value: 'no testimonials or figures exist yet, so the page shows only the product itself and invents nothing',
  },
  brand: {
    question: 'What are the brand and design constraints: colours, fonts, logo, tone of voice, light or dark, anything to avoid?',
    why: 'These are the fixed tokens the design must respect instead of choosing its own.',
    value: 'a clean neutral palette with one accent colour, a system sans-serif, light theme and a plain, direct tone',
  },
  references: {
    question: 'Which one to three sites, screenshots or products do you like the look of, and what specifically do you like about each?',
    why: 'A concrete reference removes more guesswork than any adjective about style.',
    value: 'no reference was given, so the design follows common patterns for this kind of page',
  },
};

const BY_KIND = {
  landing: {},
  ui: {
    offer: {
      question: 'What does this screen or component let the user accomplish, in one sentence?',
      why: 'The job of the screen decides the hierarchy of everything on it.',
      value: 'one clear job for the screen, taken from the request',
    },
    primary_action: {
      question: 'What is the ONE primary action on this screen, and what should happen right after it?',
      why: 'The primary button, its states and the follow-up feedback are the core of the interaction design.',
      value: 'one primary button for the main task, with success feedback shown in place',
    },
    audience: {
      question: 'Who uses this screen, how often, and on what device (desktop, phone, both)?',
      why: 'Frequency and device decide density, tap-target sizes and how much guidance to show.',
      value: 'a regular user on desktop and phone, so the layout is responsive and moderately dense',
    },
    objections: {
      question: 'Where do users get stuck or make mistakes today (errors, empty states, slow steps, unclear labels)?',
      why: 'Known friction points need explicit empty, error and loading states.',
      value: 'unclear labels, empty states and errors are the likely friction points and each gets a designed state',
    },
    proof: {
      question: 'What real content and data will this screen show (example records, lengths, counts), and what is the worst case?',
      why: 'Realistic content, including the longest and the empty case, is what breaks layouts.',
      value: 'realistic sample data of typical length, plus one empty and one long-text case',
    },
  },
  motion: {
    offer: {
      question: 'What should the motion communicate or sell, in one sentence?',
      why: 'Motion that does not serve one message turns into decoration.',
      value: 'the main message of the page or product, reinforced and not replaced by the motion',
    },
    primary_action: {
      question: 'Where should the motion lead the eye or the user to act (one element or button)?',
      why: 'The final resting frame should point at one thing.',
      value: 'the primary button or headline is where the motion ends and the eye rests',
    },
    audience: {
      question: 'Where will it be seen (page on scroll, product demo, social loop) and by whom?',
      why: 'The setting decides length, whether it plays once or loops, and how subtle it must be.',
      value: 'visitors scrolling the page on desktop and phone, with the motion playing once as it enters view',
    },
    objections: {
      question: 'What must the motion NOT do (distract from reading, slow the page, make anyone motion-sick)?',
      why: 'Sets the limits: duration, distance and a reduced-motion fallback.',
      value: 'it must not distract from reading or slow the page, and a reduced-motion setting shows the final state at once',
    },
    proof: {
      question: 'What is the content that moves (copy, cards, screenshots, a product mockup) and is it final?',
      why: 'The content decides the entrance pattern for each element and its order.',
      value: 'the existing content on the page, in reading order, treated as final',
    },
    brand: {
      question: 'What is the brand feel of the motion (calm, snappy, playful) and any easing, timing or colour rules?',
      why: 'Timing and easing carry the tone as much as colour does.',
      value: 'calm and precise, 400-700 ms durations, gentle ease-out, in the existing brand colours',
    },
  },
};

const spec = (kind, field) => ({ ...BASE[field], ...(BY_KIND[kind][field] || {}) });

function readList(v, where) {
  if (!Array.isArray(v)) return null;
  for (const [i, x] of v.entries()) if (typeof x !== 'string') throw bad(`${where}[${i}] must be a string`);
  return v.map(x => x.trim()).filter(Boolean);
}

/** Validate the input; returns { kind, answers } with each present answer trimmed (string, or array of strings for list fields). */
export function normalize(input) {
  if (!isObj(input)) throw bad('input must be a JSON object with a kind');
  for (const k of Object.keys(input)) if (!['kind', 'answers'].includes(k)) throw bad(`unknown key "${k}" in input (allowed: kind, answers)`);
  if (!KINDS.includes(input.kind)) throw bad(`input.kind must be one of ${KINDS.join(', ')}`);
  const raw = input.answers === undefined || input.answers === null ? {} : input.answers;
  if (!isObj(raw)) throw bad('input.answers must be an object');
  for (const k of Object.keys(raw)) if (!FIELDS.includes(k)) throw bad(`unknown key "${k}" in answers (allowed: ${FIELDS.join(', ')})`);
  const answers = {};
  for (const f of FIELDS) {
    const v = raw[f];
    if (v === undefined || v === null) continue;
    const where = `answers.${f}`;
    if (typeof v === 'string') { if (v.trim()) answers[f] = v.trim(); continue; }
    if (Array.isArray(v) && LIST_FIELDS.includes(f)) {
      const list = readList(v, where);
      if (list.length) answers[f] = list;
      continue;
    }
    throw bad(`${where} must be a string${LIST_FIELDS.includes(f) ? ' or an array of strings' : ''}`);
  }
  return { kind: input.kind, answers };
}

function warningsFor(answers) {
  const w = [];
  const pa = answers.primary_action;
  if (Array.isArray(pa) && pa.length >= 2) {
    w.push(`primary_action must be one action but ${pa.length} were given (${pa.join('; ')}): pick one; the first is used and the rest become secondary`);
  }
  return w;
}

/** Every missing field as ONE batch of questions, in fixed field order. */
export function questions(input) {
  const { kind, answers } = normalize(input);
  const batch = FIELDS.filter(f => !(f in answers)).map(field => {
    const { question, why } = spec(kind, field);
    return { field, question, why };
  });
  return { kind, batch, complete: batch.length === 0, warnings: warningsFor(answers) };
}

const sentence = (field, value) => `Assumed ${field.replace('_', ' ')}: ${value}.`;

/** The brief with a stated default for each missing field, plus the one-sentence assumption lines. */
export function assume(input) {
  const { kind, answers } = normalize(input);
  const warnings = warningsFor(answers);
  const brief = {};
  const assumptions = [];
  for (const f of FIELDS) {
    if (f in answers) {
      brief[f] = f === 'primary_action' && Array.isArray(answers[f]) ? answers[f][0] : answers[f];
    } else {
      const value = spec(kind, f).value;
      brief[f] = value;
      assumptions.push({ field: f, value, line: sentence(f, value) });
    }
  }
  return { kind, brief, assumptions, warnings };
}

async function readInput(flags, io) {
  const cwd = io.cwd || process.cwd();
  let raw;
  if (flags.file !== undefined) {
    const file = path.resolve(cwd, flags.file);
    let fh;
    try {
      const st = await fs.stat(file);
      if (!st.isFile()) throw bad(`${file} is not a regular file`);
      if (st.size > MAX_BYTES) throw bad(`${file} is larger than 8 MiB`);
      fh = await fs.open(file, 'r');
      const buf = Buffer.alloc(MAX_BYTES + 1);
      let n = 0;
      while (n < buf.length) {
        const { bytesRead } = await fh.read(buf, n, buf.length - n, null);
        if (!bytesRead) break;
        n += bytesRead;
      }
      if (n > MAX_BYTES) throw bad(`${file} is larger than 8 MiB`);
      raw = buf.subarray(0, n).toString('utf-8');
    } catch (e) {
      if (e instanceof KitExit) throw e;
      throw bad(`cannot read ${file}: ${e.code || e.message}`);
    } finally {
      if (fh) await fh.close();
    }
  } else {
    const buf = typeof io.stdinBytes === 'function'
      ? await io.stdinBytes({ maxBytes: MAX_BYTES + 1 })
      : Buffer.from(String(await io.stdin({ maxBytes: MAX_BYTES + 1 })), 'utf-8');
    if (buf.length > MAX_BYTES) throw bad('input is larger than 8 MiB');
    raw = buf.toString('utf-8');
  }
  raw = raw.replace(/^\uFEFF/, '');
  if (!raw.trim()) throw bad('no input: pass the brief JSON on stdin or --file');
  try { return JSON.parse(raw); } catch { throw bad('input is not valid JSON'); }
}

export async function run(args, io) {
  const [sub, ...rest] = args;
  if (sub !== 'questions' && sub !== 'assume') throw bad(`first argument must be questions or assume\n${usage}`);
  const flags = {};
  while (rest.length) {
    const a = rest.shift();
    if (a !== '--file') throw bad(`unexpected argument "${a}" (allowed: --file <f>)\n${usage}`);
    if (flags.file !== undefined) throw bad('--file may be given only once');
    if (!rest.length || !rest[0] || rest[0].startsWith('--')) throw bad('--file needs a value');
    flags.file = rest.shift();
  }
  const data = await readInput(flags, io);
  return sub === 'questions' ? questions(data) : assume(data);
}
