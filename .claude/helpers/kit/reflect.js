/**
 * reflect — turn a finished session into a small trouble log, and keep a guarded memory of one-sentence lessons.
 * There is NO model call here: the calling workflow's model is the reviewer. This verb builds the reviewer's input
 * and guards what the reviewer is allowed to write.
 *
 *   reflect trouble-log [--in <events.jsonl>] [--max-lines <n>] [--max-line-length <n>] [--repeat-min <n>]
 *                       [--target-min <n>] [--secrets-file <f>]            (events from --in or stdin)
 *   reflect lessons save --role <r> --text "<one sentence>" [--scope <s>] --session <id>
 *                        [--max-new <n>] [--threshold <0..1>] [--confirm <id> | --distinct] [--store <f>]
 *   reflect lessons keep --id <id> [--store <f>]
 *   reflect lessons retire --id <id> --reason "<why>" [--store <f>]
 *   reflect lessons list [--role <r>] [--all] [--store <f>]
 *
 * TROUBLE LOG. Input is JSON Lines in one of two shapes, detected per line: the generic schema
 * `{type:"tool", name, input, ok, error?}`, `{type:"wait"}`, `{type:"stop", reason}`; or a Claude Code transcript
 * (assistant `tool_use` blocks paired by id with `tool_result` blocks whose `is_error` is true; the last assistant
 * `stop_reason` is the stop). Signals, all mechanical: the same tool called with identical input repeated (count),
 * the same target (path, field, selector...) edited or typed into >= target-min times, 3 or more waits in a row,
 * every failed action, and the stop reason. Output lines are redacted with the project's secrets (the redact verb's
 * library and file, applied BEFORE the length cap so a cut cannot leave half a secret), then capped in length and
 * count (most important signals first: stop, failures, waits, repeats, targets).
 *
 * LESSONS. A store (default .claude/kit/lessons.json) of { id, role, text, scope, session, status, kept, ... }.
 * Guards: one sentence (full-width 。！？ count as sentence ends), imperative-looking (English text only; other languages
 * are checked for one sentence and length), 12..200 characters; at most --max-new (default 3) new lessons per
 * --session (REQUIRED on save, exit 1 without it); a near match against ACTIVE lessons of the SAME role is refused (exit 2, with the matching id) unless
 * the caller passes --confirm <existing id> (keeps that lesson instead of adding a duplicate) or --distinct (saves it
 * as deliberately different). Near match = Jaccard overlap >= --threshold (default 0.5) of the normalised word sets
 * (NFC-normalised, lower-cased, punctuation dropped but combining marks kept, runs of Han/Kana/Thai/Lao/Khmer/Myanmar as character bigrams, stop words dropped, a trailing plural "s" dropped). A lesson may be saved for
 * another role. Retired lessons stay in the file with their reason and are hidden from `list` unless --all.
 * Every change holds the shared state lock (./state-lock.js: `<store>.lock`, heartbeat, stale-lock break) from load to
 * save and writes atomically through it, so parallel saves are all kept; `list` only reads and takes no lock. A leading
 * BOM is ignored. trouble-log exits 1 when its input has no events it recognises (empty, or neither shape).
 * Exit 0 done, 1 invalid input, 2 refused save.
 * Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { withStateLock, readJsonState, writeJsonAtomic } from './state-lock.js';
import { redactSecrets, parseSecretsFile, secretsRoots, loadProjectSecrets } from './redact.js';

export const verb = 'reflect';
export const usage = 'cli.js reflect trouble-log [--in <events.jsonl>] [--max-lines <n>] [--max-line-length <n>] [--repeat-min <n>] [--target-min <n>] [--secrets-file <f>] | '
  + 'reflect lessons save --role <r> --text "<one sentence; the imperative check applies to English only>" [--scope <s>] --session <id> [--max-new <n>] [--threshold <0..1>] [--confirm <id> | --distinct] [--store <f>] | '
  + 'reflect lessons keep --id <id> | reflect lessons retire --id <id> --reason "<why>" | reflect lessons list [--role <r>] [--all]   '
  + '(no model call: trouble-log is the reviewer\'s input, lessons are the guarded memory; exit 0 done, 1 invalid, 2 refused save)';

export const DEFAULT_STORE = path.join('.claude', 'kit', 'lessons.json');
export const DEFAULTS = Object.freeze({ maxLines: 40, maxLineLength: 200, repeatMin: 2, targetMin: 3, waitRun: 3, maxNew: 3, threshold: 0.5 });
export const TEXT_MIN = 12;
export const TEXT_MAX = 200;

const invalid = (m) => new KitExit(m, 1);
// Matched on the last segment of the name, so mcp__<server>__browser_type counts like type.
const EDIT_TOOL = /^(edit|write|multiedit|notebookedit|(browser_)?(type|fill|fill_form|input|set_?value|type_?text)|computer_?type)$/i;
const isEditCall = (e) => EDIT_TOOL.test(String(e.name).split('__').pop())
  || (/(^|__)computer(_use)?$/i.test(e.name) && !!e.input && typeof e.input === 'object' && /^(type|key)$/i.test(String(e.input.action)));
const WAIT_TOOL = /^(wait|sleep)$/i;
const TARGET_KEYS = ['file_path', 'path', 'notebook_path', 'target', 'selector', 'field', 'element', 'ref', 'name', 'id'];

// ================================================================ events

const textOf = (c) => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b && typeof b.text === 'string' ? b.text : '')).join(' ')
    : c == null ? '' : JSON.stringify(c);

/** Parse JSONL text into objects; a bad line is invalid input naming the line number (never echoing it). */
export function parseJsonl(text) {
  const out = [];
  String(text).split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let v;
    try { v = JSON.parse(line); } catch { throw invalid(`events line ${i + 1} is not valid JSON`); }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid(`events line ${i + 1} is not a JSON object`);
    out.push(v);
  });
  return out;
}

/** Detect each object's shape and produce one flat list: {type:'tool'|'wait'|'stop', ...}; `recognised` counts the objects that matched a shape. A tool event's `error` stays RAW so it can be redacted before it is flattened. */
export function normalizeEvents(objs) {
  const events = [];
  const pending = new Map(); // tool_use id -> event
  let stop = null;
  let recognised = 0;
  for (const o of objs) {
    if ((o.type === 'tool' && typeof o.name === 'string') || o.type === 'wait' || o.type === 'stop'
      || ((o.type === 'assistant' || o.type === 'user') && o.message && Array.isArray(o.message.content))) recognised++;
    if (o.type === 'tool' && typeof o.name === 'string') {
      events.push({ type: 'tool', name: o.name, input: o.input, ok: o.ok !== false, error: o.error == null ? '' : o.error });
    } else if (o.type === 'wait') events.push({ type: 'wait' });
    else if (o.type === 'stop') stop = String(o.reason ?? '');
    else if ((o.type === 'assistant' || o.type === 'user') && o.message && Array.isArray(o.message.content)) {
      for (const b of o.message.content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'tool_use' && typeof b.name === 'string') {
          const ev = { type: 'tool', name: b.name, input: b.input, ok: true, error: '' };
          events.push(ev);
          if (b.id) pending.set(b.id, ev);
        } else if (b.type === 'tool_result' && pending.has(b.tool_use_id) && b.is_error === true) {
          const ev = pending.get(b.tool_use_id);
          ev.ok = false;
          ev.error = b.content;
        }
      }
      if (o.type === 'assistant' && typeof o.message.stop_reason === 'string') stop = o.message.stop_reason;
    }
  }
  for (const ev of events) {
    const cmd = ev.input && typeof ev.input === 'object' ? ev.input.command : undefined;
    if (ev.type === 'tool' && (WAIT_TOOL.test(ev.name) || (typeof cmd === 'string' && /^\s*sleep\b/.test(cmd)))) {
      ev.type = 'wait';
    }
  }
  return { events, stop, recognised };
}

const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x)) ?? 'null';

function targetOf(input) {
  if (!input || typeof input !== 'object') return null;
  for (const k of TARGET_KEYS) if (typeof input[k] === 'string' && input[k]) return input[k];
  return null;
}

const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

/** The raw (uncapped, unredacted) signal lines in priority order, plus counts. */
export function findSignals(events, stop, opts = {}) {
  const repeatMin = opts.repeatMin ?? DEFAULTS.repeatMin;
  const targetMin = opts.targetMin ?? DEFAULTS.targetMin;
  const waitRun = opts.waitRun ?? DEFAULTS.waitRun;
  // Input and error are redacted value by value BEFORE they are serialised or collapsed: JSON escaping (\" and \\) and
  // whitespace collapsing would otherwise stop a secret matching.
  const safe = (v) => (typeof v === 'string' ? redactSecrets(v, opts.secrets || []).text
    : Array.isArray(v) ? v.map(safe)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [safe(k), safe(x)])) : v);
  const failures = [];
  const waits = [];
  const repeats = [];
  const targets = [];

  for (const e of events) {
    if (e.type === 'tool' && !e.ok) {
      const t = targetOf(e.input);
      failures.push(`failed: ${e.name}${t ? ` ${t}` : ''}${e.error ? ` - ${oneLine(textOf(safe(e.error)))}` : ''}`);
    }
  }
  let run = 0;
  const flush = () => { if (run >= waitRun) waits.push(`waited ${run} times in a row`); run = 0; };
  for (const e of events) { if (e.type === 'wait') run++; else flush(); }
  flush();

  const same = new Map();
  const edits = new Map();
  for (const e of events) {
    if (e.type !== 'tool') continue;
    const k = `${e.name}\u0000${stable(e.input)}`;
    const s = same.get(k) || { name: e.name, input: e.input, n: 0 };
    s.n++; same.set(k, s);
    const t = isEditCall(e) ? (targetOf(e.input) || (/computer/i.test(e.name) ? 'the focused field' : null)) : null;
    if (t) edits.set(t, (edits.get(t) || 0) + 1);
  }
  for (const s of same.values()) if (s.n >= repeatMin) repeats.push(`repeated: ${s.name} ${s.n} times with identical input ${oneLine(stable(safe(s.input)))}`);
  for (const [t, n] of edits) if (n >= targetMin) targets.push(`same target edited ${n} times: ${t}`);

  const lines = [`stop: ${stop == null ? 'unknown' : stop || 'unknown'}`, ...failures, ...waits, ...repeats, ...targets];
  return { lines, counts: { failed: failures.length, wait_runs: waits.length, repeated_calls: repeats.length, repeated_targets: targets.length } };
}

function cap(text, max) {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, Math.max(0, max - 3)).join('') + '...';
}

/**
 * Events (either shape) -> { lines, counts, stop, events, omitted }. Every line is redacted with `secrets` before it
 * is shortened.
 */
export function troubleLog(objs, { secrets = [], maxLines = DEFAULTS.maxLines, maxLineLength = DEFAULTS.maxLineLength, ...rest } = {}) {
  const { events, stop, recognised } = normalizeEvents(objs);
  if (!objs.length) throw invalid('the input has no events; trouble-log needs a JSON Lines event log (a wiring mistake would otherwise read as a clean session)');
  if (!recognised) throw invalid(`none of the ${objs.length} input lines is a known event shape (tool, wait, stop or a transcript message); refusing to report a clean log`);
  const sig = findSignals(events, stop, { ...rest, secrets });
  const clean = sig.lines.map((l) => cap(redactSecrets(l, secrets).text, maxLineLength));
  const lines = clean.slice(0, maxLines);
  return {
    lines,
    stop: cap(redactSecrets(stop == null ? 'unknown' : String(stop), secrets).text, maxLineLength),
    counts: sig.counts,
    events: events.length,
    omitted: clean.length - lines.length
  };
}

// ================================================================ lessons

const STOP_WORDS = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'on', 'and', 'or', 'for', 'is', 'be', 'it', 'with', 'at', 'by', 'this', 'that', 'you', 'your']);

// Scripts written without spaces between words: their runs are scored as character bigrams (a lone character stays alone).
const UNSPACED_RUN = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]+/gu;

/** Normalised word set used for the overlap measure (NFC, marks kept, unspaced scripts as bigrams). */
export function words(text) {
  const out = new Set();
  const norm = String(text).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ');
  for (const tok of norm.split(/\s+/)) {
    if (!tok) continue;
    let last = 0;
    const spaced = (w) => {
      if (!w || STOP_WORDS.has(w)) return;
      if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
      out.add(w);
    };
    for (const m of tok.matchAll(UNSPACED_RUN)) {
      spaced(tok.slice(last, m.index));
      const cs = [...m[0]];
      if (cs.length === 1) out.add(cs[0]);
      else for (let i = 0; i + 1 < cs.length; i++) out.add(cs[i] + cs[i + 1]);
      last = m.index + m[0].length;
    }
    spaced(tok.slice(last));
  }
  return out;
}

/** Jaccard overlap of two texts' word sets: |A n B| / |A u B|, 0 when both are empty. */
export function overlap(a, b) {
  const A = words(a), B = words(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

const ING_VERBS = new Set(['bring', 'ping', 'string', 'sing', 'ring', 'swing', 'cling', 'fling', 'sting', 'wring', 'spring']);
const NON_IMPERATIVE_START = /^(the|a|an|this|that|these|those|it|its|we|i|you|they|he|she|there|my|our|your|their|when|if|because|since|while|although|then)$/i;

/** Validate a lesson text; returns the trimmed text or throws KitExit 1. */
export function checkLessonText(text) {
  if (typeof text !== 'string') throw invalid('--text is required');
  const t = text.trim();
  if (/[\r\n]/.test(t)) throw invalid('a lesson is one sentence on one line');
  if (t.length < TEXT_MIN || t.length > TEXT_MAX) throw invalid(`a lesson is ${TEXT_MIN}..${TEXT_MAX} characters (got ${t.length})`);
  if (/[.!?]\s+\S|[。！？｡]\s*\S/u.test(t.replace(/\b(e\.g|i\.e|etc|vs|cf)\./gi, '$1'))) throw invalid('a lesson is ONE sentence');
  const first = t.split(/\s+/)[0].replace(/[^\p{L}']/gu, '');
  if (!/^\p{L}/u.test(t) || !first) throw invalid('a lesson starts with a verb (imperative)');
  if (NON_IMPERATIVE_START.test(first) || (/ing$/i.test(first) && !ING_VERBS.has(first.toLowerCase()))) throw invalid(`a lesson is imperative: start with a verb, not "${first}" (the imperative check applies to English text only; other languages are checked for one sentence and length)`);
  return t;
}

async function loadStore(file) {
  const data = await readJsonState(file, { fallback: { version: 1, lessons: [] } });
  if (!data || !Array.isArray(data.lessons)) throw invalid(`lessons store ${file} has no lessons list`);
  return data;
}

const nextId = (lessons) => 'L' + (1 + Math.max(0, ...lessons.map((l) => Number(String(l.id).slice(1)) || 0)));
const publicLesson = (l) => ({ ...l });
const needText = (v, name) => { if (typeof v !== 'string' || !v.trim()) throw invalid(`--${name} is required`); return v.trim(); };

/**
 * Save a lesson. Returns { saved, lesson } | { kept, lesson } or throws KitExit 2 (cap, near match).
 * `opts`: role, text, scope, session, maxNew, threshold, confirm, distinct, now.
 */
export function saveLesson(data, opts) {
  const role = needText(opts.role, 'role');
  const text = checkLessonText(opts.text);
  const session = typeof opts.session === 'string' ? opts.session.trim() : '';
  if (!session) throw invalid('--session is required: the per-session cap on new lessons needs it');
  if (opts.confirm && opts.distinct) throw invalid('--confirm and --distinct cannot be combined');
  const threshold = opts.threshold ?? DEFAULTS.threshold;
  const maxNew = opts.maxNew ?? DEFAULTS.maxNew;
  const now = opts.now || new Date().toISOString();

  if (opts.confirm) {
    const l = data.lessons.find((x) => x.id === opts.confirm);
    if (!l) throw invalid(`no lesson with id ${opts.confirm}`);
    if (l.status === 'retired') throw invalid(`lesson ${l.id} is retired; save a new one with --distinct`);
    if (l.role !== role) throw invalid(`lesson ${l.id} belongs to role "${l.role}", not "${role}"`);
    l.kept = (l.kept || 0) + 1; l.last_kept = now;
    return { kept: true, lesson: publicLesson(l) };
  }
  {
    const n = data.lessons.filter((x) => x.session === session).length;
    if (n >= maxNew) {
      throw new KitExit(`session ${session} already saved ${n} new lessons (cap ${maxNew}); keep an existing lesson instead`, 2);
    }
  }
  if (!opts.distinct) {
    let best = null, bestScore = 0;
    for (const l of data.lessons) {
      if (l.status === 'retired' || l.role !== role) continue;
      const s = overlap(text, l.text);
      if (s > bestScore) { best = l; bestScore = s; }
    }
    if (best && bestScore >= threshold) {
      const e = new KitExit(`near match with lesson ${best.id} (overlap ${bestScore.toFixed(2)} >= ${threshold}): "${best.text}". Pass --confirm ${best.id} to keep it, or --distinct to save this as different`, 2);
      e.match = { id: best.id, overlap: Number(bestScore.toFixed(3)), text: best.text };
      throw e;
    }
  }
  const lesson = { id: nextId(data.lessons), role, text, scope: opts.scope || '', session, status: 'active', kept: 0, created_at: now };
  data.lessons.push(lesson);
  return { saved: true, lesson: publicLesson(lesson) };
}

export function keepLesson(data, id, now = new Date().toISOString()) {
  const l = data.lessons.find((x) => x.id === id);
  if (!l) throw invalid(`no lesson with id ${id}`);
  if (l.status === 'retired') throw invalid(`lesson ${id} is retired`);
  l.kept = (l.kept || 0) + 1; l.last_kept = now;
  return { kept: true, lesson: publicLesson(l) };
}

export function retireLesson(data, id, reason, now = new Date().toISOString()) {
  const why = needText(reason, 'reason');
  if (why.length > TEXT_MAX) throw invalid(`--reason is at most ${TEXT_MAX} characters`);
  const l = data.lessons.find((x) => x.id === id);
  if (!l) throw invalid(`no lesson with id ${id}`);
  if (l.status === 'retired') throw invalid(`lesson ${id} is already retired`);
  l.status = 'retired'; l.retire_reason = why; l.retired_at = now;
  return { retired: true, lesson: publicLesson(l) };
}

export function listLessons(data, { role, all = false } = {}) {
  return data.lessons.filter((l) => (all || l.status !== 'retired') && (!role || l.role === role)).map(publicLesson);
}

// ================================================================ CLI

const BOOL = ['distinct', 'all'];
const VALUE = ['in', 'max-lines', 'max-line-length', 'repeat-min', 'target-min', 'secrets-file', 'role', 'text', 'scope', 'session', 'max-new', 'threshold', 'confirm', 'id', 'reason', 'store'];

function parse(args) {
  const flags = {};
  const pos = [];
  const rest = [...args];
  while (rest.length) {
    const a = rest.shift();
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (BOOL.includes(k)) flags[k] = true;
    else if (VALUE.includes(k)) {
      if (!rest.length || rest[0].startsWith('--')) throw invalid(`--${k} needs a value`);
      flags[k] = rest.shift();
    } else throw invalid(`unknown flag --${k}\n${usage}`);
  }
  return { flags, pos };
}

function posInt(flags, k, def) {
  if (flags[k] === undefined) return def;
  if (!/^\d+$/.test(flags[k]) || Number(flags[k]) < 1) throw invalid(`--${k} must be a positive integer`);
  return Number(flags[k]);
}

async function loadSecrets(flags, cwd) {
  if (flags['secrets-file']) {
    let t;
    try { t = await fs.readFile(path.resolve(cwd, flags['secrets-file']), 'utf-8'); } catch (e) { throw invalid(`cannot read secrets file: ${e.code || 'read failed'}`); }
    return parseSecretsFile(t);
  }
  let roots;
  try { roots = secretsRoots(cwd); } catch (e) {
    // Only "not a git repository" falls back to the working folder; a missing or failing git must not silently skip redaction.
    if (e instanceof KitExit && /^not inside a git repository/.test(e.message)) roots = [cwd];
    else throw e instanceof KitExit ? invalid(`${e.message.replace(/; pass --secrets-file$/, '')}; pass --secrets-file so the text can be redacted`) : e;
  }
  const all = [];
  for (const r of roots) all.push(...await loadProjectSecrets(r));
  return all;
}

export async function run(args, io) {
  const { flags, pos } = parse(args);
  const cwd = io.cwd || process.cwd();
  const [cmd, sub] = pos;
  if (cmd === 'trouble-log') {
    if (pos.length !== 1) throw invalid(`unexpected argument "${pos[1]}"\n${usage}`);
    let text;
    if (flags.in) {
      try { text = await fs.readFile(path.resolve(cwd, flags.in), 'utf-8'); } catch (e) { throw invalid(`cannot read events ${flags.in}: ${e.code || 'read failed'}`); }
    } else {
      if (io.stdinIsTTY) throw invalid('trouble-log reads events from --in <file> or piped stdin');
      text = await io.stdin();
    }
    const secrets = await loadSecrets(flags, cwd);
    return troubleLog(parseJsonl(text), {
      secrets,
      maxLines: posInt(flags, 'max-lines', DEFAULTS.maxLines),
      maxLineLength: posInt(flags, 'max-line-length', DEFAULTS.maxLineLength),
      repeatMin: posInt(flags, 'repeat-min', DEFAULTS.repeatMin),
      targetMin: posInt(flags, 'target-min', DEFAULTS.targetMin)
    });
  }
  if (cmd === 'lessons') {
    if (pos.length !== 2) throw invalid(`reflect lessons needs save, keep, retire or list\n${usage}`);
    const store = path.resolve(cwd, flags.store || DEFAULT_STORE);
    if (sub === 'list') return { lessons: listLessons(await loadStore(store), { role: flags.role, all: !!flags.all }) };
    if (!['save', 'keep', 'retire'].includes(sub)) throw invalid(`unknown lessons command "${sub}"\n${usage}`);
    let threshold = DEFAULTS.threshold;
    if (sub === 'save' && flags.threshold !== undefined) {
      threshold = Number(flags.threshold);
      if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw invalid('--threshold must be a number in (0, 1]');
    }
    const maxNew = sub === 'save' ? posInt(flags, 'max-new', DEFAULTS.maxNew) : 0;
    if (sub === 'save' || sub === 'retire') {
      // The store is not git-ignored and is read back into later prompts: never write a project secret into it.
      const secrets = await loadSecrets(flags, cwd);
      for (const k of ['text', 'scope', 'reason', 'session', 'role', 'id', 'confirm']) {
        if (typeof flags[k] === 'string' && redactSecrets(flags[k], secrets).replaced > 0) {
          throw invalid(`--${k} contains a project secret; lessons are saved unredacted, so rewrite it without the secret`);
        }
      }
    }
    return withStateLock(store, async () => {
      const data = await loadStore(store);
      let result;
      if (sub === 'save') result = saveLesson(data, { role: flags.role, text: flags.text, scope: flags.scope, session: flags.session, maxNew, threshold, confirm: flags.confirm, distinct: !!flags.distinct });
      else if (sub === 'keep') result = keepLesson(data, needText(flags.id, 'id'));
      else result = retireLesson(data, needText(flags.id, 'id'), flags.reason);
      await writeJsonAtomic(store, data);
      return result;
    });
  }
  throw invalid(`reflect needs trouble-log or lessons\n${usage}`);
}
