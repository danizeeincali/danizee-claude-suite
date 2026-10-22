/**
 * doctor — a fast, local preflight before expensive work. Each check reports what it found and how to fix it.
 *
 *   doctor [--profile <kit|marathon|bbs|review>] [--config <file>]
 *
 * WHAT IT DOES. Runs the named checks of a profile and reports, for each, `{ name, ok, fatal, found, fix }`: a pass flag,
 * whether a failure blocks the run, a plain sentence saying what was found, and (on failure) what to install or create.
 * Built-in profiles (each one includes the checks of `kit`):
 *   kit       node >= 20, git on PATH, .claude/helpers/kit/cli.js present
 *   marathon  kit + .claude/helpers/marathon/cli.js, .claude/marathon.json readable and valid JSON, a git work tree,
 *             and (advisory) the claude CLI on PATH
 *   bbs       kit + the bbs helpers (.claude/helpers/bbs/cli.js)
 *   review    kit + (advisory) gh on PATH, presence only; (advisory) gh-auth: GH_TOKEN or GITHUB_TOKEN set, or gh's hosts.yml
 *             (GH_CONFIG_DIR, else XDG_CONFIG_HOME/gh, else ~/.config/gh) lists a host with a user
 * A project adds checks in `.claude/kit/doctor.json` (or the file given by --config). Targets of the default
 * doctor.json are relative to the project root; targets of a --config file are relative to the directory of that file:
 *   { "checks": [ { "name": "...", "kind": "file"|"bin"|"json"|"env", "target": "...", "fatal": true|false } ] }
 * `fatal` defaults to false. An env check only tests that the variable is set and non-empty; its value is never printed.
 *
 * WHAT IT NEVER DOES. It makes no network call (no `gh auth status`: a binary is only looked up on PATH), spawns no
 * process (PATH entries are searched directly; node's version is process.version) and changes nothing on disk.
 * Output order is deterministic: the profile's checks in their fixed order, then the project's checks in file order.
 *
 * Exit codes: 0 no fatal failure (advisory failures are listed in `warnings`), 1 invalid input (unknown profile or flag,
 * invalid or missing config), 2 refused: a fatal prerequisite is missing (every failing check is listed).
 * Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'doctor';
export const usage = 'cli.js doctor [--profile <kit|marathon|bbs|review>] [--config <file>]   '
  + '(local preflight: node version, binaries on PATH, helper files, valid JSON; each check reports name/ok/fatal/found/fix; '
  + 'project checks in .claude/kit/doctor.json, whose file/json/bin targets are relative to the project root '
  + '(targets of a --config file are relative to the directory of that file; a failing path check names the directory it searched); no network, no spawned process, env values never printed; '
  + 'exit 0 ok (advisory failures are warnings), 1 invalid input or config, 2 a fatal prerequisite is missing)';

export const PROFILES = Object.freeze(['kit', 'marathon', 'bbs', 'review']);
export const KINDS = Object.freeze(['file', 'bin', 'json', 'env']);
export const DEFAULT_CONFIG = '.claude/kit/doctor.json';
export const MIN_NODE_MAJOR = 20;
const invalid = (m) => new KitExit(m, 1);

/** Directory-walk for a git work tree marker (a `.git` folder or file) from `cwd` upward. No process is spawned. */
async function inGitWorkTree(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    try { await fs.stat(path.join(dir, '.git')); return true; } catch { /* keep walking */ }
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

/**
 * The project root: the nearest ancestor of `cwd` (itself included) holding .claude/helpers/kit/cli.js or .git (one upward
 * walk, so a nested repo without the kit does not inherit an outer project's kit), else `cwd`. Built-in file/json checks and the default config are resolved against it, so running
 * doctor from a subfolder gives the same verdict as running it at the top.
 */
export async function findProjectRoot(cwd) {
  const start = path.resolve(cwd);
  let dir = start;
  for (;;) {
    for (const marker of [path.join('.claude', 'helpers', 'kit', 'cli.js'), '.git']) {
      try { await fs.stat(path.join(dir, marker)); return dir; } catch { /* keep walking */ }
    }
    const up = path.dirname(dir);
    if (up === dir) return start;
    dir = up;
  }
}

const stripBom = (t) => (t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t);

/** Is `name` an executable file in one of the PATH entries of `env`? Searched directly, never through a shell. */
export async function findOnPath(name, env = {}) {
  const pathVar = env.PATH ?? env.Path ?? '';
  const win = process.platform === 'win32';
  const exts = win ? ['', ...String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)] : [''];
  for (const entry of String(pathVar).split(path.delimiter)) {
    if (!entry) continue;
    for (const ext of exts) {
      const full = path.join(entry, name + ext);
      try {
        if (!(await fs.stat(full)).isFile()) continue;
        if (!win) await fs.access(full, fs.constants ? fs.constants.X_OK : 1);
        return full;
      } catch { /* not here */ }
    }
  }
  return null;
}

const row = (name, fatal, ok, found, fix) => ({ name, ok, fatal, found, fix: ok ? '' : fix });

// ================================================================ the checks (each returns one row)

export function checkNode(version, fatal = true) {
  const m = /^v?(\d+)\.(\d+)/.exec(String(version));
  const major = m ? Number(m[1]) : NaN;
  const ok = major >= MIN_NODE_MAJOR;
  return row('node-version', fatal, ok, `node ${version}`, `Install node ${MIN_NODE_MAJOR} or newer (found ${version}).`);
}

/** A target holding a path separator is a path: it is tested directly (relative ones against `cwd`), not searched on PATH. */
async function executableAt(p) {
  try {
    if (!(await fs.stat(p)).isFile()) return false;
    if (process.platform !== 'win32') await fs.access(p, fs.constants ? fs.constants.X_OK : 1);
    return true;
  } catch { return false; }
}

export async function checkBin(bin, { env, fatal, cwd = process.cwd(), name = `bin:${bin}`, fix }) {
  if (/[\\/]/.test(bin)) {
    const ok = await executableAt(path.resolve(cwd, bin));
    return row(name, fatal, ok, ok ? `${bin} is an executable file` : `${bin} is not an executable file (looked in ${path.resolve(cwd)})`, fix || `Install ${bin} or fix its path.`);
  }
  const at = await findOnPath(bin, env);
  return row(name, fatal, !!at, at ? `${bin} found on PATH` : `${bin} not found on PATH`, fix || `Install ${bin} and make sure it is on PATH.`);
}

export async function checkFile(rel, { cwd, fatal, name = `file:${rel}`, fix }) {
  const dir = path.resolve(cwd);
  let st = null;
  try { st = await fs.stat(path.resolve(dir, rel)); } catch { /* not there */ }
  if (st && st.isFile()) return row(name, fatal, true, `${rel} present`, '');
  if (st) return row(name, fatal, false, `${rel} is a directory, not a file (in ${dir})`, fix || `Replace ${rel} with a file.`);
  return row(name, fatal, false, `${rel} not found (looked in ${dir})`, fix || `Create ${rel}.`);
}

export async function checkJson(rel, { cwd, fatal, name = `json:${rel}`, fix }) {
  const dir = path.resolve(cwd);
  let text;
  try { text = await fs.readFile(path.resolve(dir, rel), 'utf-8'); } catch {
    return row(name, fatal, false, `${rel} missing or unreadable (looked in ${dir})`, fix || `Create ${rel} as valid JSON.`);
  }
  try { JSON.parse(stripBom(text)); } catch (e) {
    // never quote e.message: it can echo the text around the error (a secret in a credentials file)
    const at = /\(line \d+ column \d+\)|position \d+/.exec(String(e.message));
    return row(name, fatal, false, `${rel} is not valid JSON${at ? ` (${at[0].replace(/^\((.*)\)$/, '$1')})` : ''}`, fix || `Fix the JSON syntax in ${rel}.`);
  }
  return row(name, fatal, true, `${rel} readable and valid JSON`, '');
}

export function checkEnv(variable, { env, fatal, name = `env:${variable}`, fix }) {
  const ok = typeof env[variable] === 'string' && env[variable] !== '';
  return row(name, fatal, ok, ok ? `${variable} is set` : `${variable} is not set`, fix || `Set the ${variable} environment variable.`);
}

/** Advisory gh login state, read from the environment and gh's hosts.yml only: nothing is spawned, no network, no value printed. */
export async function checkGhAuth(env = {}) {
  const fix = 'Optional: log in with gh auth login, or set GH_TOKEN, so pull requests can be read.';
  for (const v of ['GH_TOKEN', 'GITHUB_TOKEN']) {
    if (typeof env[v] === 'string' && env[v] !== '') return row('gh-auth', false, true, `${v} is set`, '');
  }
  const home = env.HOME || env.USERPROFILE;
  const dirs = env.GH_CONFIG_DIR ? [env.GH_CONFIG_DIR]
    : env.XDG_CONFIG_HOME ? [path.join(env.XDG_CONFIG_HOME, 'gh')]
    : home ? [path.join(home, '.config', 'gh')] : [];
  for (const d of dirs) {
    let text;
    try { text = await fs.readFile(path.join(d, 'hosts.yml'), 'utf-8'); } catch { continue; }
    let inHost = false;
    for (const line of stripBom(text).split(/\r?\n/)) {
      if (/^[^\s#][^:]*:\s*(#.*)?$/.test(line)) inHost = true;
      else if (/^\S/.test(line)) inHost = false;
      else if (inHost && /^\s+user:\s*\S/.test(line)) return row('gh-auth', false, true, 'gh hosts.yml lists a logged-in user', '');
    }
  }
  return row('gh-auth', false, false, 'no gh login found (no GH_TOKEN/GITHUB_TOKEN, no user in gh hosts.yml)', fix);
}

async function checkGitTree(cwd, fatal) {
  const ok = await inGitWorkTree(cwd);
  return row('git-work-tree', fatal, ok, ok ? 'inside a git work tree' : 'not inside a git work tree', 'Run inside a git repository (git init, or cd into the project).');
}

// ================================================================ profiles

export async function profileChecks(profile, { cwd, env, nodeVersion }) {
  cwd = await findProjectRoot(cwd);
  if (!PROFILES.includes(profile)) throw invalid(`unknown profile "${profile}" — known: ${PROFILES.join(', ')}`);
  const f = (rel, fix) => checkFile(rel, { cwd, fatal: true, name: `file:${rel}`, fix });
  const rows = [
    checkNode(nodeVersion),
    await checkBin('git', { env, cwd, fatal: true, fix: 'Install git and make sure it is on PATH.' }),
    await f('.claude/helpers/kit/cli.js', 'Install the suite in this project: run npx github:danizeeincali/danizee-claude-suite init (or update for an existing install).')
  ];
  if (profile === 'marathon') {
    rows.push(
      await f('.claude/helpers/marathon/cli.js', 'Install the suite in this project: run npx github:danizeeincali/danizee-claude-suite init (or update for an existing install).'),
      await checkJson('.claude/marathon.json', { cwd, fatal: true, fix: 'Create .claude/marathon.json as valid JSON (see /w-marathon).' }),
      await checkGitTree(cwd, true),
      await checkBin('claude', { env, fatal: false, fix: 'Optional: install the claude CLI to run background agents.' })
    );
  } else if (profile === 'bbs') {
    rows.push(await f('.claude/helpers/bbs/cli.js', 'Install the suite in this project: run npx github:danizeeincali/danizee-claude-suite init (or update for an existing install).'));
  } else if (profile === 'review') {
    rows.push(
      await checkBin('gh', { env, fatal: false, fix: 'Optional: install the GitHub CLI (gh) to read pull requests.' }),
      await checkGhAuth(env)
    );
  }
  return rows;
}

// ================================================================ project config

/** Every built-in check name of every profile: a project check may not reuse one, so a config valid under one profile is valid under all. */
export const BUILTIN_NAMES = Object.freeze(['node-version', 'bin:git', 'file:.claude/helpers/kit/cli.js',
  'file:.claude/helpers/marathon/cli.js', 'json:.claude/marathon.json', 'git-work-tree', 'bin:claude',
  'file:.claude/helpers/bbs/cli.js', 'bin:gh', 'gh-auth']);

/** Validate a parsed config; returns the list of checks or throws KitExit 1. */
export function parseConfig(cfg, where = 'config') {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw invalid(`${where}: must be an object with a "checks" array`);
  const list = cfg.checks ?? [];
  if (!Array.isArray(list)) throw invalid(`${where}: "checks" must be an array`);
  const seen = new Set();
  return list.map((c, i) => {
    const at = `${where}: checks[${i}]`;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw invalid(`${at} must be an object`);
    if (typeof c.name !== 'string' || !c.name.trim()) throw invalid(`${at}.name must be a non-empty string`);
    if (!KINDS.includes(c.kind)) throw invalid(`${at}.kind must be one of ${KINDS.join(', ')}`);
    if (typeof c.target !== 'string' || !c.target.trim()) throw invalid(`${at}.target must be a non-empty string`);
    if (c.fatal !== undefined && typeof c.fatal !== 'boolean') throw invalid(`${at}.fatal must be true or false`);
    if (BUILTIN_NAMES.includes(c.name)) throw invalid(`${at}.name "${c.name}" collides with a built-in check`);
    if (seen.has(c.name)) throw invalid(`${at}.name "${c.name}" is used twice`);
    seen.add(c.name);
    return { name: c.name, kind: c.kind, target: c.target, fatal: c.fatal === true };
  });
}

/** Returns `{ checks, base }`: `base` is the directory the targets resolve against (the project root for the default
 *  doctor.json, the directory of the config file for --config). */
async function loadConfig(cwd, root, configArg) {
  const explicit = configArg !== undefined;
  const file = path.resolve(explicit ? cwd : root, explicit ? configArg : DEFAULT_CONFIG);
  const base = explicit ? path.dirname(file) : root;
  let text;
  try { text = await fs.readFile(file, 'utf-8'); } catch (e) {
    if (!explicit && e.code === 'ENOENT') return { checks: [], base };
    throw invalid(`cannot read config ${explicit ? configArg : DEFAULT_CONFIG}: ${e.code || e.message}`);
  }
  let parsed;
  try { parsed = JSON.parse(stripBom(text)); } catch { throw invalid(`config ${explicit ? configArg : DEFAULT_CONFIG} is not valid JSON`); }
  return { checks: parseConfig(parsed, explicit ? configArg : DEFAULT_CONFIG), base };
}

/** The project's own checks from the default .claude/kit/doctor.json, as `{ checks, base }` (what the doctor verb loads). */
export async function loadProjectChecks(cwd) {
  return loadConfig(cwd, await findProjectRoot(cwd));
}

export async function customCheck(c, { cwd, env, base }) {
  const opts = { cwd: base ?? await findProjectRoot(cwd), env, fatal: c.fatal, name: c.name };
  if (c.kind === 'file') return checkFile(c.target, opts);
  if (c.kind === 'json') return checkJson(c.target, opts);
  if (c.kind === 'bin') return checkBin(c.target, opts);
  return checkEnv(c.target, opts);
}

// ================================================================ the library entry

/**
 * Run a profile plus any project checks. `{ cwd, env, nodeVersion }` are injectable (tests pass a temp dir, a controlled
 * PATH/env and a version). Returns `{ profile, ok, exit, checks, failed, warnings }`.
 */
export async function runDoctor({ profile = 'kit', cwd, env = {}, nodeVersion = process.version, custom = [], customBase } = {}) {
  const checks = await profileChecks(profile, { cwd, env, nodeVersion });
  const names = new Set(checks.map((c) => c.name));
  for (const c of custom) {
    if (names.has(c.name)) throw invalid(`project check name "${c.name}" collides with a built-in check`);
    names.add(c.name);
    checks.push(await customCheck(c, { cwd, env, base: customBase }));
  }
  const failed = checks.filter((c) => !c.ok && c.fatal).map((c) => c.name);
  const warnings = checks.filter((c) => !c.ok && !c.fatal).map((c) => c.name);
  return { profile, ok: failed.length === 0, exit: failed.length ? 2 : 0, checks, failed, warnings };
}

function parse(args) {
  const out = { profile: 'kit', config: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--profile' || a === '--config') {
      const v = args[++i];
      if (v === undefined || v.startsWith('--')) throw invalid(`${a} needs a value`);
      out[a.slice(2)] = v;
    } else throw invalid(`unknown argument "${a}"`);
  }
  return out;
}

export async function run(args, io) {
  const { profile, config } = parse(args);
  if (!PROFILES.includes(profile)) throw invalid(`unknown profile "${profile}" — known: ${PROFILES.join(', ')}`);
  const { checks, base } = await loadConfig(io.cwd, await findProjectRoot(io.cwd), config);
  return runDoctor({ profile, cwd: io.cwd, env: io.env || {}, custom: checks, customBase: base });
}
