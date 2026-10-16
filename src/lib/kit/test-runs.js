/**
 * test-runs — test results kept in the optional local SQLite index (tables test_runs / test_cases / imported_reports,
 * see ./store.js). Unlike the kit state, test runs live only in the index: the CI artifacts are their durable copy.
 * A library, not a verb: cli.js discovery skips it (no `verb` export). Built for the suite-db plan (2026-10-16); no foreign code.
 *
 *   recordRun(io, run)        a local test run (scripts/ci-step.js runStep): stored when the index is on for the
 *                             project (`db init`), nothing at all when it is off
 *   parseTap(text, cwd)       every test of node's TAP output (spec lines too): suite path, name, file, status, duration,
 *                             message; a list in output order (same-named tests of two files stay two cases)
 *   parseTapSummary(text)     the runner's `# tests` / `# pass` / ... summary; a local run's counts are taken from it
 *   parseJunit(text)          a small strict JUnit XML parser for downloaded reports (no DOCTYPE, no entities but the five
 *                             predefined ones and character references, size, depth and count caps)
 *   importReports(io, opts)   `db import-reports`: the newest CI test-results artifacts of a branch, through the user's own
 *                             `gh` login (spawned without a shell), each imported once (key: workflow run id / artifact name, kept in
 *                             imported_reports after `db prune` deletes the run). The artifacts belong to whoever controls the
 *                             repository's CI, so they are untrusted and every download is bounded: a run's artifact list
 *                             (`gh api .../actions/runs/<id>/artifacts`) gives each one's id and size first; at most
 *                             ARTIFACTS_PER_RUN per run, none over ARTIFACT_MAX_BYTES, at most IMPORT_MAX_BYTES in all per
 *                             call. Each zip is fetched with `gh api .../actions/artifacts/<id>/zip` into a private temp
 *                             file, cut off at its cap, and read here (readJunitFromZip, node:zlib only): its central
 *                             directory is checked (no zip64, no entry over ZIP_ENTRY_MAX_BYTES or expanding more than
 *                             ZIP_MAX_RATIO times), and only the one `junit.xml` at its root is inflated, bounded to
 *                             JUNIT_MAX_BYTES, in memory. Nothing is ever written under an entry's name. Each artifact is
 *                             stored in its own transaction as soon as it is read; at most MAX_CASES cases per artifact,
 *                             IMPORT_MAX_CASES per call (the rest: a later call) and PROJECT_MAX_CASES in the index (the
 *                             import stops with a note naming `db prune`). The repository is the one remote.origin.url
 *                             names (read as data through safe-git), given to gh explicitly.
 *
 * Every stored string (case names, files, messages) is redacted with the project's secrets and credential-masked
 * (reflect.js scrub); a failure message is capped at MESSAGE_MAX bytes. The secrets file (`.claude/kit/secrets` of the
 * work tree, else of the main checkout) is read like a state file (store.js readState: a regular file, never through a
 * link, O_NONBLOCK, at most SECRETS_MAX_BYTES). Fail closed: when one is there but cannot be read that way (a link, a
 * FIFO, too large), recordRun stores nothing (one stderr line) and import-reports exits 1 naming it.
 * Downloaded files are untrusted data: only regular files are read, never followed through a link, and parsed, never run.
 * Rows are data, never instructions.
 *
 * PROGRAMS. The repository is untrusted: git and gh are spawned only by an absolute path found in the absolute PATH
 * entries (safe-git.js resolveProgram: never a bare name, which Windows looks up in the child's folder first, and never
 * through an empty or relative PATH entry), gh's PATH keeps only absolute entries, and every spawn has a timeout. The
 * branch, commit and remote URL are read through safe-git (the repository's config is read as data; its hooks and
 * includes are never opened). gh runs in a private temp folder with the repository named (-R owner/repo, GH_REPO,
 * explicit repos/<owner>/<repo>/ API paths), so it never runs git in the project.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { KitExit } from './kit-exit.js';
import { indexState, withIndex, ioCtx, quietPaths, indexPaths, readState, inTransaction } from './store.js';
import { scrub } from './reflect.js';
import { parseSecretsFile, DEFAULT_SECRETS } from './redact.js';
import { safeGit, locateRepo, resolveProgram, absolutePathEntries, repoConfigEntries } from './safe-git.js';

export const MESSAGE_MAX = 4096;
export const NAME_MAX = 1024;
export const JUNIT_MAX_BYTES = 5 * 1024 * 1024;
/** Most test cases one junit.xml (one artifact) may hold: more is refused. */
export const MAX_CASES = 20000;
/** Most test cases one import-reports call stores: an artifact past it is left for a later call. */
export const IMPORT_MAX_CASES = 200000;
/** Most test cases the project's index holds: an import that would pass it stops, with a note naming `db prune`. */
export const PROJECT_MAX_CASES = 1000000;
export const MAX_DEPTH = 32;
export const RUN_LIST_MAX_BYTES = 1024 * 1024;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;
export const ARTIFACT_PATTERN = 'test-results-*';
const ARTIFACT_NAME = /^test-results-[A-Za-z0-9._-]{1,80}$/;
/** What ARTIFACT_PATTERN matches (gh's glob): the artifacts import-reports considers. */
const PATTERN_MATCH = /^test-results-/;
/** Largest artifact zip (as GitHub reports it, and as downloaded: the download is cut off past it) import-reports fetches. */
export const ARTIFACT_MAX_BYTES = 50 * 1024 * 1024;
/** Most bytes one import-reports call downloads in all. */
export const IMPORT_MAX_BYTES = 100 * 1024 * 1024;
/** Most test-results artifacts downloaded from one workflow run. */
export const ARTIFACTS_PER_RUN = 5;
/** Most artifacts one run may list: the size check reads one page of the listing, so a run with more is skipped. */
export const ARTIFACTS_PER_PAGE = 100;
/** A zip with more entries than this is not read. */
export const ZIP_MAX_ENTRIES = 1000;
/** A zip with an entry declaring more uncompressed bytes than this is refused (whatever the entry). */
export const ZIP_ENTRY_MAX_BYTES = 64 * 1024 * 1024;
/** A zip with an entry over 1 MiB that would expand more than this many times its compressed size is refused. */
export const ZIP_MAX_RATIO = 500;
/** The one entry read from an artifact: `junit.xml` at its root (the upload step's file). */
export const JUNIT_ENTRY = 'junit.xml';
const GH_FIX = 'install the GitHub CLI (https://cli.github.com) and run `gh auth login`';
/** Most bytes read from the secrets file. */
export const SECRETS_MAX_BYTES = 1024 * 1024;
/** The longest a git call (through safe-git) may take. */
export const GIT_TIMEOUT_MS = 20000;
/** The longest a small gh call (auth status, run list, an artifact list, repo view) may take; a download: DOWNLOAD_TIMEOUT_MS. */
export const GH_TIMEOUT_MS = 60000;
export const DOWNLOAD_TIMEOUT_MS = 300000;
/** The branch a run is recorded under when HEAD is detached, and when the repository has no commits yet. */
export const DETACHED = '(detached)';
export const NO_COMMITS = '(no commits yet)';
export const NO_BRANCH = '(no branch)';

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

const unescapeTap = (s) => s.replace(/\\(.)/g, '$1');

/**
 * Every test of node's test runner output, in output order: [{ suite, name, file, status: pass|fail|skip, duration_ms,
 * message }]. TAP: each `ok` / `not ok` line at any nesting depth whose YAML block does not say `type: 'suite'` (so the
 * counts match the runner's `# tests` summary: a test with subtests counts, a describe() does not); `suite` is the path of
 * the enclosing subtests (`a > b`), `file` comes from the `location` node gives (it does on a failure). Cases are a list,
 * never keyed by name: two files' tests of the same name (node --test a.js b.js) stay two cases, so a failing one is never
 * replaced by a passing one. A TODO case counts as skip (the runner's `# todo`). The spec reporter's top-level lines are
 * read only when there is no TAP, and its closing "failing tests" recap is not counted twice.
 */
export function parseTap(text, cwd) {
  const cases = [];
  const lines = String(text).split('\n');
  const stack = []; // open `# Subtest:` markers: { indent, name }
  let tap = false;
  for (let i = 0; i < lines.length; i++) {
    let m = /^( *)# Subtest: (.*)$/.exec(lines[i]);
    if (m) {
      const ind = m[1].length;
      while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop();
      stack.push({ indent: ind, name: unescapeTap(m[2].trim()) });
      continue;
    }
    m = /^( *)(not ok|ok) \d+(?: - (.*?))?(?: # (SKIP|TODO)\b.*)?$/.exec(lines[i]);
    if (m) {
      tap = true;
      const pad = m[1];
      const ind = pad.length;
      while (stack.length && stack[stack.length - 1].indent > ind) stack.pop();
      if (stack.length && stack[stack.length - 1].indent === ind) stack.pop();
      const c = {
        suite: stack.map((x) => x.name).join(' > ') || null,
        name: unescapeTap((m[3] || '').trim()) || '(unnamed)',
        file: null,
        status: m[4] ? 'skip' : m[2] === 'ok' ? 'pass' : 'fail',
        duration_ms: null,
        message: null
      };
      let type = null;
      if (lines[i + 1] === `${pad}  ---`) {
        const key = new RegExp(`^${pad} {2}([A-Za-z_]+): ?(.*)$`);
        let j = i + 2;
        for (; j < lines.length && lines[j] !== `${pad}  ...`; j++) {
          const y = key.exec(lines[j]);
          if (!y) continue;
          const [, k, raw] = y;
          if (k === 'duration_ms') c.duration_ms = Math.round(Number(raw)) || 0;
          else if (k === 'type') type = unquoteYaml(raw);
          else if (k === 'location') c.file = fileOfLocation(unquoteYaml(raw), cwd);
          else if (k === 'error') {
            if (/^\|-?$/.test(raw.trim())) {
              const body = [];
              while (j + 1 < lines.length && lines[j + 1].startsWith(`${pad}    `)) body.push(lines[++j].slice(ind + 4));
              c.message = body.join('\n');
            } else c.message = unquoteYaml(raw);
          }
        }
        i = j;
      }
      if (type !== 'suite') cases.push(c);
      continue;
    }
  }
  if (tap) return cases;
  for (const line of lines) {
    if (/^✖ failing tests:?$/.test(line)) break; // the recap repeats the failures already listed
    const m = /^(✔|✖|﹣) (.+?)(?: \(([\d.]+)ms\))?(?: # .*)?$/.exec(line);
    if (m) cases.push({ suite: null, name: m[2].trim(), file: null, status: m[1] === '✔' ? 'pass' : m[1] === '✖' ? 'fail' : 'skip', duration_ms: m[3] ? Math.round(Number(m[3])) : null, message: null });
  }
  return cases;
}

/**
 * The runner's closing summary (`# tests 5`, `# pass 3`, ...): { tests, pass, fail, cancelled, skipped, todo }, or null.
 * A command that ran the runner more than once printed several summaries: they are added up.
 */
export function parseTapSummary(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = /^(?:# |ℹ )(tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (m) out[m[1]] = (out[m[1]] || 0) + Number(m[2]);
  }
  if (out.tests === undefined) return null;
  for (const k of ['pass', 'fail', 'cancelled', 'skipped', 'todo']) out[k] = out[k] ?? 0;
  return out;
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
 * Refuses a DOCTYPE or any entity declaration, unknown entities, unbalanced tags, depth > MAX_DEPTH, more than `maxCases`
 * (MAX_CASES) cases.
 */
export function parseJunit(text, { maxCases = MAX_CASES } = {}) {
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
      if (cases.length >= maxCases) throw invalid(`junit.xml: more than ${maxCases} test cases`);
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
  // the runner's own summary when there is one (run.summary, see parseTapSummary), else the cases
  const sum = run.summary;
  const totals = sum
    ? [sum.tests, sum.pass, sum.fail + sum.cancelled, sum.skipped + sum.todo]
    : [cases.length, count('pass'), count('fail'), count('skip')];
  const id = Number(db.run(
    'INSERT INTO test_runs (branch, commit_sha, source, started_at, finished_at, total, passed, failed, skipped, duration_ms, data, status, run_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    run.branch, run.commit ?? null, run.source ?? null, run.started_at, run.finished_at ?? null, ...totals,
    run.duration_ms ?? null, run.data ? JSON.stringify(run.data) : null, run.status, run.run_key ?? null
  ).lastInsertRowid);
  // the key outlives the run: `db prune` deletes runs, never this, so a pruned report is not imported again
  if (run.run_key != null) {
    db.run('INSERT OR IGNORE INTO imported_reports (run_key, branch, imported_at) VALUES (?, ?, ?)', run.run_key, run.branch, new Date().toISOString());
  }
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

/**
 * The project's git state, through safe-git (never the repository's config, hooks or includes; git by its absolute
 * path; a timeout): { repo: false } outside a repository, else { repo: true, loc, commit, branch } where branch is the
 * branch name, DETACHED, or null with `unborn: true` when there are no commits yet.
 */
export async function gitHead(cwd, env = process.env) {
  const loc = await locateOrNull(cwd);
  if (!loc || !loc.top) return { repo: false, loc, branch: null, commit: null };
  const r = await safeGit(loc.top, ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD'], { env, timeout: GIT_TIMEOUT_MS });
  if (r.code !== 0) return { repo: true, loc, unborn: true, branch: null, commit: null };
  const [commit, name] = String(r.stdout).split('\n').map((l) => l.trim());
  return { repo: true, loc, commit: /^[0-9a-f]{40,64}$/.test(commit || '') ? commit : null, branch: name === 'HEAD' ? DETACHED : (name || null) };
}

/** The repository of `cwd`, found on the file system only (safe-git locateRepo), or null when it is not in one. */
async function locateOrNull(cwd) {
  try { return await locateRepo(cwd); } catch (e) {
    if (e instanceof KitExit && / is not a readable git repository /.test(e.message)) return null;
    throw e;
  }
}

/** The branch a local run is recorded under: the branch, DETACHED, NO_COMMITS or NO_BRANCH (not a repository). */
const runBranch = (head) => (!head.repo ? NO_BRANCH : head.unborn ? NO_COMMITS : head.branch || NO_BRANCH);

/**
 * The project's secrets for scrub(): `.claude/kit/secrets` of the work tree, then of the main checkout (a linked
 * worktree has none of its own: the file is git-ignored), as redact.js secretsRoots finds them, but located on the file
 * system (safe-git locateRepo), never by running git; outside a repository, of `cwd`. Each file is read like a state
 * file (readState). Fails closed: a secrets file that is there but cannot be read safely (a link, a folder on its way
 * that is a link, a FIFO, a device, a file over SECRETS_MAX_BYTES, unreadable) is KitExit 1 naming it, since without its
 * secrets nothing may be stored.
 */
export function projectSecrets(cwd, loc) {
  const roots = [];
  if (loc && loc.top) {
    roots.push(loc.top);
    if (loc.commonDir && path.basename(loc.commonDir) === '.git') { const main = path.dirname(loc.commonDir); if (main !== loc.top) roots.push(main); }
  } else roots.push(cwd);
  const all = [];
  for (const root of roots) {
    const file = path.join(root, DEFAULT_SECRETS);
    const st = readState(file, { root, max: SECRETS_MAX_BYTES });
    if (st.absent) continue;
    if (st.skip) {
      throw invalid(`the secrets file ${file} cannot be read safely (${st.skip}): its secrets could not be redacted, so no test results are stored; `
        + `make it a regular file (not a symbolic link) of at most ${SECRETS_MAX_BYTES} bytes`);
    }
    all.push(...parseSecretsFile(st.buf.toString('utf-8')));
  }
  return all;
}

/**
 * Record a local run when the index is on. run: { output, code, signal, started_at, finished_at, command }.
 * Resolves { recorded: false } when it is off, and { recorded: false, reason } with one stderr line when a secrets file
 * cannot be read safely (see projectSecrets: nothing is stored); throws (KitExit) when it is on but cannot be written.
 */
export async function recordRun(io, run) {
  const { cwd, env } = ioCtx(io);
  // a DANIZEE_KIT_HOME that cannot hold a setting: the index was never enabled (db status says why)
  const paths = quietPaths(cwd, env);
  if (!paths || !indexState(paths).enabled) return { recorded: false };
  const head = await gitHead(cwd, env);
  let secrets;
  try { secrets = projectSecrets(cwd, head.loc); } catch (e) {
    if (!(e instanceof KitExit)) throw e;
    try { process.stderr.write(`kit: test run not recorded in the kit index: ${e.message}\n`); } catch { /* nowhere to say it */ }
    return { recorded: false, reason: e.message };
  }
  const cases = cleanCases(parseTap(run.output || '', cwd), secrets);
  const status = run.code === 0 && !run.signal ? 'passed' : 'failed';
  const id = await withIndex({ cwd, env }, (db) => insertRun(db, {
    branch: runBranch(head), commit: head.commit, source: 'local', started_at: run.started_at, finished_at: run.finished_at,
    summary: parseTapSummary(run.output || ''),
    duration_ms: Date.parse(run.finished_at) - Date.parse(run.started_at), status,
    data: { exit_code: run.code ?? null, signal: run.signal ?? null, command: run.command ? capBytes(scrub(String(run.command), secrets), 200) : undefined }
  }, cases));
  return { recorded: true, id, cases: cases.length, status };
}

// ================================================================ import-reports

/** A GitHub owner/repo pair, as gh takes it. */
const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

/**
 * The GitHub repository a remote URL names: { host, owner, repo } or null. https://, ssh://, git:// and the scp form
 * (git@host:owner/repo), `.git` and a trailing slash dropped; owner and repo must each be [A-Za-z0-9_.-]+ (not . or ..).
 */
export function parseRemoteUrl(url) {
  const u = String(url ?? '').trim();
  let m = /^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d{1,5})?\/([^\s]+)$/.exec(u);
  if (!m && !u.includes('://')) m = /^(?:[^@/:\s]+@)?([^/:\s]+):(?!\/)([^\s]+)$/.exec(u);
  if (!m || !HOST.test(m[1])) return null;
  const parts = m[2].replace(/\/+$/, '').replace(/\.git$/, '').split('/');
  if (parts.length !== 2 || parts.some((x) => x === '.' || x === '..') || !SLUG.test(parts.join('/'))) return null;
  return { host: m[1].toLowerCase(), owner: parts[0], repo: parts[1] };
}

/**
 * The GitHub repository of the project, from its remote.origin.url (else its only remote), read as data through
 * safe-git (repoConfigEntries: no include, hook or program of the repository is opened): { host, owner, repo, arg, api }
 * where `arg` is what gh's -R takes and `api` the REST path prefix. A host without a dot (an ssh alias) counts as
 * github.com. KitExit 1 naming the problem.
 */
export async function githubRepo(loc, env = process.env) {
  if (!loc || !loc.top) throw invalid('import-reports needs a git repository with a GitHub remote (remote.origin.url): not a git repository');
  const entries = await repoConfigEntries(loc.top, { env, timeout: GIT_TIMEOUT_MS });
  const urls = new Map();
  for (const [k, v] of entries) { const m = /^remote\.(.+)\.url$/.exec(k); if (m && v) urls.set(m[1], v); }
  const url = urls.get('origin') ?? (urls.size === 1 ? [...urls.values()][0] : null);
  if (!url) throw invalid(`import-reports needs the GitHub repository: ${urls.size ? 'no remote named origin (and more than one remote)' : 'no git remote'} in ${loc.top}; add one (git remote add origin https://github.com/<owner>/<repo>.git)`);
  const r = parseRemoteUrl(url);
  if (!r) throw invalid(`import-reports cannot tell the GitHub repository from the remote URL ${JSON.stringify(capBytes(String(url), 200))}: it must name <owner>/<repo> ([A-Za-z0-9_.-])`);
  const host = r.host.includes('.') ? r.host : 'github.com';
  return { host, owner: r.owner, repo: r.repo, arg: host === 'github.com' ? `${r.owner}/${r.repo}` : `${host}/${r.owner}/${r.repo}`, api: `repos/${r.owner}/${r.repo}` };
}

/**
 * gh by its absolute path from the absolute PATH entries (never a bare name, never the project folder), with a PATH of
 * absolute entries only, the repository given (GH_REPO, and GH_HOST for a host other than github.com) and no system
 * git config: { file, env }. Exit 1 naming the fix when there is none. gh always runs in a private temp folder, never
 * the project, with the repository named explicitly, so it never runs git in the project.
 */
function ghProgram(env, repo) {
  const file = resolveProgram('gh', env);
  if (!file) throw invalid(`the GitHub CLI \`gh\` is not installed or not on PATH (only absolute PATH entries are searched): ${GH_FIX}`);
  const childEnv = { ...env, GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of Object.keys(childEnv)) {
    if (process.platform === 'win32' ? k.toUpperCase() === 'PATH' : k === 'PATH') childEnv[k] = absolutePathEntries(childEnv[k]).join(path.delimiter);
  }
  if (repo) {
    childEnv.GH_REPO = repo.arg;
    if (repo.host !== 'github.com') childEnv.GH_HOST = repo.host;
  }
  return { file, env: childEnv };
}

function gh(args, { cwd, env, repo, maxBuffer = RUN_LIST_MAX_BYTES }) {
  const prog = ghProgram(env, repo);
  const r = spawnSync(prog.file, args, { cwd, env: prog.env, encoding: 'utf-8', shell: false, maxBuffer, timeout: GH_TIMEOUT_MS, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error && r.error.code === 'ENOENT') throw invalid(`the GitHub CLI \`gh\` is not installed or not on PATH: ${GH_FIX}`);
  if (r.error && r.error.code === 'ETIMEDOUT') throw invalid(`gh ${args[0]} ${args[1] || ''} took longer than ${GH_TIMEOUT_MS} ms and was stopped`);
  if (r.error) throw invalid(`gh ${args[0]} ${args[1] || ''} failed: ${r.error.code || r.error.message}`);
  return r;
}

const firstLine = (s, secrets) => capBytes(scrub(String(s || '').split('\n').find((l) => l.trim()) || '', secrets), 200);

/** Read the downloaded zip (a file this process created): a regular file (not a link), at most `max` bytes, as a Buffer. */
function readDownload(file, max) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { error: 'not a regular file' };
    if (st.size > max) return { error: `larger than ${max} bytes` };
    const buf = Buffer.alloc(st.size + 1);
    let n = 0;
    for (;;) { const k = fs.readSync(fd, buf, n, buf.length - n, null); if (!k) break; n += k; if (n >= buf.length) break; }
    if (n > max) return { error: `larger than ${max} bytes` };
    return { buf: buf.subarray(0, n) };
  } finally { fs.closeSync(fd); }
}

/**
 * The text of the one `junit.xml` at the root of a zip archive, read from its central directory with node:zlib:
 * { text } | { missing } | { error }. Refused (error) without inflating anything: not a zip, a multi-part or zip64
 * archive, more than ZIP_MAX_ENTRIES entries, any entry declaring more than ZIP_ENTRY_MAX_BYTES or expanding more
 * than ZIP_MAX_RATIO times (over 1 MiB), two junit.xml entries, an encrypted or non-regular (link) junit.xml, one over
 * `maxOut` bytes. The inflate is bounded to `maxOut` bytes whatever the directory claims, and the result must have the
 * declared size and CRC. Entry names are only compared, never used as paths.
 */
export function readJunitFromZip(buf, { maxOut = JUNIT_MAX_BYTES } = {}) {
  const fail = (m) => ({ error: m });
  if (!Buffer.isBuffer(buf) || buf.length < 22) return fail('not a zip archive');
  let eocd = -1;
  for (let i = buf.length - 22, stop = Math.max(0, buf.length - 22 - 0xffff); i >= stop; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return fail('not a zip archive');
  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const here = buf.readUInt16LE(eocd + 8);
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) return fail('a zip64 archive: not read');
  if (disk || cdDisk || here !== count) return fail('a multi-part zip archive: not read');
  if (count > ZIP_MAX_ENTRIES) return fail(`a zip archive of more than ${ZIP_MAX_ENTRIES} entries: not read`);
  const cdEnd = cdOff + cdSize;
  if (cdEnd > eocd) return fail('a damaged zip archive (central directory out of range)');
  let p = cdOff;
  let found = null;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cdEnd || buf.readUInt32LE(p) !== 0x02014b50) return fail('a damaged zip archive (central directory)');
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28);
    const xl = buf.readUInt16LE(p + 30);
    const cl = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38);
    const lho = buf.readUInt32LE(p + 42);
    if (p + 46 + nl + xl + cl > cdEnd) return fail('a damaged zip archive (central directory)');
    const name = buf.subarray(p + 46, p + 46 + nl);
    p += 46 + nl + xl + cl;
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) return fail('a zip64 entry: not read');
    if (usize > ZIP_ENTRY_MAX_BYTES) return fail(`an entry declares ${usize} bytes uncompressed, more than ${ZIP_ENTRY_MAX_BYTES}: refused`);
    if (usize > 1024 * 1024 && usize > Math.max(csize, 1) * ZIP_MAX_RATIO) return fail(`an entry would expand ${Math.round(usize / Math.max(csize, 1))} times, more than ${ZIP_MAX_RATIO}: refused`);
    if (!name.equals(Buffer.from(JUNIT_ENTRY))) continue;
    if (found) return fail(`more than one ${JUNIT_ENTRY} entry: refused`);
    found = { madeBy, flags, method, crc, csize, usize, ext, lho };
  }
  if (!found) return { missing: true };
  if (found.flags & 1) return fail(`${JUNIT_ENTRY} is encrypted`);
  // a Unix entry's file type: none (permission bits only, as Python's writestr makes them) counts as regular
  const type = (found.madeBy >> 8) === 3 ? (found.ext >>> 16) & 0o170000 : 0;
  if (type && type !== 0o100000) return fail(`${JUNIT_ENTRY} not a regular file`);
  if (found.usize > maxOut) return fail(`${JUNIT_ENTRY} larger than ${maxOut} bytes`);
  const h = found.lho;
  if (h + 30 > cdOff || buf.readUInt32LE(h) !== 0x04034b50) return fail('a damaged zip archive (local header)');
  const lnl = buf.readUInt16LE(h + 26);
  const lxl = buf.readUInt16LE(h + 28);
  if (h + 30 + lnl > cdOff || !buf.subarray(h + 30, h + 30 + lnl).equals(Buffer.from(JUNIT_ENTRY))) return fail('a damaged zip archive (local header name differs)');
  const start = h + 30 + lnl + lxl;
  if (start + found.csize > cdOff) return fail('a damaged zip archive (entry out of range)');
  const raw = buf.subarray(start, start + found.csize);
  let data;
  if (found.method === 0) data = raw;
  else if (found.method === 8) {
    try { data = zlib.inflateRawSync(raw, { maxOutputLength: maxOut }); } catch (e) {
      return fail(e && e.code === 'ERR_BUFFER_TOO_LARGE' ? `${JUNIT_ENTRY} larger than ${maxOut} bytes` : `${JUNIT_ENTRY} cannot be inflated`);
    }
  } else return fail(`${JUNIT_ENTRY} uses compression method ${found.method}: not read`);
  if (data.length !== found.usize) return fail(`${JUNIT_ENTRY} is not the size its zip directory declares`);
  if (typeof zlib.crc32 === 'function' && (zlib.crc32(data) >>> 0) !== found.crc) return fail(`${JUNIT_ENTRY} fails its CRC check`);
  return { text: data.toString('utf-8') };
}

/**
 * Download one artifact zip with `gh api .../actions/artifacts/<id>/zip` (no shell) into `file` (created new, 0600),
 * cut off once more than `max` bytes arrive: { status, bytes, over, stderr }.
 */
function downloadArtifact(id, file, max, { cwd, env, repo }) {
  return new Promise((resolve) => {
    let fd;
    try { fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600); } catch (e) {
      resolve({ status: null, bytes: 0, over: false, stderr: `cannot create a temp file (${e.code || 'error'})` });
      return;
    }
    let bytes = 0;
    let over = false;
    let err = '';
    let settled = false;
    let prog;
    try { prog = ghProgram(env, repo); } catch (e) { try { fs.closeSync(fd); } catch { /* closed */ } resolve({ status: null, bytes: 0, over: false, stderr: e.message }); return; }
    const child = spawn(prog.file, ['api', `${repo.api}/actions/artifacts/${id}/zip`], { cwd, env: prog.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { err = err || 'timed out'; child.kill('SIGKILL'); }, DOWNLOAD_TIMEOUT_MS);
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); try { fs.closeSync(fd); } catch { /* closed */ } resolve(r); };
    child.stdout.on('data', (d) => {
      if (over) return;
      bytes += d.length;
      if (bytes > max) { over = true; child.kill('SIGKILL'); return; }
      try { fs.writeSync(fd, d); } catch (e) { err = `cannot write the temp file (${e.code || 'error'})`; over = true; child.kill('SIGKILL'); }
    });
    child.stderr.on('data', (d) => { if (err.length < 4096) err += d.toString('utf-8').slice(0, 4096 - err.length); });
    child.on('error', (e) => finish({ status: null, bytes, over, stderr: e.code === 'ENOENT' ? 'gh is not installed or not on PATH' : (e.code || e.message) }));
    child.on('close', (code) => finish({ status: code, bytes, over, stderr: err }));
  });
}

/**
 * A run's artifact listing from `gh api .../actions/runs/<id>/artifacts`, validated: [{ id, name, size, expired }]
 * (id null when the listing gives none: that artifact is not downloaded).
 * Throws (KitExit) when it is not that shape, or when the run has more artifacts than one page shows (their sizes
 * cannot all be checked).
 */
export function parseArtifactList(text) {
  let v;
  try { v = JSON.parse(text); } catch { throw invalid('its artifact list is not JSON'); }
  if (!v || typeof v !== 'object' || !Array.isArray(v.artifacts)) throw invalid('its artifact list has no artifacts field');
  const arts = v.artifacts.map((a) => {
    if (!a || typeof a !== 'object' || typeof a.name !== 'string' || !Number.isSafeInteger(a.size_in_bytes) || a.size_in_bytes < 0) throw invalid('its artifact list has an entry without a name and size');
    return { id: Number.isSafeInteger(a.id) && a.id > 0 ? a.id : null, name: a.name, size: a.size_in_bytes, expired: a.expired === true };
  });
  if (Number.isSafeInteger(v.total_count) && v.total_count > arts.length) throw invalid(`it lists ${v.total_count} artifacts, more than the ${arts.length} whose sizes can be checked`);
  return arts;
}

/**
 * The run list from `gh run list --json`, validated. Only push runs of `branch` are kept: a pull_request run whose
 * head branch has the same name can come from a fork, and its artifacts are someone else's (gh run list has no
 * head-repository field, so same-repository pull requests are left out too). The others come back in `foreign`.
 */
export function parseRunList(text, branch) {
  let v;
  try { v = JSON.parse(text); } catch { throw invalid('gh run list did not return JSON'); }
  if (!Array.isArray(v)) throw invalid('gh run list did not return a list');
  const valid = v.filter((r) => r && typeof r === 'object' && Number.isSafeInteger(r.databaseId) && r.databaseId > 0);
  const ours = (r) => r.event === 'push' && (branch === undefined || r.headBranch === branch);
  const runs = valid.filter(ours).map((r) => ({
    id: r.databaseId,
    sha: typeof r.headSha === 'string' && /^[0-9a-f]{7,64}$/.test(r.headSha) ? r.headSha : null,
    created: typeof r.createdAt === 'string' && !Number.isNaN(Date.parse(r.createdAt)) ? new Date(Date.parse(r.createdAt)).toISOString() : null,
    conclusion: typeof r.conclusion === 'string' ? r.conclusion.slice(0, 40) : ''
  }));
  runs.foreign = valid.filter((r) => !ours(r)).map((r) => r.databaseId);
  return runs;
}

/** The download and case caps, lowered (never raised) by `io.importLimits` (tests only; not reachable from the command line). */
function importLimits(io) {
  const o = (io && io.importLimits) || {};
  const low = (k, d) => (Number.isSafeInteger(o[k]) && o[k] > 0 ? Math.min(o[k], d) : d);
  return {
    artifactBytes: low('artifactBytes', ARTIFACT_MAX_BYTES), totalBytes: low('totalBytes', IMPORT_MAX_BYTES), perRun: low('perRun', ARTIFACTS_PER_RUN),
    artifactCases: low('artifactCases', MAX_CASES), cases: low('cases', IMPORT_MAX_CASES), projectCases: low('projectCases', PROJECT_MAX_CASES)
  };
}

const BRANCH_NAME = /^[^\s\0~^:?*[\\]{1,250}$/;

/** The repository's default branch from `gh repo view <repo>` (one small call), else 'main'. */
function defaultBranch({ cwd, env, repo }) {
  try {
    const r = gh(['repo', 'view', repo.arg, '--json', 'defaultBranchRef'], { cwd, env, repo, maxBuffer: 64 * 1024 });
    const name = r.status === 0 ? JSON.parse(r.stdout)?.defaultBranchRef?.name : null;
    return typeof name === 'string' && !name.startsWith('-') && BRANCH_NAME.test(name) ? name : 'main';
  } catch { return 'main'; }
}

/**
 * `db import-reports`: { branch, repo, runs_listed, imported: [...], skipped: [...], hint?, note? }.
 * Each artifact is stored in its own transaction as soon as it is read (nothing is collected in memory), at most
 * `cases` (IMPORT_MAX_CASES) test cases per call: an artifact past it is skipped (not downloaded once the budget is used
 * up) and a later call imports it. When the index would hold more than PROJECT_MAX_CASES test cases the import stops
 * with a note naming `db prune`.
 * Exit 1: the index is off (names `db init`), no GitHub remote, a secrets file that cannot be read safely, gh missing or
 * not logged in (names `gh auth login`), a bad flag.
 */
export async function importReports(io, { branch, limit = DEFAULT_LIMIT } = {}) {
  const { cwd, env } = ioCtx(io);
  const st = indexState(indexPaths(cwd, env));
  if (!st.enabled) throw invalid(st.problem || 'import-reports stores test runs in the kit index, which is off for this project: run `db init` first');
  let loc;
  if (branch === undefined) {
    const head = await gitHead(cwd, env);
    loc = head.loc;
    const why = !head.repo ? 'not a git repository' : head.unborn ? 'no commits yet' : head.branch === DETACHED ? `HEAD is detached ${DETACHED}` : !head.branch ? 'no branch name' : null;
    if (why) throw invalid(`cannot tell the current git branch (${why}): pass --branch <b>`);
    branch = head.branch;
  } else loc = await locateOrNull(cwd);
  if (!branch || branch.startsWith('-') || !BRANCH_NAME.test(branch)) throw invalid('--branch must be a git branch name');
  const caps = importLimits(io);
  // fails closed before anything is fetched: without its secrets nothing may be stored
  const secrets = projectSecrets(cwd, loc);
  ghProgram(env); // gh missing: say so first
  const repo = await githubRepo(loc, env);

  // gh runs in a private temp folder with the repository named (-R, GH_REPO, explicit API paths): never git in the project
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-import-reports-'));
  try {
    const ghIo = { cwd: dir, env, repo };
    const auth = gh(['auth', 'status'], ghIo);
    // gh's own message is not echoed (it can name hosts and accounts); the exit status is enough to say what to do
    if (auth.status !== 0) throw invalid(`gh is not logged in (gh auth status exited ${auth.status}): run \`gh auth login\``);

    // push runs only (this repository's own branch): see parseRunList
    const list = gh(['run', 'list', '-R', repo.arg, '--branch', branch, '--event', 'push', '--workflow', 'test.yml', '--limit', String(limit), '--json', 'databaseId,headSha,createdAt,conclusion,event,headBranch'], ghIo);
    if (list.status !== 0) throw invalid(`gh run list failed: ${firstLine(list.stderr, secrets) || `exit ${list.status}`}`);
    const listed = parseRunList(list.stdout, branch);
    const runs = listed.slice(0, limit);
    const skipped = listed.foreign.map((id) => ({ run_id: id, reason: 'not a push run of this repository branch' }));
    const imported = [];
    let note;

    await withIndex({ cwd, env }, async (db) => {
      // every key ever imported, the pruned runs' too (imported_reports), so a prune is never undone by the next import
      const known = new Set(db.all('SELECT run_key FROM test_runs WHERE run_key IS NOT NULL UNION SELECT run_key FROM imported_reports').map((r) => r.run_key));
      let stored = Number(db.get('SELECT COUNT(*) AS n FROM test_cases').n);
      let callCases = 0;
      let spent = 0;
      const projectFull = () => `the index holds ${stored} test cases; at most ${caps.projectCases} are kept per project, so the import stopped: `
        + 'run `db prune --keep <n>` (fewer runs per branch) to make room, then import again';
      for (const r of runs) {
        if (note) break;
        if (!r.conclusion) { skipped.push({ run_id: r.id, reason: 'not finished' }); continue; }
        // ids and sizes first: nothing is downloaded before its size is known to be within the caps
        const listing = gh(['api', `${repo.api}/actions/runs/${r.id}/artifacts?per_page=${ARTIFACTS_PER_PAGE}`], ghIo);
        if (listing.status !== 0) { skipped.push({ run_id: r.id, reason: `cannot list its artifacts: ${firstLine(listing.stderr, secrets) || `exit ${listing.status}`}` }); continue; }
        let arts;
        try { arts = parseArtifactList(listing.stdout); } catch (e) { skipped.push({ run_id: r.id, reason: capBytes(e.message, 200) }); continue; }
        const matching = arts.filter((a) => PATTERN_MATCH.test(a.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        if (!matching.length) { skipped.push({ run_id: r.id, reason: 'no test-results artifact' }); continue; }
        let taken = 0;
        for (const a of matching) {
          if (!ARTIFACT_NAME.test(a.name)) { skipped.push({ run_id: r.id, reason: 'an artifact name that is not test-results-<name>: not downloaded' }); continue; }
          const at = { run_id: r.id, artifact: a.name };
          const key = `${r.id}/${a.name}`;
          if (known.has(key)) { skipped.push({ ...at, reason: 'already imported' }); continue; }
          if (a.expired) { skipped.push({ ...at, reason: 'expired' }); continue; }
          if (a.id === null) { skipped.push({ ...at, reason: 'the artifact list gives no id for it: not downloaded' }); continue; }
          if (a.size > caps.artifactBytes) { skipped.push({ ...at, reason: `artifact is ${a.size} bytes, more than ${caps.artifactBytes}: not downloaded` }); continue; }
          if (taken >= caps.perRun) { skipped.push({ ...at, reason: `more than ${caps.perRun} test-results artifacts in this run: not downloaded` }); continue; }
          const room = Math.min(caps.artifactBytes, caps.totalBytes - spent);
          if (a.size > room || room <= 0) { skipped.push({ ...at, reason: `the download budget of one import (${caps.totalBytes} bytes) is used up: not downloaded` }); continue; }
          if (callCases >= caps.cases) { skipped.push({ ...at, reason: `the case budget of one import (${caps.cases} test cases) is used up: not downloaded (a later import takes it)` }); continue; }
          if (stored >= caps.projectCases) { note = projectFull(); skipped.push({ ...at, reason: 'not downloaded: the index holds its most test cases per project (see note)' }); break; }
          taken++;
          const file = path.join(dir, `${a.id}.zip`);
          const dl = await downloadArtifact(a.id, file, room, ghIo);
          spent += dl.bytes;
          let cases;
          try {
            if (dl.over) { skipped.push({ ...at, reason: `download passed ${room} bytes (the artifact list said ${a.size}): stopped, not read` }); continue; }
            if (dl.status !== 0) { skipped.push({ ...at, reason: `download failed: ${firstLine(dl.stderr, secrets) || `exit ${dl.status}`}` }); continue; }
            const z = readDownload(file, room);
            if (z.error) { skipped.push({ ...at, reason: `download ${z.error}` }); continue; }
            const j = readJunitFromZip(z.buf);
            if (j.missing || j.error) { skipped.push({ ...at, reason: j.missing ? `no ${JUNIT_ENTRY}` : capBytes(j.error, 200) }); continue; }
            try { cases = cleanCases(parseJunit(j.text, { maxCases: caps.artifactCases }).cases, secrets); } catch (err) { skipped.push({ ...at, reason: capBytes(err.message, 200) }); continue; }
          } finally { fs.rmSync(file, { force: true }); }
          if (callCases + cases.length > caps.cases) { skipped.push({ ...at, reason: `${cases.length} test cases would take this import past its case budget (${caps.cases}): not stored (a later import takes it)` }); continue; }
          if (stored + cases.length > caps.projectCases) { note = projectFull(); skipped.push({ ...at, reason: `${cases.length} test cases would take the index past its most per project (see note): not stored` }); break; }
          // stored now, in its own transaction: nothing is kept in memory for later, and the index is locked only briefly
          const failed = cases.filter((c) => c.status === 'fail').length;
          const id = inTransaction(db, () => {
            if (db.get('SELECT run_key FROM test_runs WHERE run_key = ? UNION SELECT run_key FROM imported_reports WHERE run_key = ?', key, key)) return null;
            return insertRun(db, {
              branch, commit: r.sha, source: `ci:${a.name}`, started_at: r.created || new Date(0).toISOString(), finished_at: null,
              status: failed ? 'failed' : 'passed', run_key: key, data: { workflow_run_id: r.id, artifact: a.name, conclusion: r.conclusion }
            }, cases);
          });
          known.add(key);
          if (id === null) { skipped.push({ ...at, reason: 'already imported' }); continue; }
          imported.push({ run_id: r.id, artifact: a.name, test_run: id, cases: cases.length, failed });
          callCases += cases.length;
          stored += cases.length;
        }
      }
    }, { transaction: false });

    let hint;
    if (!runs.length) {
      // CI keeps test results only for push runs, which the workflow runs on the default branch
      const def = defaultBranch(ghIo);
      hint = def !== branch
        ? `no push runs of test.yml on ${branch}: CI test results come from push runs, which run on ${def}; try --branch ${def}`
        : `no push runs of test.yml on ${branch} yet`;
    }
    return { branch, repo: repo.arg, runs_listed: runs.length, imported, skipped, ...(hint ? { hint } : {}), ...(note ? { note } : {}) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
