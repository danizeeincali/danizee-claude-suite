/**
 * redact — replace known secrets with a fixed marker before any text (a report, a log, a prompt to a model)
 * leaves the machine.
 *
 *   redact [--secrets-file <f>] [--keep-lines]      text on stdin → { text, replaced }
 *   redact --fingerprint [--secrets-file <f>]       prints { version: 1, prints: [{ length, sha256 }] } (no values)
 *   redact --fingerprints <f> [--max-length <n>]    scrubs short text on stdin using stored fingerprints
 *
 * Rules: secrets shorter than six characters are skipped; a multi-line secret also contributes each of its
 * trimmed lines (a partial copy is still caught); every match is located on the ORIGINAL text and overlapping
 * matches merge, so a short secret inside a longer one cannot leave a tail; --keep-lines keeps line breaks so
 * line numbers still match. The fingerprint path keeps only lengths and SHA-256 hashes and slides a window of
 * each length over the text (refused above maxLength, default 4096).
 *
 * Secrets file (default <git toplevel>/.claude/kit/secrets, git-ignored): one secret per line; a block from a
 * line starting `-----BEGIN` to a line starting `-----END` is ONE multi-line secret; blank lines are ignored.
 * A missing default file means nothing to redact. No error message ever contains a secret value.
 * Built from ideas audited by /w-bbs (run 2026-10-10-openqodex-2); no foreign code.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import { KitExit } from './kit-exit.js';

export const verb = 'redact';
export const usage = 'cli.js redact [--secrets-file <f>] [--keep-lines] | cli.js redact --fingerprint [--secrets-file <f>] | cli.js redact --fingerprints <f> [--max-length <n>]  (text on stdin)';

export const MARKER = '[REDACTED]';
export const MIN_LENGTH = 6;
export const DEFAULT_MAX_LENGTH = 4096;
export const DEFAULT_SECRETS = path.join('.claude', 'kit', 'secrets');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/** The strings worth matching: each secret of at least six characters, plus the trimmed lines of multi-line ones. */
function candidates(secrets) {
  if (!Array.isArray(secrets) || secrets.some(s => typeof s !== 'string')) throw new KitExit('secrets must be an array of strings', 1);
  const out = new Set();
  for (const s of secrets) {
    if (s.length >= MIN_LENGTH) out.add(s);
    if (/[\r\n]/.test(s)) for (const line of s.split(/\r?\n/)) { const t = line.trim(); if (t.length >= MIN_LENGTH) out.add(t); }
  }
  return [...out];
}

/** Sort and merge overlapping [start, end) ranges. */
function merge(ranges) {
  const out = [];
  for (const [s, e] of ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = out[out.length - 1];
    if (last && s < last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]);
  }
  return out;
}

function apply(text, ranges, keepLines) {
  let out = '';
  let at = 0;
  for (const [s, e] of ranges) {
    out += text.slice(at, s);
    const span = text.slice(s, e);
    out += keepLines ? span.replace(/[^\r\n]+/g, MARKER) : MARKER;
    at = e;
  }
  return { text: out + text.slice(at), replaced: ranges.length };
}

export function redactSecrets(text, secrets, { keepLines = false } = {}) {
  if (typeof text !== 'string') throw new KitExit('text must be a string', 1);
  const ranges = [];
  for (const c of candidates(secrets)) {
    for (let i = text.indexOf(c); i !== -1; i = text.indexOf(c, i + 1)) ranges.push([i, i + c.length]);
  }
  return apply(text, merge(ranges), keepLines);
}

export function fingerprintSecrets(secrets) {
  const seen = new Map();
  for (const c of candidates(secrets)) seen.set(sha(c), c.length);
  const prints = [...seen].map(([sha256, length]) => ({ length, sha256 })).sort((a, b) => a.length - b.length || (a.sha256 < b.sha256 ? -1 : 1));
  return { version: 1, prints };
}

export function redactByFingerprint(text, prints, { maxLength = DEFAULT_MAX_LENGTH } = {}) {
  if (typeof text !== 'string') throw new KitExit('text must be a string', 1);
  if (!Array.isArray(prints) || prints.some(p => !p || !Number.isInteger(p.length) || p.length < MIN_LENGTH || typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256))) {
    throw new KitExit('fingerprints must be a list of { length, sha256 } (run: redact --fingerprint --secrets-file <f>)', 1);
  }
  if (text.length > maxLength) throw new KitExit(`text is ${text.length} characters, over the ${maxLength} limit for fingerprint scrubbing; use --secrets-file for long text`, 1);
  const byLength = new Map();
  for (const p of prints) { if (!byLength.has(p.length)) byLength.set(p.length, new Set()); byLength.get(p.length).add(p.sha256); }
  const ranges = [];
  for (const [len, hashes] of byLength) {
    for (let i = 0; i + len <= text.length; i++) if (hashes.has(sha(text.slice(i, i + len)))) ranges.push([i, i + len]);
  }
  return apply(text, merge(ranges), false);
}

/** Parse the secrets file format (see the header). */
export function parseSecretsFile(content) {
  const lines = String(content).split('\n').map(l => l.replace(/\r$/, ''));
  const secrets = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('-----BEGIN')) {
      const block = [line];
      let closed = false;
      for (i++; i < lines.length; i++) {
        block.push(lines[i]);
        if (lines[i].startsWith('-----END')) { closed = true; break; }
      }
      if (!closed) throw new KitExit('secrets file has a -----BEGIN block with no matching -----END line', 1);
      secrets.push(block.join('\n'));
    } else if (line.trim() !== '') secrets.push(line);
  }
  return secrets;
}

function toplevel(cwd, spawn = spawnSync) {
  const r = spawn('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8' });
  if (r.error) throw new KitExit(`cannot run git: ${r.error.message}`, 1);
  if (r.status !== 0) throw new KitExit('not inside a git repository, so the default secrets file cannot be located; pass --secrets-file', 1);
  return r.stdout.trim();
}

async function readFileOr(file, what, optional) {
  try { return await fs.readFile(file, 'utf-8'); } catch (e) {
    if (optional && e.code === 'ENOENT') return null;
    throw new KitExit(`cannot read ${what} ${file}: ${e.code || 'read failed'}`, 1);
  }
}

/** The project's secrets (default file), or [] when it does not exist. For callers that import this module. */
export async function loadProjectSecrets(projectDir) {
  const text = await readFileOr(path.join(projectDir, DEFAULT_SECRETS), 'secrets file', true);
  return text === null ? null : parseSecretsFile(text);
}

const BOOL = ['keep-lines', 'fingerprint'];
const VALUE = ['secrets-file', 'fingerprints', 'max-length'];

function parse(args) {
  const flags = {};
  const rest = [...args];
  while (rest.length) {
    const a = rest.shift();
    if (!a.startsWith('--')) throw new KitExit(`unexpected argument "${a}"\n${usage}`, 1);
    const k = a.slice(2);
    if (BOOL.includes(k)) flags[k] = true;
    else if (VALUE.includes(k)) {
      if (!rest.length || rest[0].startsWith('--')) throw new KitExit(`--${k} needs a value`, 1);
      flags[k] = rest.shift();
    } else throw new KitExit(`unknown flag --${k} (allowed: ${[...BOOL, ...VALUE].map(f => `--${f}`).join(', ')})`, 1);
  }
  return flags;
}

export async function run(args, io) {
  const flags = parse(args);
  const cwd = io.cwd || process.cwd();
  if (flags.fingerprints && (flags['secrets-file'] || flags.fingerprint || flags['keep-lines'])) {
    throw new KitExit('--fingerprints cannot be combined with --secrets-file, --fingerprint or --keep-lines', 1);
  }
  if (flags['max-length'] !== undefined && !flags.fingerprints) throw new KitExit('--max-length only applies with --fingerprints', 1);
  if (flags.fingerprint && flags['keep-lines']) throw new KitExit('--keep-lines does not apply to --fingerprint', 1);

  if (flags.fingerprints) {
    const file = path.resolve(cwd, flags.fingerprints);
    let data;
    try { data = JSON.parse(await readFileOr(file, 'fingerprint file', false)); } catch (e) {
      if (e instanceof KitExit) throw e;
      throw new KitExit(`fingerprint file ${file} is not valid JSON`, 1);
    }
    if (!data || data.version !== 1) throw new KitExit(`fingerprint file ${file} is not a version 1 fingerprint file`, 1);
    let maxLength;
    if (flags['max-length'] !== undefined) {
      if (!/^\d+$/.test(flags['max-length']) || Number(flags['max-length']) < 1) throw new KitExit('--max-length must be a positive integer', 1);
      maxLength = Number(flags['max-length']);
    }
    return redactByFingerprint(await io.stdin(), data.prints, maxLength ? { maxLength } : {});
  }

  let secrets;
  if (flags['secrets-file']) {
    secrets = parseSecretsFile(await readFileOr(path.resolve(cwd, flags['secrets-file']), 'secrets file', false));
  } else {
    const file = path.join(toplevel(cwd), DEFAULT_SECRETS);
    const text = await readFileOr(file, 'secrets file', true);
    secrets = text === null ? [] : parseSecretsFile(text);
  }
  if (flags.fingerprint) return fingerprintSecrets(secrets);
  return redactSecrets(await io.stdin(), secrets, { keepLines: !!flags['keep-lines'] });
}
