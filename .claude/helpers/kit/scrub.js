/**
 * scrub — check every file git tracks, line by line, against a list of forbidden regular expressions.
 *
 *   scrub [--dir <repo>] [--worktree] [--json] [--max-file-bytes <n>]
 *
 * Patterns come from two files in the repository top (read from the working tree, as data, never executed):
 *   .claude/kit/scrub-patterns         public, committed; a hit may show the pattern
 *   .claude/kit/scrub-patterns.local   private, git-ignored by the kit install; a hit NEVER shows the pattern or
 *                                      the matched text, only "private pattern #n" (or its label) and file:line
 * One regular expression per line (JavaScript syntax); blank lines and lines starting with # are ignored; an optional
 * "label: regex" form (label = letters, digits, _ . -, then a colon and a space) names the pattern; a leading (?i)
 * makes it case-insensitive. A pattern that is not a valid regex, or that matches the empty string, is exit 1 naming
 * the file and line (never the pattern). No pattern file at all: exit 0 with { configured: false }.
 *
 * What is scanned: the HEAD tree (what a push publishes), listed with `git ls-tree -r -z -l` and read with
 * `git cat-file --batch`, both through safe-git (the repository's own config never runs). With --worktree it scans the
 * tracked files as they are on disk instead (`git ls-files -z -s`, then a bounded read of each file). Text is decoded
 * as UTF-16 when the file starts with a UTF-16 byte order mark (LE or BE; the BOM is dropped), else as UTF-8 (a UTF-8
 * BOM is dropped), so an ASCII pattern still matches inside a binary file. UTF-16 without a BOM is NOT detected.
 * Lines are split on "\n" (one trailing "\r" ignored); every pattern is tried on every line, one hit per line and pattern.
 * The pattern files and this module (src/lib/kit/scrub.js and its installed copy) are not scanned, so they do not
 * match their own patterns.
 *
 * Never a partial scan presented as complete. Each file is read up to --max-file-bytes (default 32 MiB; the HEAD read
 * goes through batches of at most 32 MiB); a larger file, a tracked file that is missing or not a regular file in
 * --worktree mode, and everything after a 2 GiB total are listed in not_scanned with the reason, and the result says
 * complete: false and exits 2. Submodule entries (gitlinks) are not files of this repository: they are listed under
 * submodules and not scanned. More than 200000 tracked files is a refusal (exit 2); at most 1000 hits are collected
 * (truncated: true). A git failure, a corrupt batch answer or an unreadable pattern file is exit 1, never a pass.
 * A regular expression you write runs as is: a pattern with catastrophic backtracking will be slow on a long line.
 *
 * Exit: 0 clean (or not configured), 2 hits or an incomplete scan, 1 bad input or broken state.
 * Built from ideas audited by /w-bbs (run 2026-10-10-openqodex-2); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { safeGit, locateRepo, defaultGitRunner } from './safe-git.js';
import { gitPaths } from './git-paths.js';

export const verb = 'scrub';
export const usage = 'cli.js scrub [--dir <repo>] [--worktree] [--json] [--max-file-bytes <n>]   (checks every tracked file, line by line, against '
  + '.claude/kit/scrub-patterns and .claude/kit/scrub-patterns.local; HEAD tree by default, tracked files on disk with --worktree; '
  + 'exit 0 clean or not configured, 2 hits or an incomplete scan, 1 bad input)';

export const PUBLIC_FILE = '.claude/kit/scrub-patterns';
export const PRIVATE_FILE = '.claude/kit/scrub-patterns.local';
export const EXCLUDED = Object.freeze([PUBLIC_FILE, PRIVATE_FILE, 'src/lib/kit/scrub.js', '.claude/helpers/kit/scrub.js']);

const MiB = 1024 * 1024;
export const LIMITS = Object.freeze({
  file: 32 * MiB, batch: 32 * MiB, batchEntries: 20000, total: 2048 * MiB, files: 200000, hits: 1000, patternFile: MiB, shown: 50
});

const invalid = (m) => new KitExit(m, 1);
const refuse = (m) => new KitExit(m, 2);

// ---------------------------------------------------------------- patterns

/** Parse one pattern file's text → [{ n, label, regex, source }]. KitExit 1 names `file` and the line, never the pattern. */
export function parsePatterns(text, file) {
  const out = [];
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    let label = null;
    let body = line;
    const m = /^([A-Za-z0-9_.-]+): (.+)$/.exec(line);
    if (m) { label = m[1]; body = m[2]; }
    let flags = '';
    if (body.startsWith('(?i)')) { flags = 'i'; body = body.slice(4); }
    let regex;
    try { regex = new RegExp(body, flags); } catch {
      throw invalid(`${file} line ${i + 1}: not a valid regular expression (see cli.js scrub --help)`);
    }
    if (regex.test('')) throw invalid(`${file} line ${i + 1}: the pattern matches the empty string, so it would match every line`);
    out.push({ n: out.length + 1, label, regex, source: body });
  });
  return out;
}

async function readPatternFile(top, rel) {
  const file = path.join(top, ...rel.split('/'));
  let st;
  try { st = await fs.lstat(file); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw invalid(`cannot read ${rel}: ${e.code || e.message}`);
  }
  if (!st.isFile()) throw invalid(`${rel} is not a regular file`);
  if (st.size > LIMITS.patternFile) throw invalid(`${rel} is larger than ${LIMITS.patternFile} bytes`);
  let buf;
  try { buf = await fs.readFile(file); } catch (e) { throw invalid(`cannot read ${rel}: ${e.code || e.message}`); }
  const text = decodeText(buf);
  if (text.includes('\0')) throw invalid(`${rel} still contains NUL characters after decoding; save it as UTF-8 or UTF-16 with a byte order mark`);
  return text;
}

/** Load both pattern files from the repository top. `configured` is false when neither file exists. */
export async function loadPatterns(top) {
  const pub = await readPatternFile(top, PUBLIC_FILE);
  const priv = await readPatternFile(top, PRIVATE_FILE);
  return {
    configured: pub !== null || priv !== null,
    public: pub === null ? [] : parsePatterns(pub, PUBLIC_FILE),
    private: priv === null ? [] : parsePatterns(priv, PRIVATE_FILE)
  };
}

// ---------------------------------------------------------------- decoding and matching

/** Bytes → text: UTF-16 (LE/BE) when a BOM says so, else UTF-8; a BOM is dropped. */
export function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2, 2 + ((buf.length - 2) & ~1)).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1)));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  const t = buf.toString('utf-8');
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

/**
 * Every (line, pattern) match in `buf`: [{ line, pattern }], at most `max`. `patterns` are tagged objects
 * ({ kind, n, label, regex }); a hit carries the same object, so the caller decides what may be printed.
 */
export function scanBuffer(buf, patterns, max = Infinity) {
  const hits = [];
  if (!patterns.length) return hits;
  const text = decodeText(buf);
  let start = 0;
  let line = 1;
  while (start <= text.length && hits.length < max) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    let s = text.slice(start, end);
    if (s.endsWith('\r')) s = s.slice(0, -1);
    for (const p of patterns) {
      if (p.regex.test(s)) { hits.push({ line, pattern: p }); if (hits.length >= max) break; }
    }
    start = end + 1;
    line++;
  }
  return hits;
}

// ---------------------------------------------------------------- listing and reading tracked files

/** A readable name for raw (latin1-decoded) path bytes: UTF-8 when valid, else every byte >= 0x80 shown as \\xNN. */
export function displayName(raw) {
  const bytes = Buffer.from(raw, 'latin1');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    return raw.replace(/[\x80-\xff]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  }
}

/** HEAD tree entries via `ls-tree -r -z -l` (stdout latin1, so path bytes survive): { files: [{path, raw, sha, size, mode}], submodules: [path] }. */
export function parseLsTree(stdout) {
  const files = [];
  const submodules = [];
  for (const rec of stdout.split('\0')) {
    if (!rec) continue;
    const m = /^(\d+) (\w+) ([0-9a-f]+) +(-|\d+)\t([\s\S]*)$/.exec(rec);
    if (!m) throw invalid('unexpected git ls-tree output');
    const [, mode, type, sha, size, p] = m;
    if (type === 'commit') submodules.push(displayName(p));
    else if (type === 'blob') files.push({ path: displayName(p), raw: p, sha, size: Number(size), mode });
    else throw invalid('unexpected git ls-tree output');
  }
  return { files, submodules };
}

/** Index entries via `ls-files -z -s`: same shape as parseLsTree (size unknown until read). */
export function parseLsFiles(stdout) {
  const files = [];
  const submodules = [];
  const seen = new Set();
  for (const rec of stdout.split('\0')) {
    if (!rec) continue;
    const m = /^(\d+) ([0-9a-f]+) (\d)\t([\s\S]*)$/.exec(rec);
    if (!m) throw invalid('unexpected git ls-files output');
    const [, mode, sha, , p] = m;
    if (seen.has(p)) continue; // a conflicted path lists once per stage
    seen.add(p);
    if (mode === '160000') submodules.push(displayName(p)); else files.push({ path: displayName(p), raw: p, sha, size: null, mode });
  }
  return { files, submodules };
}

/** Parse `cat-file --batch` output (a Buffer) for the expected entries, in order. KitExit 1 on anything unexpected. */
export function parseBatch(buf, expected) {
  const out = [];
  let pos = 0;
  for (const e of expected) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) throw invalid('git cat-file answered with fewer objects than asked for');
    const head = buf.toString('latin1', pos, nl);
    const m = /^([0-9a-f]+) (\w+) (\d+)$/.exec(head);
    if (!m || m[1] !== e.sha || m[2] !== 'blob' || (e.size !== null && Number(m[3]) !== e.size)) {
      throw invalid('git cat-file answered with an object that was not asked for');
    }
    const size = Number(m[3]);
    const dataStart = nl + 1;
    if (dataStart + size > buf.length) throw invalid('git cat-file answer was cut short');
    out.push(buf.subarray(dataStart, dataStart + size));
    pos = dataStart + size + 1; // the newline after the contents
  }
  if (pos < buf.length) throw invalid('git cat-file answered with more than was asked for');
  return out;
}

/** Read a whole file up to `cap` bytes (null when longer). The buffer starts at the file's known size, not at the cap. */
async function readBounded(file, cap, size = 0) {
  const fh = await fs.open(file, 'r');
  try {
    let buf = Buffer.alloc(Math.min(size, cap) + 1);
    let n = 0;
    for (;;) {
      if (n === buf.length) { // the file grew since lstat: enlarge, still capped
        const bigger = Buffer.alloc(Math.min(buf.length * 2, cap + 1));
        buf.copy(bigger, 0, 0, n);
        buf = bigger;
      }
      const { bytesRead } = await fh.read(buf, n, buf.length - n, null);
      if (bytesRead === 0) break;
      n += bytesRead;
      if (n > cap) return null;
    }
    return buf.subarray(0, n);
  } finally { await fh.close(); }
}

/** A git runner that keeps every byte of `cat-file`, `ls-files` and `ls-tree` output (latin1); every other command decodes as UTF-8. */
export function binaryRunner(base = defaultGitRunner) {
  return (args, o = {}) => {
    const cmd = args.find((a, i) => !String(a).startsWith('-') && args[i - 1] !== '-c');
    return ['cat-file', 'ls-files', 'ls-tree'].includes(cmd) ? base(args, { ...o, encoding: 'latin1' }) : base(args, o);
  };
}

/**
 * Scan the tracked files of the repository whose top is `top`.
 * options: { patterns (from loadPatterns), worktree, git (runner), env, maxFileBytes, limits }
 */
export async function scanRepo(top, { patterns, worktree = false, git, env = process.env, maxFileBytes, limits = LIMITS } = {}) {
  const cap = Math.min(maxFileBytes ?? limits.file, limits.total);
  const runner = git || binaryRunner();
  const exec = async (args, input) => {
    const r = await safeGit(top, args, { git: runner, env, input });
    if (r.code !== 0) throw invalid(`git ${args[0]} failed: ${String(r.stderr || r.stdout).trim().slice(0, 200) || 'no message'}`);
    return r;
  };
  const listed = worktree
    ? parseLsFiles((await exec(['ls-files', '-z', '-s'])).stdout)
    : parseLsTree((await exec(['ls-tree', '-r', '-z', '-l', 'HEAD'])).stdout);
  if (listed.files.length + listed.submodules.length > limits.files) {
    throw refuse(`more than ${limits.files} tracked files; scrub will not claim a scan of that many`);
  }
  if (listed.files.some(f => f.path === PRIVATE_FILE)) {
    throw refuse(`${PRIVATE_FILE} (the private pattern file) is tracked by git and would be published; untrack it (git rm --cached) and keep it git-ignored before pushing`);
  }
  const excluded = new Set(EXCLUDED);
  const files = listed.files.filter(f => !excluded.has(f.path));
  const all = [...patterns.public.map(p => ({ ...p, kind: 'public' })), ...patterns.private.map(p => ({ ...p, kind: 'private' }))];

  const hits = [];
  const notScanned = [];
  let scannedFiles = 0;
  let scannedBytes = 0;
  let truncated = false;
  const record = (file, found) => {
    for (const h of found) {
      if (hits.length >= limits.hits) { truncated = true; return; }
      hits.push({ file, line: h.line, pattern: h.pattern });
    }
  };
  const room = () => limits.hits - hits.length;
  const full = () => hits.length >= limits.hits;
  const overTotal = () => scannedBytes >= limits.total;

  if (worktree) {
    for (const f of files) {
      if (overTotal()) { notScanned.push({ file: f.path, reason: 'total size limit reached' }); continue; }
      const abs = Buffer.concat([Buffer.from(top + path.sep), Buffer.from(f.raw, 'latin1')]);
      try {
        const st = await fs.lstat(abs);
        let buf;
        if (st.isSymbolicLink()) buf = Buffer.from(await fs.readlink(abs), 'utf-8');
        else if (!st.isFile()) { notScanned.push({ file: f.path, reason: 'not a regular file on disk' }); continue; }
        else if (st.size > cap) { notScanned.push({ file: f.path, reason: `larger than ${cap} bytes` }); continue; }
        else {
          buf = await readBounded(abs, cap, st.size);
          if (buf === null) { notScanned.push({ file: f.path, reason: `larger than ${cap} bytes` }); continue; }
        }
        scannedFiles++; scannedBytes += buf.length;
        record(f.path, scanBuffer(buf, all, Math.max(room(), 1)));
      } catch (e) {
        notScanned.push({ file: f.path, reason: e.code === 'ENOENT' ? 'tracked but missing on disk' : `cannot read: ${e.code || 'error'}` });
      }
    }
  } else {
    let batch = [];
    let batchBytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const r = await exec(['cat-file', '--batch'], batch.map(b => b.sha).join('\n') + '\n');
      const blobs = parseBatch(Buffer.from(r.stdout, 'latin1'), batch);
      batch.forEach((b, i) => {
        scannedFiles++; scannedBytes += blobs[i].length;
        record(b.path, scanBuffer(blobs[i], all, Math.max(room(), 1)));
      });
      batch = []; batchBytes = 0;
    };
    for (const f of files) {
      if (f.size > cap) { notScanned.push({ file: f.path, reason: `larger than ${cap} bytes` }); continue; }
      if (scannedBytes + batchBytes + f.size > limits.total) { notScanned.push({ file: f.path, reason: 'total size limit reached' }); continue; }
      if (batch.length && (batchBytes + f.size > limits.batch || batch.length >= limits.batchEntries)) await flush();
      batch.push(f); batchBytes += f.size;
    }
    await flush();
  }
  return { hits, notScanned, submodules: listed.submodules, scannedFiles, scannedBytes, truncated: truncated || full(), pattern_count: all.length };
}

// ---------------------------------------------------------------- reporting

function describeHit(h) {
  const p = h.pattern;
  if (p.kind === 'private') return { file: h.file, line: h.line, private: true, pattern: p.label || `private pattern #${p.n}` };
  return { file: h.file, line: h.line, private: false, pattern: p.label ? `${p.label}: ${p.source}` : p.source };
}

/** The result object for a scan (never carries private pattern text or matched text). */
export function report(scan, { patterns, worktree, json = false }) {
  const complete = scan.notScanned.length === 0;
  const hits = scan.hits.map(describeHit);
  const exit = hits.length || !complete ? 2 : 0;
  let reason = 'clean';
  if (hits.length && !complete) reason = `${hits.length} hit(s) and ${scan.notScanned.length} file(s) not scanned`;
  else if (hits.length) reason = `${hits.length} hit(s) against the scrub patterns`;
  else if (!complete) reason = `${scan.notScanned.length} file(s) were not scanned, so the scan is incomplete`;
  return {
    configured: true,
    mode: worktree ? 'worktree' : 'head',
    patterns: { public: patterns.public.length, private: patterns.private.length },
    scanned_files: scan.scannedFiles,
    scanned_bytes: scan.scannedBytes,
    complete,
    clean: exit === 0,
    reason,
    hit_count: hits.length,
    truncated: scan.truncated,
    hits: json ? hits : hits.slice(0, LIMITS.shown),
    hits_not_shown: json ? 0 : Math.max(0, hits.length - LIMITS.shown),
    not_scanned: scan.notScanned,
    submodules: scan.submodules,
    exit
  };
}

/** Find the repository top (git rev-parse --show-toplevel through safe-git) for `dir`. */
async function repoTop(dir, { git, env }) {
  const loc = await locateRepo(dir);
  if (!loc.top) throw invalid(`${dir} has no work tree (a bare repository or a path inside .git)`);
  const exec = (a) => safeGit(loc.top, a, { git, env });
  const [top] = await gitPaths(exec, loc.top, ['toplevel'], 'cannot find the repository');
  return top;
}

/**
 * Scan `dir` when a pattern file exists. Returns null when none does (not configured) or when the repository has no
 * work tree; the full report otherwise; throws KitExit when configured and the scrub cannot run (callers refuse).
 */
export async function scrubIfConfigured(dir, { worktree = false, git, env = process.env, maxFileBytes, limits } = {}) {
  const top = await repoTop(dir, { git, env });
  const patterns = await loadPatterns(top);
  if (!patterns.configured) return null;
  const scan = await scanRepo(top, { patterns, worktree, git, env, maxFileBytes, limits });
  return report(scan, { patterns, worktree });
}

// ---------------------------------------------------------------- CLI

const VALUE_FLAGS = ['dir', 'max-file-bytes'];
const BOOL_FLAGS = ['worktree', 'json', 'help'];

function parseArgs(args) {
  const f = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) throw invalid(`unexpected argument "${a}" (see cli.js scrub --help)`);
    const eq = a.indexOf('=');
    const k = a.slice(2, eq === -1 ? undefined : eq);
    if (BOOL_FLAGS.includes(k) && eq === -1) { f[k] = true; continue; }
    if (!VALUE_FLAGS.includes(k)) throw invalid(`unknown flag --${k} (see cli.js scrub --help)`);
    if (eq !== -1) f[k] = a.slice(eq + 1);
    else if (i + 1 < args.length) f[k] = args[++i];
    else throw invalid(`--${k} needs a value`);
  }
  if (f['max-file-bytes'] !== undefined && !/^[1-9]\d{0,15}$/.test(f['max-file-bytes'])) throw invalid('--max-file-bytes must be a positive integer');
  if (f['max-file-bytes'] !== undefined && Number(f['max-file-bytes']) > LIMITS.total) throw invalid(`--max-file-bytes must be at most ${LIMITS.total} (see cli.js scrub --help)`);
  return f;
}

export async function run(args, io = {}) {
  const f = parseArgs(args);
  if (f.help) return { usage };
  const dir = path.resolve(io.cwd || process.cwd(), f.dir || '.');
  const env = io.env || process.env;
  const git = io.git || undefined;
  const top = await repoTop(dir, { git, env });
  const patterns = await loadPatterns(top);
  if (!patterns.configured) {
    return { configured: false, reason: `no pattern file: add ${PUBLIC_FILE} and/or ${PRIVATE_FILE} to turn the scrub check on; nothing was scanned`, exit: 0 };
  }
  const worktree = !!f.worktree;
  const scan = await scanRepo(top, { patterns, worktree, git, env, maxFileBytes: f['max-file-bytes'] ? Number(f['max-file-bytes']) : undefined });
  return report(scan, { patterns, worktree, json: !!f.json });
}
