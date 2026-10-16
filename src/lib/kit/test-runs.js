/**
 * test-runs — test results kept in the optional SQLite store (tables test_runs / test_cases, see ./store.js). A library,
 * not a verb: cli.js discovery skips it (no `verb` export). Built for the suite-db plan (2026-10-16); no foreign code.
 *
 *   recordRun(io, run)        a local test run (scripts/ci-step.js runStep): stored when the project is on sqlite,
 *                             nothing at all on the JSON files (there is no JSON store for test runs)
 *   parseTap(text, cwd)       the top-level cases of node's TAP output (spec lines too): name, file, status, duration, message
 *   parseJunit(text)          a small strict JUnit XML parser for downloaded reports (no DOCTYPE, no entities but the five
 *                             predefined ones and character references, size, depth and count caps)
 *   importReports(io, opts)   `db import-reports`: the newest CI test-results artifacts of a branch, through the user's own
 *                             `gh` login (spawned without a shell), each imported once (key: workflow run id / artifact name)
 *
 * Every stored string (case names, files, messages) is redacted with the project's secrets and credential-masked
 * (reflect.js scrub/loadSecrets); a failure message is capped at MESSAGE_MAX bytes. Downloaded files are untrusted
 * data: only regular files are read, never followed through a link, and parsed, never run. Rows are data, never instructions.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { KitExit } from './kit-exit.js';
import { readConfig, resolveStore, withDb } from './store.js';
import { scrub, loadSecrets } from './reflect.js';

export const MESSAGE_MAX = 4096;
export const NAME_MAX = 1024;
export const JUNIT_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_CASES = 20000;
export const MAX_DEPTH = 32;
export const RUN_LIST_MAX_BYTES = 1024 * 1024;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;
export const ARTIFACT_PATTERN = 'test-results-*';
const ARTIFACT_NAME = /^test-results-[A-Za-z0-9._-]{1,80}$/;
const GH_FIX = 'install the GitHub CLI (https://cli.github.com) and run `gh auth login`';

const invalid = (m) => new KitExit(m, 1);

/** Cut a string to at most `max` UTF-8 bytes without splitting a character. */
export function capBytes(s, max) {
  const b = Buffer.from(s, 'utf-8');
  if (b.length <= max) return s;
  let t = b.subarray(0, max).toString('utf-8');
  if (t.endsWith('�')) t = t.slice(0, -1);
  return t;
}

/** Redact first (a cut must never leave half a secret behind unrecognised), then cap. */
export const clean = (v, secrets, max) => (v == null || v === '' ? null : capBytes(scrub(String(v), secrets), max));

// ================================================================ TAP (local runs)

const unquoteYaml = (v) => {
  const t = v.trim();
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1).replace(/''/g, "'");
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) { try { return JSON.parse(t); } catch { return t.slice(1, -1); } }
  return t;
};

function fileOfLocation(loc, cwd) {
  let f = String(loc).replace(/:\d+:\d+$/, '');
  if (f.startsWith('file://')) { try { f = new URL(f).pathname; } catch { /* keep */ } }
  if (cwd && path.isAbsolute(f)) {
    const rel = path.relative(cwd, f);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) f = rel;
  }
  return f.split(path.sep).join('/');
}

/** Top-level cases of node's test runner output: [{ name, file, status: pass|fail|skip, duration_ms, message }]. */
export function parseTap(text, cwd) {
  const cases = new Map();
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    let m = /^(not ok|ok) \d+ - (.+?)(?: # (SKIP|TODO)\b.*)?$/.exec(lines[i]);
    if (m) {
      const c = { name: m[2].trim(), file: null, status: m[1] === 'ok' ? (m[3] === 'SKIP' ? 'skip' : 'pass') : (m[3] === 'TODO' ? 'skip' : 'fail'), duration_ms: null, message: null };
      if (lines[i + 1] === '  ---') {
        let j = i + 2;
        for (; j < lines.length && lines[j] !== '  ...'; j++) {
          const y = /^ {2}([A-Za-z_]+): ?(.*)$/.exec(lines[j]);
          if (!y) continue;
          const [, key, raw] = y;
          if (key === 'duration_ms') c.duration_ms = Math.round(Number(raw)) || 0;
          else if (key === 'location') c.file = fileOfLocation(unquoteYaml(raw), cwd);
          else if (key === 'error') {
            if (/^\|-?$/.test(raw.trim())) {
              const body = [];
              while (j + 1 < lines.length && /^ {4}/.test(lines[j + 1])) body.push(lines[++j].slice(4));
              c.message = body.join('\n');
            } else c.message = unquoteYaml(raw);
          }
        }
        i = j;
      }
      cases.set(c.name, c);
      continue;
    }
    m = /^(✔|✖|﹣) (.+?)(?: \(([\d.]+)ms\))?(?: # .*)?$/.exec(lines[i]);
    if (m && !/^failing tests:?$/.test(m[2]) && !cases.has(m[2].trim())) {
      cases.set(m[2].trim(), { name: m[2].trim(), file: null, status: m[1] === '✔' ? 'pass' : m[1] === '✖' ? 'fail' : 'skip', duration_ms: m[3] ? Math.round(Number(m[3])) : null, message: null });
    }
  }
  return [...cases.values()];
}

// ================================================================ JUnit (downloaded reports)

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&([^;&\s]{0,12});?/g, (all, ent) => {
    if (!all.endsWith(';')) throw invalid('junit.xml: a bare "&" (not an entity reference)');
    if (Object.hasOwn(ENTITIES, ent)) return ENTITIES[ent];
    const m = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(ent);
    if (m) {
      const cp = m[1] ? parseInt(m[1], 16) : Number(m[2]);
      if (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) throw invalid('junit.xml: a character reference out of range');
      return String.fromCodePoint(cp);
    }
    throw invalid('junit.xml: an entity other than the five predefined ones (entities are not expanded)');
  });
}

/**
 * Strict, small JUnit XML parser: { suites, cases: [{ suite, name, file, status, duration_ms, message }] }.
 * Refuses a DOCTYPE or any entity declaration, unknown entities, unbalanced tags, depth > MAX_DEPTH, more than MAX_CASES cases.
 */
export function parseJunit(text) {
  if (typeof text !== 'string') throw invalid('junit.xml: not text');
  if (Buffer.byteLength(text, 'utf-8') > JUNIT_MAX_BYTES) throw invalid(`junit.xml is larger than ${JUNIT_MAX_BYTES} bytes`);
  const src = text.replace(/^﻿/, '');
  const stack = [];
  const cases = [];
  let suites = 0;
  let cur = null; // the open testcase
  let msgEl = null; // the open failure/error element inside it
  let i = 0;
  const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
  const text_ = (t) => {
    if (!stack.length) { if (/\S/.test(t)) throw invalid('junit.xml: text outside the root element'); return; }
    const d = decode(t); // every text is checked, kept only inside a failure or error
    if (msgEl) msgEl.text += d;
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { text_(src.slice(i)); break; }
    if (lt > i) text_(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      if (e === -1) throw invalid('junit.xml: an unterminated comment');
      i = e + 3; continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      if (e === -1) throw invalid('junit.xml: an unterminated CDATA section');
      if (msgEl) msgEl.text += src.slice(lt + 9, e);
      i = e + 3; continue;
    }
    if (src.startsWith('<!', lt)) throw invalid('junit.xml: a DOCTYPE or declaration (refused: no DTDs, no entity expansion)');
    if (src.startsWith('<?', lt)) {
      const e = src.indexOf('?>', lt + 2);
      if (e === -1) throw invalid('junit.xml: an unterminated processing instruction');
      i = e + 2; continue;
    }
    // a tag: find its end outside quoted attribute values
    let j = lt + 1; let q = null;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break; else if (ch === '<') throw invalid('junit.xml: "<" inside a tag');
    }
    if (j >= src.length) throw invalid('junit.xml: an unterminated tag');
    const body = src.slice(lt + 1, j);
    i = j + 1;
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      const top = stack.pop();
      if (top !== name) throw invalid(`junit.xml: </${name.slice(0, 40)}> does not close <${String(top).slice(0, 40)}>`);
      if (name === 'testcase' && cur) { cases.push(cur); cur = null; }
      if ((name === 'failure' || name === 'error') && msgEl) { finishMsg(cur, msgEl); msgEl = null; }
      continue;
    }
    const selfClose = body.endsWith('/');
    const inner = selfClose ? body.slice(0, -1) : body;
    const nm = /^\s*([^\s/>]+)/.exec(inner);
    if (!nm || !NAME.test(nm[1])) throw invalid('junit.xml: a malformed tag');
    const name = nm[1];
    const attrs = {};
    const rest = inner.slice(nm[0].length);
    const re = /\s+([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')|(\s*$)/gy;
    for (;;) {
      if (re.lastIndex >= rest.length) break;
      const a = re.exec(rest);
      if (!a) throw invalid('junit.xml: a malformed attribute');
      if (a[5] !== undefined) break;
      if (Object.hasOwn(attrs, a[1])) throw invalid('junit.xml: a repeated attribute');
      attrs[a[1]] = decode(a[3] ?? a[4]);
    }
    if (!selfClose) {
      stack.push(name);
      if (stack.length > MAX_DEPTH) throw invalid(`junit.xml: nested deeper than ${MAX_DEPTH}`);
    }
    if (name === 'testsuite') suites++;
    if (name === 'testcase') {
      if (cur) throw invalid('junit.xml: a testcase inside a testcase');
      if (cases.length >= MAX_CASES) throw invalid(`junit.xml: more than ${MAX_CASES} test cases`);
      const t = Number(attrs.time);
      cur = { suite: attrs.classname ?? null, name: attrs.name ?? '', file: attrs.file ?? null, status: 'pass', duration_ms: Number.isFinite(t) && t >= 0 ? Math.round(t * 1000) : null, message: null };
      if (selfClose) { cases.push(cur); cur = null; }
    } else if (cur && (name === 'failure' || name === 'error')) {
      const el = { attr: attrs.message ?? '', text: '' };
      if (selfClose) finishMsg(cur, el); else msgEl = el;
    } else if (cur && name === 'skipped') {
      if (cur.status === 'pass') cur.status = 'skip';
    }
  }
  if (stack.length) throw invalid(`junit.xml: <${stack[stack.length - 1].slice(0, 40)}> is never closed`);
  return { suites, cases };
}

function finishMsg(c, el) {
  if (!c) return;
  c.status = 'fail';
  const m = [el.attr, el.text.trim()].filter(Boolean);
  const msg = m.length === 2 && m[1].startsWith(m[0]) ? m[1] : m.join('\n');
  c.message = c.message ? `${c.message}\n${msg}` : (msg || null);
}

// ================================================================ storing

/** Insert one run and its cases (strings already cleaned). Returns the run id. */
export function insertRun(db, run, cases) {
  const count = (s) => cases.filter((c) => c.status === s).length;
  const id = Number(db.run(
    'INSERT INTO test_runs (branch, commit_sha, source, started_at, finished_at, total, passed, failed, skipped, duration_ms, data, status, run_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    run.branch, run.commit ?? null, run.source ?? null, run.started_at, run.finished_at ?? null, cases.length, count('pass'), count('fail'), count('skip'),
    run.duration_ms ?? null, run.data ? JSON.stringify(run.data) : null, run.status, run.run_key ?? null
  ).lastInsertRowid);
  for (const c of cases) {
    db.run('INSERT INTO test_cases (run_id, suite, name, file, status, duration_ms, message) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, c.suite ?? null, c.name, c.file ?? null, c.status, c.duration_ms ?? null, c.message ?? null);
  }
  return id;
}

/** Clean every stored string of the cases: redacted and capped. */
export function cleanCases(cases, secrets) {
  return cases.map((c) => ({
    suite: clean(c.suite, secrets, NAME_MAX),
    name: clean(c.name, secrets, NAME_MAX) ?? '(unnamed)',
    file: clean(c.file, secrets, NAME_MAX),
    status: ['pass', 'fail', 'skip'].includes(c.status) ? c.status : 'fail',
    duration_ms: Number.isFinite(c.duration_ms) ? c.duration_ms : null,
    message: clean(c.message, secrets, MESSAGE_MAX)
  }));
}

function git(cwd, args, env) {
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf-8', shell: false });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The current branch and commit (null when not a git repository). */
export function gitHead(cwd, env = process.env) {
  return { branch: git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], env), commit: git(cwd, ['rev-parse', 'HEAD'], env) };
}

/**
 * Record a local run when the project is on sqlite. run: { output, code, signal, started_at, finished_at }.
 * Resolves { recorded: false } on the JSON files; throws (KitExit) when sqlite is configured but cannot be written.
 */
export async function recordRun(io, run) {
  const cwd = io.cwd || process.cwd();
  const env = io.env || process.env;
  const ctx = await resolveStore({ cwd, env });
  if (ctx.kind !== 'sqlite') return { recorded: false };
  const secrets = await loadSecrets({}, cwd);
  const head = gitHead(cwd, env);
  const cases = cleanCases(parseTap(run.output || '', cwd), secrets);
  const status = run.code === 0 && !run.signal ? 'passed' : 'failed';
  const id = await withDb(ctx, (db) => insertRun(db, {
    branch: head.branch || '(no branch)', commit: head.commit, source: 'local', started_at: run.started_at, finished_at: run.finished_at,
    duration_ms: Date.parse(run.finished_at) - Date.parse(run.started_at), status,
    data: { exit_code: run.code ?? null, signal: run.signal ?? null, command: run.command ? capBytes(scrub(String(run.command), secrets), 200) : undefined }
  }, cases));
  return { recorded: true, id, cases: cases.length, status };
}

// ================================================================ import-reports

function gh(args, { cwd, env, maxBuffer = RUN_LIST_MAX_BYTES }) {
  const r = spawnSync('gh', args, { cwd, env, encoding: 'utf-8', shell: false, maxBuffer, timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error && r.error.code === 'ENOENT') throw invalid(`the GitHub CLI \`gh\` is not installed or not on PATH: ${GH_FIX}`);
  if (r.error) throw invalid(`gh ${args[0]} ${args[1] || ''} failed: ${r.error.code || r.error.message}`);
  return r;
}

const firstLine = (s, secrets) => capBytes(scrub(String(s || '').split('\n').find((l) => l.trim()) || '', secrets), 200);

/** Read one downloaded file as untrusted data: a regular file (not a link), at most `max` bytes. */
function readUntrusted(file, max) {
  let st;
  try { st = fs.lstatSync(file); } catch { return { missing: true }; }
  if (!st.isFile()) return { error: 'not a regular file' };
  if (st.size > max) return { error: `larger than ${max} bytes` };
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const buf = Buffer.alloc(Math.min(st.size, max) + 1);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n > max) return { error: `larger than ${max} bytes` };
    return { text: buf.subarray(0, n).toString('utf-8') };
  } finally { fs.closeSync(fd); }
}

/** The run list from `gh run list --json`, validated. */
export function parseRunList(text) {
  let v;
  try { v = JSON.parse(text); } catch { throw invalid('gh run list did not return JSON'); }
  if (!Array.isArray(v)) throw invalid('gh run list did not return a list');
  return v.filter((r) => r && typeof r === 'object' && Number.isSafeInteger(r.databaseId) && r.databaseId > 0).map((r) => ({
    id: r.databaseId,
    sha: typeof r.headSha === 'string' && /^[0-9a-f]{7,64}$/.test(r.headSha) ? r.headSha : null,
    created: typeof r.createdAt === 'string' && !Number.isNaN(Date.parse(r.createdAt)) ? new Date(Date.parse(r.createdAt)).toISOString() : null,
    conclusion: typeof r.conclusion === 'string' ? r.conclusion.slice(0, 40) : ''
  }));
}

/**
 * `db import-reports`: { branch, runs_listed, imported: [...], skipped: [...] }.
 * Exit 1: not on sqlite (names `db init`), gh missing or not logged in (names `gh auth login`), a bad flag.
 */
export async function importReports(io, { branch, limit = DEFAULT_LIMIT } = {}) {
  const cwd = io.cwd || process.cwd();
  const env = io.env && Object.keys(io.env).length ? { ...process.env, ...io.env } : process.env;
  if (readConfig(cwd).store !== 'sqlite') throw invalid('import-reports stores test runs in the SQLite store, and this project is on the JSON files: run `db init` first');
  const ctx = await resolveStore({ cwd, env });
  if (branch === undefined) {
    branch = gitHead(cwd, env).branch;
    if (!branch || branch === 'HEAD') throw invalid('cannot tell the current git branch (detached HEAD or not a git repository): pass --branch <b>');
  }
  if (!branch || branch.startsWith('-') || !/^[^\s\0~^:?*[\\]{1,250}$/.test(branch)) throw invalid('--branch must be a git branch name');

  const auth = gh(['auth', 'status'], { cwd, env });
  // gh's own message is not echoed (it can name hosts and accounts); the exit status is enough to say what to do
  if (auth.status !== 0) throw invalid(`gh is not logged in (gh auth status exited ${auth.status}): run \`gh auth login\``);

  const secrets = await loadSecrets({}, cwd);
  const list = gh(['run', 'list', '--branch', branch, '--workflow', 'test.yml', '--limit', String(limit), '--json', 'databaseId,headSha,createdAt,conclusion'], { cwd, env });
  if (list.status !== 0) throw invalid(`gh run list failed: ${firstLine(list.stderr, secrets) || `exit ${list.status}`}`);
  const runs = parseRunList(list.stdout).slice(0, limit);

  const known = await withDb(ctx, (db) => new Set(db.all('SELECT run_key FROM test_runs WHERE run_key IS NOT NULL').map((r) => r.run_key)), { write: false });
  const skipped = [];
  const found = [];
  for (const r of runs) {
    if (!r.conclusion) { skipped.push({ run_id: r.id, reason: 'not finished' }); continue; }
    if ([...known].some((k) => k.startsWith(`${r.id}/`))) { skipped.push({ run_id: r.id, reason: 'already imported' }); continue; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-import-reports-'));
    try {
      const dl = gh(['run', 'download', String(r.id), '-p', ARTIFACT_PATTERN, '-D', dir], { cwd, env, maxBuffer: RUN_LIST_MAX_BYTES });
      if (dl.status !== 0) {
        const why = firstLine(dl.stderr, secrets);
        skipped.push({ run_id: r.id, reason: /no (valid )?artifact|no artifacts? match/i.test(why) ? 'no test-results artifact' : `download failed: ${why || `exit ${dl.status}`}` });
        continue;
      }
      const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      let any = false;
      for (const e of entries) {
        if (!ARTIFACT_NAME.test(e.name) || !e.isDirectory()) continue;
        any = true;
        const key = `${r.id}/${e.name}`;
        if (known.has(key)) { skipped.push({ run_id: r.id, artifact: e.name, reason: 'already imported' }); continue; }
        const f = readUntrusted(path.join(dir, e.name, 'junit.xml'), JUNIT_MAX_BYTES);
        if (f.missing || f.error) { skipped.push({ run_id: r.id, artifact: e.name, reason: f.missing ? 'no junit.xml' : `junit.xml ${f.error}` }); continue; }
        let parsed;
        try { parsed = parseJunit(f.text); } catch (err) { skipped.push({ run_id: r.id, artifact: e.name, reason: capBytes(err.message, 200) }); continue; }
        found.push({ run: r, artifact: e.name, key, cases: cleanCases(parsed.cases, secrets) });
      }
      if (!any) skipped.push({ run_id: r.id, reason: 'no test-results artifact' });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  const imported = await withDb(ctx, (db) => {
    const out = [];
    for (const x of found) {
      if (db.get('SELECT id FROM test_runs WHERE run_key = ?', x.key)) { skipped.push({ run_id: x.run.id, artifact: x.artifact, reason: 'already imported' }); continue; }
      const failed = x.cases.filter((c) => c.status === 'fail').length;
      const id = insertRun(db, {
        branch, commit: x.run.sha, source: `ci:${x.artifact}`, started_at: x.run.created || new Date(0).toISOString(), finished_at: null,
        status: failed ? 'failed' : 'passed', run_key: x.key, data: { workflow_run_id: x.run.id, artifact: x.artifact, conclusion: x.run.conclusion }
      }, x.cases);
      out.push({ run_id: x.run.id, artifact: x.artifact, test_run: id, cases: x.cases.length, failed });
    }
    return out;
  });
  return { branch, runs_listed: runs.length, imported, skipped };
}
