/**
 * safe-git — read a repository you did not write without letting its config run code.
 *
 *   safe-git --dir <path> -- <git args...>      prints { stdout, stderr, code }
 *
 * Git can execute programs named by a repository: hooks, clean/smudge/process filters, the file system monitor,
 * external diff and text conversion drivers, submodule updates. Every call made through `safeGit`:
 *   - runs with every inherited GIT_* variable removed (an outer shell cannot aim git at another repository),
 *     no system or global config, no prompts, no lazy object fetches, no optional locks, no lfs smudge;
 *   - gets `-c` overrides (see `safeGitConfig`) that switch off hooks, fsmonitor, submodule recursion, every
 *     transport, the external diff, and every filter driver the folder's own config or any .gitattributes names;
 *   - has a closed stdin unless input is given;
 *   - for diff-producing subcommands gets `--no-ext-diff --no-textconv`.
 * A filter driver name that cannot be switched off safely makes the call refuse (KitExit 2); it is never skipped.
 *
 * READ-ONLY ALLOW-LIST (first argument must be exactly one of these; global options such as -c, -C, --git-dir,
 * --exec-path cannot be passed): rev-parse rev-list log show diff diff-tree diff-index diff-files ls-files ls-tree
 * cat-file status show-ref for-each-ref merge-base name-rev describe. Everything else (fetch, pull, push, clone,
 * submodule, checkout, config, blame, grep, archive, ...) is refused. Options that re-enable what the wrapper
 * switches off (--ext-diff, --textconv, --output, -O/--open-files-in-pager, --no-index, --show-signature, %G
 * placeholders) are refused too.
 *
 * Overrides are cached per real path of the folder, keyed by the stat of its config; a changed .gitattributes
 * needs `{ fresh: true }` (or clearSafeGitCache()) to be re-read.
 * Built from ideas audited by /w-bbs (run 2026-10-10-openqodex-2); no foreign code.
 */
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { KitExit } from './kit-exit.js';
import { gitPaths } from './git-paths.js';

export const verb = 'safe-git';
export const usage = 'cli.js safe-git [--dir <path>] -- <git args...>   (read-only git on an untrusted repo; prints { stdout, stderr, code })';

export const READ_SUBCOMMANDS = Object.freeze([
  'rev-parse', 'rev-list', 'log', 'show', 'diff', 'diff-tree', 'diff-index', 'diff-files', 'ls-files', 'ls-tree',
  'cat-file', 'status', 'show-ref', 'for-each-ref', 'merge-base', 'name-rev', 'describe'
]);
const DIFFING = new Set(['log', 'show', 'diff', 'diff-tree', 'diff-index', 'diff-files']);
const DRIVER_NAME = /^[A-Za-z0-9._-]+$/;
const MAX_DIRS = 20000;
const MAX_ATTR_BYTES = 4 * 1024 * 1024;

const refuse = (msg) => new KitExit(msg, 2);

// ---------------------------------------------------------------- env

let emptyConfigFile = null;
function nullConfigPath() {
  if (process.platform !== 'win32') return '/dev/null';
  if (!emptyConfigFile) {
    emptyConfigFile = path.join(fsSync.mkdtempSync(path.join(os.tmpdir(), 'safe-git-')), 'empty.gitconfig');
    fsSync.writeFileSync(emptyConfigFile, '');
  }
  return emptyConfigFile;
}

/** baseEnv without any GIT_* variable, plus the hardening variables. Never mutates baseEnv. */
export function safeGitEnv(baseEnv = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(baseEnv || {})) if (!/^GIT_/i.test(k) && v !== undefined) out[k] = v;
  out.GIT_CONFIG_NOSYSTEM = '1';
  out.GIT_CONFIG_GLOBAL = nullConfigPath();
  out.GIT_TERMINAL_PROMPT = '0';
  out.GIT_NO_LAZY_FETCH = '1';
  out.GIT_OPTIONAL_LOCKS = '0';
  out.GIT_LFS_SKIP_SMUDGE = '1';
  return out;
}

// ---------------------------------------------------------------- git runner

/** Default runner: `git(args, { cwd, env, input, timeout })` → { code, stdout, stderr }. stdin is closed without input. */
export function defaultGitRunner(args, { cwd, env, input, timeout } = {}) {
  const hasInput = input !== undefined && input !== null;
  const r = spawnSync('git', args, {
    cwd, env, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, timeout,
    input: hasInput ? input : undefined,
    stdio: [hasInput ? 'pipe' : 'ignore', 'pipe', 'pipe']
  });
  if (r.error) throw new KitExit(`cannot run git: ${r.error.message}`, 1);
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ---------------------------------------------------------------- driver discovery

/** Filter driver names from `git config -z --get-regexp` output ("key\nvalue\0"...). */
export function driversFromConfig(stdout) {
  const names = new Set();
  for (const rec of String(stdout || '').split('\0')) {
    if (!rec) continue;
    const key = rec.split('\n')[0];
    const m = /^filter\.(.+)\.[^.]+$/i.exec(key);
    if (m) names.add(m[1]);
  }
  return names;
}

/** Filter driver names used by the text of one .gitattributes-style file. */
export function driversFromAttributes(text) {
  const names = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    for (const tok of line.split(/\s+/)) {
      const m = /^filter=(.*)$/.exec(tok);
      if (m && m[1] !== '') names.add(m[1]);
    }
  }
  return names;
}

async function readCapped(file) {
  let st;
  try { st = await fs.stat(file); } catch { return ''; }
  if (!st.isFile()) return '';
  if (st.size > MAX_ATTR_BYTES) throw refuse(`${file} is larger than ${MAX_ATTR_BYTES} bytes; its filter drivers cannot be checked`);
  return fs.readFile(file, 'utf-8');
}

async function attributeFiles(top, gitDir, extra) {
  const files = [path.join(gitDir, 'info', 'attributes'), ...extra];
  if (!top) return files;
  const queue = [top];
  let seen = 0;
  while (queue.length) {
    const d = queue.pop();
    if (++seen > MAX_DIRS) throw refuse(`more than ${MAX_DIRS} folders under ${top}; its .gitattributes files cannot all be checked`);
    let ents;
    try { ents = await fs.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.name === '.git') continue;
      if (e.isDirectory()) queue.push(path.join(d, e.name));
      else if (e.name === '.gitattributes') files.push(path.join(d, e.name));
    }
  }
  return files;
}

// ---------------------------------------------------------------- overrides

const cache = new Map();
export function clearSafeGitCache() { cache.clear(); }

const STATIC_OVERRIDES = [
  'core.hooksPath=/dev/null', 'core.fsmonitor=false', 'submodule.recurse=false', 'protocol.allow=never',
  'diff.external=', 'log.showSignature=false', 'credential.helper='
];

async function fingerprint(gitDir) {
  const parts = [];
  for (const f of [path.join(gitDir, 'config'), path.join(gitDir, 'info', 'attributes')]) {
    try { const s = await fs.stat(f); parts.push(`${s.mtimeMs}:${s.size}`); } catch { parts.push('-'); }
  }
  return parts.join('|');
}

/**
 * The `-c` override argv for the folder: static switches plus every filter driver named in its local config
 * (including included files) or in any .gitattributes / info/attributes / core.attributesFile. Throws KitExit 2 for
 * a driver name outside [A-Za-z0-9._-], KitExit 1 when git cannot answer. `git` is the injectable runner.
 */
export async function safeGitConfig(dir, { git = defaultGitRunner, env = process.env, fresh = false } = {}) {
  let real;
  try { real = await fs.realpath(dir); } catch (err) { throw new KitExit(`cannot open ${dir}: ${err.message}`, 1); }
  const genv = safeGitEnv(env);
  const exec = (args) => git(args, { cwd: real, env: genv });
  const [gitDir] = await gitPaths(exec, real, ['gitDir'], `${real} is not a readable git repository`);
  let top = null;
  try { [top] = await gitPaths(exec, real, ['toplevel']); } catch { top = null; /* bare repository */ }

  const fp = await fingerprint(gitDir);
  const hit = cache.get(real);
  if (!fresh && hit && hit.fp === fp) return [...hit.args];

  const cfgOut = await git(['config', '--local', '--includes', '-z', '--get-regexp', '^filter\\.'], { cwd: real, env: genv });
  if (cfgOut.code !== 0 && cfgOut.code !== 1) throw new KitExit(`cannot read the repository config: ${(cfgOut.stderr || '').trim() || 'git failed'}`, 1);
  const names = driversFromConfig(cfgOut.code === 0 ? cfgOut.stdout : '');

  const extra = [];
  const af = await git(['config', '--local', '--includes', '--get', 'core.attributesfile'], { cwd: real, env: genv });
  if (af.code === 0 && af.stdout.trim()) {
    const p = af.stdout.trim();
    extra.push(path.resolve(real, p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p));
  }
  for (const f of await attributeFiles(top, gitDir, extra)) {
    for (const n of driversFromAttributes(await readCapped(f))) names.add(n);
  }

  const args = [];
  for (const o of STATIC_OVERRIDES) args.push('-c', o);
  for (const name of [...names].sort()) {
    if (!DRIVER_NAME.test(name)) throw refuse(`filter driver name ${JSON.stringify(name).slice(0, 80)} cannot be switched off safely; refusing to run git`);
    for (const v of ['clean', 'smudge', 'process']) args.push('-c', `filter.${name}.${v}=`);
    args.push('-c', `filter.${name}.required=false`);
  }
  cache.set(real, { fp, args });
  return [...args];
}

// ---------------------------------------------------------------- the wrapper

/** Validate a read-only git argv; returns it with the diff-hardening flags inserted. Throws KitExit 2. */
export function checkReadArgs(args) {
  if (!Array.isArray(args) || args.length === 0 || args.some(a => typeof a !== 'string' || a.includes('\0'))) {
    throw new KitExit('safe-git needs a git subcommand', 1);
  }
  const [sub, ...rest] = args;
  if (!READ_SUBCOMMANDS.includes(sub)) {
    throw refuse(`git ${sub.startsWith('-') ? 'option ' : ''}${sub} is not on the read-only allow-list (${READ_SUBCOMMANDS.join(', ')})`);
  }
  const dashdash = rest.indexOf('--');
  const opts = dashdash === -1 ? rest : rest.slice(0, dashdash);
  for (const a of opts) {
    if (/^--(ext-diff|textconv|no-index|show-signature|open-files-in-pager|output|exec|upload-pack|receive-pack)(=.*)?$/.test(a)
      || /^-O/.test(a) || /%G/.test(a)) {
      throw refuse(`git option ${a} would re-enable code execution or write a file; refused`);
    }
  }
  return DIFFING.has(sub) ? [sub, '--no-ext-diff', '--no-textconv', ...rest] : [sub, ...rest];
}

/**
 * Run a read-only git command inside `dir` with the hardening described at the top.
 * Returns { stdout, stderr, code }. `git` and `env` are injectable; `input` becomes stdin (closed otherwise).
 */
export async function safeGit(dir, args, { input, git = defaultGitRunner, env = process.env, timeout, fresh = false } = {}) {
  const argv = checkReadArgs(args);
  const overrides = await safeGitConfig(dir, { git, env, fresh });
  const real = await fs.realpath(dir);
  const r = await git([...overrides, ...argv], { cwd: real, env: safeGitEnv(env), input, timeout });
  return { stdout: r.stdout, stderr: r.stderr || '', code: r.code };
}

// ---------------------------------------------------------------- CLI

export async function run(args, io = {}) {
  let dir = io.cwd || process.cwd();
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { i++; break; }
    if (a === '--dir') {
      if (i + 1 >= args.length || args[i + 1] === '--') throw new KitExit('--dir needs a path', 1);
      dir = path.resolve(io.cwd || process.cwd(), args[++i]);
    } else throw new KitExit(`unknown flag ${a} (usage: ${usage})`, 1);
  }
  const gitArgs = args.slice(i);
  if (gitArgs.length === 0) throw new KitExit(`no git command given (usage: ${usage})`, 1);
  return safeGit(dir, gitArgs, { env: io.env || process.env, git: io.git });
}
