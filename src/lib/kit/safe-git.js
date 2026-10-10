/**
 * safe-git — read a repository you did not write without letting its config run code.
 *
 *   safe-git --dir <path> -- <git args...>      prints { stdout, stderr, code }
 *
 * Git runs programs that a repository's config names: hooks, clean/smudge/process filters, textconv and external
 * diff drivers, the file system monitor, gpg.program behind a format.pretty with %G?, a promisor remote's ext::
 * transport, and so on. Switching those keys off one by one (a deny-list) keeps missing one, so git is never allowed
 * to read the untrusted repository's config at all:
 *
 *   SHADOW GIT DIR. Each call builds a fresh private git dir (mkdtemp, mode 0700, removed afterwards) and runs git
 *   with GIT_DIR pointing at it, GIT_OBJECT_DIRECTORY at the repo's real objects (alternates there are object-only)
 *   and GIT_WORK_TREE at the repo's work tree (none for a bare repo or a path inside the git dir). The shadow holds:
 *     - a config WE write, holding only allow-listed keys whose values are validated (core.repositoryformatversion,
 *       extensions.objectformat, core.bare, and the booleans/enums core.ignorecase, precomposeunicode, quotepath,
 *       filemode, symlinks, autocrlf, eol). The repo's config files are read as DATA (`git config --file <f> --list
 *       -z`, run outside any repository); config.worktree only when extensions.worktreeConfig is set; extensions and
 *       the format version only from the repo's own config file (as git does). An extension we do not know
 *       (refstorage=reftable, compatobjectformat, ...) or a format version above 1 is refused (KitExit 2), never
 *       guessed at. extensions.partialclone and worktreeconfig are dropped, so no promisor remote exists;
 *     - HEAD and the per-worktree pseudo refs (ORIG_HEAD, FETCH_HEAD, MERGE_HEAD, ...), refs/ (common dir, overlaid
 *       with the worktree's own refs) and packed-refs, copied at call time — regular files only, symlinks skipped;
 *     - shallow, a copy of the index (and sharedindex.* files), info/exclude and info/attributes (attributes cannot
 *       name a program when no config defines a driver; work-tree .gitattributes stay as they are).
 *   No hooks dir, no config.worktree, no includes, no remotes. Repository discovery is done here on the file system
 *   (.git dir, gitdir: file, commondir file, bare layout), so git never opens the repo with its own config.
 *
 *   DEFENCE IN DEPTH: every inherited GIT_* variable is removed, no system or global config, no prompts,
 *   GIT_NO_LAZY_FETCH, no optional locks, no lfs smudge, closed stdin unless input is given; `-c` overrides switch off
 *   hooks, fsmonitor, the pager, submodule recursion (diff.ignoreSubmodules=all), every transport (protocol.allow and
 *   protocol.<each>.allow=never), the external diff, signatures (log.showSignature=false, gpg.program /
 *   gpg.ssh.program / gpg.x509.program = a path that cannot run, format.pretty=medium), and every filter/diff/merge
 *   driver named in the repo's config (config, config.worktree, included files) or in any attributes file. A driver
 *   name that cannot be switched off safely makes the call refuse (KitExit 2). Diff-producing subcommands get
 *   `--no-ext-diff --no-textconv --ignore-submodules=all`, status gets `--ignore-submodules=all`, and
 *   `describe --dirty/--broken` is answered with submodules ignored (describe's own check starts a git inside each
 *   populated submodule, which would read THAT repository's config).
 *
 * READ-ONLY ALLOW-LIST (first argument must be exactly one of these; global options such as -c, -C, --git-dir,
 * --exec-path cannot be passed): rev-parse rev-list log show diff diff-tree diff-index diff-files ls-files ls-tree
 * cat-file status show-ref for-each-ref merge-base name-rev describe. Everything else (fetch, pull, push, clone,
 * submodule, checkout, config, blame, grep, archive, ...) is refused. Options that re-enable what the wrapper
 * switches off (--ext-diff, --textconv, --filters, --output, -O/--open-files-in-pager, --no-index, --show-signature,
 * --recurse-submodules, --ignore-submodules, --submodule, %G and %(signature) format placeholders) are refused too —
 * and so is ANY long option that is a prefix of one of them (git accepts unambiguous abbreviations such as
 * `cat-file --textc`), with or without `=value`. rev-parse --git-dir / --git-common-dir / --absolute-git-dir /
 * --git-path / --shared-index-path are refused: they would print the private shadow dir.
 *
 * Nothing is cached: every call re-reads the config and copies refs and index, so a changed repo is always seen.
 * Not reproduced in the shadow: reflogs (`@{n}`), core.worktree, other worktrees' HEADs, in-progress
 * rebase/bisect state, and submodule changes (ignored).
 * Built from ideas audited by /w-bbs (run 2026-10-10-openqodex-2); no foreign code.
 */
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { KitExit } from './kit-exit.js';

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
const MAX_SMALL_FILE = 64 * 1024;
const INTERNAL_TIMEOUT = 60000;

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

// ---------------------------------------------------------------- small fs helpers

const lstatOrNull = (p) => fs.lstat(p).catch(() => null);
const statOrNull = (p) => fs.stat(p).catch(() => null);
const isRegular = async (p) => !!(await lstatOrNull(p))?.isFile();
const isDir = async (p) => !!(await statOrNull(p))?.isDirectory();

async function readSmall(file) {
  const st = await lstatOrNull(file);
  if (!st || !st.isFile()) return null;
  if (st.size > MAX_SMALL_FILE) throw new KitExit(`${file} is larger than ${MAX_SMALL_FILE} bytes; not a git control file`, 1);
  return fs.readFile(file, 'utf-8');
}

// ---------------------------------------------------------------- repository discovery (no git involved)

/** git's own test for a git dir: a HEAD, plus objects/ and refs/ (or a commondir file, for a linked worktree). */
async function looksLikeGitDir(d) {
  const head = await lstatOrNull(path.join(d, 'HEAD'));
  if (!head || !(head.isFile() || head.isSymbolicLink())) return false;
  if (await isRegular(path.join(d, 'commondir'))) return true;
  return (await isDir(path.join(d, 'objects'))) && (await isDir(path.join(d, 'refs')));
}

/**
 * Find the repository for `dir` the way git does, on the file system only: walking up, a `.git` dir or `gitdir:` file
 * wins, else a folder that is itself a git dir (bare repo, or a path inside .git: no work tree). Returns real paths
 * { real, gitDir, commonDir, top } (top is null without a work tree). KitExit 1 when there is none.
 */
export async function locateRepo(dir) {
  let real;
  try { real = await fs.realpath(dir); } catch (err) { throw new KitExit(`cannot open ${dir}: ${err.message}`, 1); }
  if (!(await isDir(real))) throw new KitExit(`${real} is not a readable git repository (not a folder)`, 1);
  for (let d = real; ;) {
    const dotgit = path.join(d, '.git');
    const st = await statOrNull(dotgit);
    if (st?.isDirectory() && await looksLikeGitDir(dotgit)) return finishLocate(real, dotgit, d);
    if (st?.isFile()) {
      const text = await readSmall(dotgit);
      const m = /^gitdir: (.+?)\s*$/m.exec(text || '');
      const target = m ? path.resolve(d, m[1]) : null;
      if (!target || !(await looksLikeGitDir(target))) throw new KitExit(`${real} is not a readable git repository (invalid gitfile ${dotgit})`, 1);
      return finishLocate(real, target, d);
    }
    if (await looksLikeGitDir(d)) return finishLocate(real, d, null);
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  throw new KitExit(`${real} is not a readable git repository (no .git in it or above it)`, 1);
}

async function finishLocate(real, gitDirIn, topIn) {
  const gitDir = await fs.realpath(gitDirIn);
  const cd = await readSmall(path.join(gitDir, 'commondir'));
  const commonDir = cd ? await fs.realpath(path.resolve(gitDir, cd.trim())).catch(() => null) : gitDir;
  if (!commonDir || !(await isDir(path.join(commonDir, 'objects')))) throw new KitExit(`${real} is not a readable git repository (no objects folder)`, 1);
  return { real, gitDir, commonDir, top: topIn ? await fs.realpath(topIn) : null };
}

// ---------------------------------------------------------------- config as data

/** `git config --list -z` output → [[key, value|null], ...] (null = key without "=", git's implicit true). */
export function parseConfigList(stdout) {
  const out = [];
  for (const rec of String(stdout || '').split('\0')) {
    if (!rec) continue;
    const nl = rec.indexOf('\n');
    out.push(nl === -1 ? [rec, null] : [rec.slice(0, nl), rec.slice(nl + 1)]);
  }
  return out;
}

/** Read one config FILE as data. git runs in an empty scratch dir below a ceiling, so it opens no repository. */
async function readConfigFile(ctx, file, includes) {
  if (!(await isRegular(file))) return [];
  const r = await ctx.git(['config', '--file', file, includes ? '--includes' : '--no-includes', '--list', '-z'],
    { cwd: ctx.scratch, env: ctx.cfgEnv, timeout: ctx.timeout });
  if (r.code !== 0) throw new KitExit(`cannot read ${file} as data: ${(r.stderr || '').trim() || 'git failed'}`, 1);
  return parseConfigList(r.stdout);
}

function parseBool(v) {
  if (v === null) return true;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(s)) return true;
  if (['false', 'no', 'off', '0', ''].includes(s)) return false;
  return undefined;
}

const KNOWN_EXTENSIONS = new Set(['objectformat', 'refstorage', 'worktreeconfig', 'partialclone', 'preciousobjects', 'noop']);

/**
 * Repository format from the entries of the repo's own config file (no includes, as git reads it). Returns
 * { version, objectFormat, worktreeConfig }. KitExit 2 for a version above 1 or an extension we cannot honour.
 */
export function repoFormat(entries) {
  let version = '0';
  const ext = new Map();
  for (const [k, v] of entries) {
    if (k === 'core.repositoryformatversion') version = v === null ? '' : String(v).trim();
    else if (k.startsWith('extensions.')) ext.set(k.slice('extensions.'.length), v);
  }
  if (!/^[01]$/.test(version)) throw refuse(`core.repositoryformatversion=${JSON.stringify(version).slice(0, 40)} is not supported; refusing to read this repository`);
  let objectFormat = null;
  let worktreeConfig = false;
  for (const [name, v] of ext) {
    if (!KNOWN_EXTENSIONS.has(name)) throw refuse(`repository extension extensions.${name.slice(0, 60)} is not supported; refusing to read this repository`);
    const val = v === null ? '' : String(v).trim().toLowerCase();
    if (name === 'objectformat') {
      if (!['sha1', 'sha256'].includes(val)) throw refuse(`extensions.objectformat=${JSON.stringify(val).slice(0, 40)} is not supported`);
      objectFormat = val;
    } else if (name === 'refstorage') {
      if (val !== 'files') throw refuse(`extensions.refstorage=${JSON.stringify(val).slice(0, 40)}: only the files ref backend can be copied safely; refusing to read this repository`);
    } else if (name === 'worktreeconfig') {
      worktreeConfig = parseBool(v) === true;
    }
  }
  return { version, objectFormat, worktreeConfig };
}

const CORE_BOOL = ['bare', 'ignorecase', 'precomposeunicode', 'quotepath', 'filemode', 'symlinks'];
const CORE_ENUM = { autocrlf: ['true', 'false', 'input'], eol: ['lf', 'crlf', 'native'] };
const AUTOCRLF_ALIASES = { yes: 'true', on: 'true', 1: 'true', no: 'false', off: 'false', 0: 'false' };

/** Allow-listed core.* values (validated) from the effective entries, later entries winning. */
export function allowedCore(entries) {
  const core = {};
  for (const [k, v] of entries) {
    if (!k.startsWith('core.')) continue;
    const name = k.slice(5);
    if (CORE_BOOL.includes(name)) {
      const b = parseBool(v);
      if (b !== undefined) core[name] = b;
    } else if (CORE_ENUM[name]) {
      const s = v === null ? 'true' : String(v).trim().toLowerCase();
      const norm = name === 'autocrlf' ? (AUTOCRLF_ALIASES[s] || s) : s;
      if (CORE_ENUM[name].includes(norm)) core[name] = norm;
    }
  }
  return core;
}

/** The text of the shadow config. Every value is one we validated; nothing is copied verbatim. */
export function shadowConfigText(fmt, core, bare) {
  const lines = ['[core]', `\trepositoryformatversion = ${fmt.version}`, `\tbare = ${bare}`];
  for (const k of [...CORE_BOOL.filter(k => k !== 'bare'), ...Object.keys(CORE_ENUM)]) {
    if (core[k] !== undefined) lines.push(`\t${k} = ${core[k]}`);
  }
  if (fmt.objectFormat) lines.push('[extensions]', `\tobjectformat = ${fmt.objectFormat}`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- driver discovery (defence in depth)

/** Driver names (filter/diff/merge subsections) from `git config -z --get-regexp|--list` output ("key\nvalue\0"...). */
export function driversFromConfig(stdout) {
  return driversFromKeys(parseConfigList(stdout).map(([k]) => k));
}

function driversFromKeys(keys) {
  const names = new Set();
  for (const key of keys) {
    const m = /^(?:filter|diff|merge)\.(.+)\.[^.]+$/i.exec(key);
    if (m) names.add(m[1]);
  }
  return names;
}

/** Driver names used by filter=/diff=/merge= in the text of one .gitattributes-style file. */
export function driversFromAttributes(text) {
  const names = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    for (const tok of line.split(/\s+/)) {
      const m = /^(?:filter|diff|merge)=(.*)$/.exec(tok);
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

async function attributeFiles(top, gitDirs, extra) {
  const files = [...new Set(gitDirs.map(d => path.join(d, 'info', 'attributes'))), ...extra];
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

/** Kept for API compatibility: there is no cache any more (every call re-reads everything). */
export function clearSafeGitCache() {}

const NO_PROGRAM = process.platform === 'win32' ? nullConfigPath() : '/dev/null'; // exists, is not executable
const STATIC_OVERRIDES = [
  'core.hooksPath=/dev/null', 'core.fsmonitor=false', 'core.pager=cat', 'submodule.recurse=false',
  'diff.ignoreSubmodules=all', 'status.submoduleSummary=false',
  'protocol.allow=never', ...['file', 'git', 'ssh', 'http', 'https', 'ext'].map(p => `protocol.${p}.allow=never`),
  'diff.external=', 'log.showSignature=false', 'format.pretty=medium', 'credential.helper=',
  `gpg.program=${NO_PROGRAM}`, `gpg.ssh.program=${NO_PROGRAM}`, `gpg.x509.program=${NO_PROGRAM}`
];

/** Everything we learn about the repo, reading files only. `ctx` = { git, scratch, cfgEnv, timeout }. */
async function inspect(dir, ctx) {
  const loc = await locateRepo(dir);
  const mainCfg = path.join(loc.commonDir, 'config');
  const fmt = repoFormat(await readConfigFile(ctx, mainCfg, false));
  const files = [mainCfg];
  if (fmt.worktreeConfig) files.push(path.join(loc.gitDir, 'config.worktree'));
  const entries = [];
  for (const f of files) entries.push(...await readConfigFile(ctx, f, true));
  const core = allowedCore(entries);
  const top = core.bare === true ? null : loc.top;
  return { loc, fmt, entries, core, top };
}

async function overridesFor(info) {
  const { loc, entries } = info;
  const names = driversFromKeys(entries.map(([k]) => k));
  const extra = [];
  for (const [k, v] of entries) {
    if (k !== 'core.attributesfile' || !v) continue;
    const expanded = v.startsWith('~/') ? path.join(os.homedir(), v.slice(2)) : v;
    // git resolves a relative value against the folder it runs in; scan every plausible base.
    for (const base of [loc.real, loc.top, loc.gitDir, loc.commonDir]) if (base) extra.push(path.resolve(base, expanded));
  }
  for (const f of await attributeFiles(loc.top, [loc.gitDir, loc.commonDir], [...new Set(extra)])) {
    for (const n of driversFromAttributes(await readCapped(f))) names.add(n);
  }
  const args = [];
  for (const o of STATIC_OVERRIDES) args.push('-c', o);
  for (const name of [...names].sort()) {
    if (!DRIVER_NAME.test(name)) throw refuse(`driver name ${JSON.stringify(name).slice(0, 80)} (filter/diff/merge) cannot be switched off safely; refusing to run git`);
    for (const v of ['clean', 'smudge', 'process']) args.push('-c', `filter.${name}.${v}=`);
    args.push('-c', `filter.${name}.required=false`);
    for (const v of ['command', 'textconv']) args.push('-c', `diff.${name}.${v}=`);
    args.push('-c', `merge.${name}.driver=`);
  }
  return args;
}

async function withScratch(fn) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-git-shadow-'));
  try {
    await fs.chmod(scratch, 0o700);
    return await fn(scratch);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

function makeCtx(git, env, scratch, timeout) {
  // git config --file still looks for a repository around its cwd: give it an empty folder and a ceiling above it.
  const cfgEnv = { ...safeGitEnv(env), GIT_CEILING_DIRECTORIES: path.dirname(scratch) };
  return { git, scratch, cfgEnv, timeout: timeout ?? INTERNAL_TIMEOUT };
}

/**
 * The `-c` override argv for the folder (defence in depth; git never reads the repo config through safeGit anyway):
 * static switches plus, for every driver name in its config files (config, config.worktree, included files — read as
 * data) or in any attributes file, empty filter.<n>.{clean,smudge,process}, filter.<n>.required=false, empty
 * diff.<n>.{command,textconv} and merge.<n>.driver. KitExit 2 for a driver name outside [A-Za-z0-9._-] or an
 * unsupported repository format, KitExit 1 when git cannot answer. Computed afresh on every call.
 */
export async function safeGitConfig(dir, { git = defaultGitRunner, env = process.env, timeout } = {}) {
  return withScratch(async (scratch) => overridesFor(await inspect(dir, makeCtx(git, env, scratch, timeout))));
}

// ---------------------------------------------------------------- the shadow git dir

/** Copy a tree of regular files (symlinks and anything else skipped); a missing source is fine. */
async function copyTree(src, dst) {
  let ents;
  try { ents = await fs.readdir(src, { withFileTypes: true }); } catch { return; }
  await fs.mkdir(dst, { recursive: true, mode: 0o700 });
  for (const e of ents) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyTree(s, d);
    else if (e.isFile()) await copyIfRegular(s, d);
  }
}

async function copyIfRegular(src, dst) {
  if (await isRegular(src)) await fs.copyFile(src, dst).catch((err) => { if (err.code !== 'ENOENT') throw err; });
}

/**
 * Copy the index keeping its mtime (rounded DOWN, minus 1µs): git treats an entry whose mtime is not older than the
 * index file as "racily clean" and compares its content. A copy stamped "now" would make a same-size edit made in
 * the same second as the last index write look unchanged.
 */
async function copyIndex(src, dst) {
  const st = await fs.lstat(src, { bigint: true }).catch(() => null);
  if (!st || !st.isFile()) return;
  await copyIfRegular(src, dst);
  const us = (ns) => (Number(ns / 1000n) - 1) / 1e6;
  await fs.utimes(dst, us(st.atimeNs), us(st.mtimeNs)).catch((err) => { if (err.code !== 'ENOENT') throw err; });
}

/** Build the shadow git dir inside `scratch` (see the header) and return its path. */
export async function buildShadow(scratch, info) {
  const { loc, fmt, core, top } = info;
  const sg = path.join(scratch, 'git');
  await fs.mkdir(sg, { mode: 0o700 });
  await fs.writeFile(path.join(sg, 'config'), shadowConfigText(fmt, core, top === null), { mode: 0o600 });

  const headPath = path.join(loc.gitDir, 'HEAD');
  const hst = await lstatOrNull(headPath);
  let head;
  if (hst?.isSymbolicLink()) {
    const target = await fs.readlink(headPath);
    if (!/^refs\/[A-Za-z0-9._/-]+$/.test(target)) throw refuse(`HEAD is a symlink to ${JSON.stringify(target).slice(0, 80)}; refusing to read this repository`);
    head = `ref: ${target}\n`;
  } else {
    head = await readSmall(headPath);
    if (head === null) throw new KitExit(`${loc.real} is not a readable git repository (no HEAD)`, 1);
  }
  await fs.writeFile(path.join(sg, 'HEAD'), head);

  await copyTree(path.join(loc.commonDir, 'refs'), path.join(sg, 'refs'));
  if (loc.gitDir !== loc.commonDir) await copyTree(path.join(loc.gitDir, 'refs'), path.join(sg, 'refs')); // per-worktree refs
  await fs.mkdir(path.join(sg, 'refs', 'heads'), { recursive: true });
  await fs.mkdir(path.join(sg, 'refs', 'tags'), { recursive: true });
  for (const f of ['packed-refs', 'shallow']) await copyIfRegular(path.join(loc.commonDir, f), path.join(sg, f));
  for (const f of ['ORIG_HEAD', 'FETCH_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) await copyIfRegular(path.join(loc.gitDir, f), path.join(sg, f));
  if (top) {
    await copyIndex(path.join(loc.gitDir, 'index'), path.join(sg, 'index'));
    let ents = [];
    try { ents = await fs.readdir(loc.gitDir); } catch { /* none */ }
    for (const n of ents) if (/^sharedindex\.[0-9a-f]+$/.test(n)) await copyIndex(path.join(loc.gitDir, n), path.join(sg, n));
  }
  await fs.mkdir(path.join(sg, 'info'));
  for (const f of ['exclude', 'attributes']) await copyIfRegular(path.join(loc.commonDir, 'info', f), path.join(sg, 'info', f));
  return sg;
}

// ---------------------------------------------------------------- argument policy

/** Long options that run a repository-named program, write a file or reach into submodules (any prefix is refused). */
export const DENIED_LONG = Object.freeze([
  'ext-diff', 'textconv', 'filters', 'no-index', 'show-signature', 'open-files-in-pager', 'output', 'output-directory',
  'exec', 'upload-pack', 'receive-pack', 'recurse-submodules', 'ignore-submodules', 'submodule'
]);
/** rev-parse options that would print the private shadow git dir instead of the repository's. */
const REV_PARSE_SHADOW = new Set(['git-dir', 'absolute-git-dir', 'git-common-dir', 'git-path', 'shared-index-path']);
const SIGNATURE_FORMAT = /%G|%\(\s*signature/i;

/** Validate a read-only git argv; returns it with the hardening flags inserted. Throws KitExit 2. */
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
    const name = a.startsWith('--') && a !== '--' ? a.slice(2).split('=')[0] : null;
    // git's option parser accepts any unambiguous prefix of a long option, so refuse every prefix of a denied one.
    if ((name !== null && (name === '' || DENIED_LONG.some(d => d.startsWith(name))))
      || /^-O/.test(a) || SIGNATURE_FORMAT.test(a)) {
      throw refuse(`git option ${a} would re-enable code execution, write a file or read a submodule; refused`);
    }
    if (sub === 'rev-parse' && name !== null && REV_PARSE_SHADOW.has(name)) {
      throw refuse(`git rev-parse ${a} would print safe-git's private shadow git dir, not the repository's; refused`);
    }
  }
  if (DIFFING.has(sub)) return [sub, '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', ...rest];
  if (sub === 'status') return [sub, '--ignore-submodules=all', ...rest];
  return [sub, ...rest];
}

/**
 * describe --dirty[=mark] / --broken[=mark] (abbreviations and --no- forms included): describe's own dirty check
 * starts a git inside each populated submodule. Returns null when neither is in effect, else
 * { argv (without them), dirty: mark, broken: mark|null }. KitExit 1 when combined with a commit-ish, as git does.
 */
export function describeDirtyPlan(argv) {
  if (argv[0] !== 'describe') return null;
  const rest = argv.slice(1);
  const dashdash = rest.indexOf('--');
  const opts = dashdash === -1 ? rest : rest.slice(0, dashdash);
  const after = dashdash === -1 ? [] : rest.slice(dashdash);
  let dirty = null;
  let broken = null;
  const kept = [];
  const isPrefix = (word, name, min) => name.length >= min && word.startsWith(name);
  for (const a of opts) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const raw = a.slice(2, eq === -1 ? undefined : eq);
      const value = eq === -1 ? null : a.slice(eq + 1);
      const neg = raw.startsWith('no-');
      const name = neg ? raw.slice(3) : raw;
      if (isPrefix('dirty', name, 2)) { dirty = neg ? null : (value ?? '-dirty'); continue; }
      if (isPrefix('broken', name, 1)) { broken = neg ? null : (value ?? '-broken'); continue; }
    }
    kept.push(a);
  }
  if (dirty === null && broken === null) return null;
  const together = () => new KitExit("option '--dirty' and commit-ishes cannot be used together", 1);
  for (let i = 0; i < kept.length; i++) {
    const a = kept[i];
    if (a.startsWith('-')) {
      const name = a.startsWith('--') && !a.includes('=') ? a.slice(2) : null;
      if (name && (isPrefix('match', name, 1) || isPrefix('exclude', name, 3))) i++;
      continue;
    }
    throw together();
  }
  if (after.length > 1) throw together();
  return { argv: ['describe', ...kept], dirty: dirty ?? '-dirty', broken };
}

async function describeDirty(exec, plan, timeout) {
  const d = await exec(plan.argv, { timeout });
  if (d.code !== 0) return d;
  // Refresh the SHADOW index copy, then compare it with HEAD — both with submodules ignored.
  await exec(['update-index', '-q', '--ignore-submodules', '--refresh'], { timeout });
  const q = await exec(['diff-index', '--quiet', '--ignore-submodules=all', 'HEAD', '--'], { timeout });
  let suffix = '';
  if (q.code === 1) suffix = plan.dirty;
  else if (q.code !== 0) {
    if (plan.broken === null) return { stdout: '', stderr: q.stderr, code: q.code };
    suffix = plan.broken;
  }
  return { stdout: `${String(d.stdout).replace(/\n$/, '')}${suffix}\n`, stderr: d.stderr || '', code: 0 };
}

// ---------------------------------------------------------------- the wrapper

/**
 * Run a read-only git command for `dir` against a fresh shadow git dir (see the header).
 * Returns { stdout, stderr, code }. `git` and `env` are injectable; `input` becomes stdin (closed otherwise).
 */
export async function safeGit(dir, args, { input, git = defaultGitRunner, env = process.env, timeout } = {}) {
  const argv = checkReadArgs(args);
  const dirtyPlan = describeDirtyPlan(argv);
  return withScratch(async (scratch) => {
    const info = await inspect(dir, makeCtx(git, env, scratch, timeout));
    const overrides = await overridesFor(info);
    const shadow = await buildShadow(scratch, info);
    const genv = { ...safeGitEnv(env), GIT_DIR: shadow, GIT_OBJECT_DIRECTORY: path.join(info.loc.commonDir, 'objects') };
    if (info.top) genv.GIT_WORK_TREE = info.top;
    const exec = async (a, extra = {}) => {
      const r = await git([...overrides, ...a], { cwd: info.loc.real, env: genv, ...extra });
      return { stdout: r.stdout, stderr: r.stderr || '', code: r.code };
    };
    if (dirtyPlan) return describeDirty(exec, dirtyPlan, timeout);
    return exec(argv, { input, timeout });
  });
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
