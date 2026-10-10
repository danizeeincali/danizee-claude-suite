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
 *       filemode, symlinks, autocrlf, eol). The repo's config files are read as DATA (`git config --file <f>
 *       --no-includes --list -z`, run outside any repository; an include.path is never opened, so a FIFO or a UNC
 *       share it names is never touched); config.worktree only when extensions.worktreeConfig is set; extensions and
 *       the format version only from the repo's own config file (as git does). An extension we do not know
 *       (refstorage=reftable, compatobjectformat, ...) or a format version above 1 is refused (KitExit 2), never
 *       guessed at. extensions.partialclone and worktreeconfig are dropped, so no promisor remote exists;
 *     - HEAD and the per-worktree pseudo refs (ORIG_HEAD, FETCH_HEAD, MERGE_HEAD, ...), refs/ (common dir, overlaid
 *       with the worktree's own refs) and packed-refs, copied at call time — regular files only, symlinks below refs/
 *       skipped. A refs/ (or worktree refs/) that is ITSELF a symlink is refused (KitExit 2): plain git would follow
 *       it and read refs from a folder outside the repository, and copying it could pull in any tree (/usr, $HOME);
 *     - shallow, a copy of the index (and sharedindex.* files), info/exclude and info/attributes (attributes cannot
 *       name a program when no config defines a driver; work-tree .gitattributes stay as they are).
 *   COPY LIMITS. Every copied file is lstat'ed, must be a regular file, and is copied with a bounded read that stops at
 *   its cap, so a sparse file (`truncate -s 1T`, no disk in the repo) cannot fill the temp disk. Defaults, overridable
 *   with the `limits` option: index and each sharedindex 256 MiB, packed-refs 64 MiB, any other file 64 MiB, 512 MiB
 *   in all per call, 100000 entries walked under refs/. Over a limit the call is refused (KitExit 2) naming the file.
 *   INDEX PATHS. git does not re-check index entries it reads from disk, so before anything reads the work tree the
 *   shadow's index copy is listed (`ls-files -z --stage`) and an entry that is absolute or has an empty, '.', '..' or
 *   git-dir component ('.git' in any case, with trailing dots/spaces, NTFS/HFS aliases such as git~1) is refused
 *   (KitExit 2): an entry named ../outside/sec would make diff and status print a file outside the repository.
 *   No hooks dir, no config.worktree, no includes, no remotes. Repository discovery is done here on the file system
 *   (.git dir, gitdir: file, commondir file, bare layout), so git never opens the repo with its own config.
 *
 *   NEVER INSIDE THE REPO: git is spawned by an absolute path found in the absolute PATH entries only (a bare 'git'
 *   is looked up in the child's cwd on Windows and through an empty/relative PATH entry on POSIX), git's children get
 *   a PATH without empty/relative entries, and every git child runs with cwd = the private scratch folder: the work
 *   tree reaches git only through GIT_WORK_TREE. So every command runs as from the TOP of the work tree, and --dir
 *   must name that top or the git dir itself (bare repo, .git, a linked worktree's git dir): a subfolder is refused
 *   (KitExit 1, "pass the repository top; paths are relative to it") rather than silently re-rooting pathspecs.
 *   Pathspecs and printed paths are top-relative, rev-parse --show-prefix/--show-cdup print an empty line,
 *   --is-inside-work-tree/--is-inside-git-dir are answered for --dir (asked on their own; mixed with other rev-parse
 *   arguments they are refused), and the relative `HEAD:./path` form is not available.
 *
 *   DEFENCE IN DEPTH: every inherited GIT_* variable is removed; no system config (GIT_CONFIG_NOSYSTEM) and no global
 *   config — GIT_CONFIG_GLOBAL is an empty file, and because git before 2.32 ignores that variable, HOME and
 *   XDG_CONFIG_HOME also point at an empty private folder for every git child (so ~/.gitconfig and
 *   $XDG_CONFIG_HOME/git/{config,attributes,ignore} are not read on any version); no prompts,
 *   GIT_NO_LAZY_FETCH, no optional locks, no lfs smudge, closed stdin unless input is given; `-c` overrides switch off
 *   hooks, fsmonitor (`core.fsmonitor=` EMPTY: before git 2.36 the value is a hook path, so "false" would run a program
 *   named false), the pager, submodule recursion (diff.ignoreSubmodules=all), every transport (protocol.allow and
 *   protocol.<each>.allow=never), the external diff, signatures (log.showSignature=false, gpg.program /
 *   gpg.ssh.program / gpg.x509.program = a path that cannot run, format.pretty=medium), and every filter/diff/merge
 *   driver named in the repo's own config files (config, config.worktree; includes are not read), info/attributes,
 *   or a work-tree .gitattributes that git would read — listed by the shadow's own `ls-files --cached --others
 *   --exclude-standard`, so git-ignored trees such as node_modules are never walked. Attribute files are read only
 *   when they are regular files inside the repository (symlinks are skipped); core.attributesFile is never opened,
 *   since the shadow config does not carry it and git does not read it. A driver
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
 * `cat-file --textc`), with or without `=value` — except a real option the subcommand has, which git matches
 * exactly (`--text` for the diffing commands, `rev-list --filter=<spec>`). git diff also switches to no-index ON ITS OWN when either path lies
 * outside the work tree, so for the diffing commands (log show diff diff-tree diff-index diff-files) every non-option
 * argument, and every argument after `--`, that is absolute (/x, C:x, \\host) or climbs out with '..' is refused.
 * rev-parse --git-dir / --git-common-dir / --absolute-git-dir /
 * --git-path / --shared-index-path are refused: they would print the private shadow dir.
 *
 * CLI: prints { stdout, stderr, code, exit }; exit status 0 when git succeeded, 3 when git ran and failed (git's own
 * code is `code`), 1 for bad input / broken state, 2 for a policy refusal. --help prints the usage.
 *
 * Repository state is never cached: every call re-reads the config and copies refs and index, so a changed repo is
 * always seen. The only cache is the resolved absolute git path (per PATH/PATHEXT); clearSafeGitCache() empties it.
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
/** CLI exit status when git itself ran and failed (its own code is in the printed JSON). */
export const GIT_FAILED_EXIT = 3;
export const usage = 'cli.js safe-git [--dir <repo top or git dir>] -- <git args...>   (read-only git on an untrusted repo; '
  + 'prints { stdout, stderr, code, exit }; git gets no stdin unless --input - is given (needed for --stdin and --batch modes); --dir must be the top of the work tree or the git dir, not a subfolder, '
  + 'and paths are relative to the repository top; exit 0 git ok, 1 bad input, 2 refused, 3 git failed)';

export const READ_SUBCOMMANDS = Object.freeze([
  'rev-parse', 'rev-list', 'log', 'show', 'diff', 'diff-tree', 'diff-index', 'diff-files', 'ls-files', 'ls-tree',
  'cat-file', 'status', 'show-ref', 'for-each-ref', 'merge-base', 'name-rev', 'describe'
]);
const DIFFING = new Set(['log', 'show', 'diff', 'diff-tree', 'diff-index', 'diff-files']);
const DRIVER_NAME = /^[A-Za-z0-9._-]+$/;
const MAX_ATTR_BYTES = 4 * 1024 * 1024;
const MAX_SMALL_FILE = 64 * 1024;
const INTERNAL_TIMEOUT = 60000;
const MiB = 1024 * 1024;
/** Copy limits for the shadow (see COPY LIMITS in the header); each can be overridden through the `limits` option. */
export const DEFAULT_LIMITS = Object.freeze({ index: 256 * MiB, packedRefs: 64 * MiB, file: 64 * MiB, total: 512 * MiB, entries: 100000 });

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

/**
 * baseEnv without any GIT_* variable, plus the hardening variables. Never mutates baseEnv. With `home` (an empty
 * private folder), HOME and XDG_CONFIG_HOME point at it too: git < 2.32 ignores GIT_CONFIG_GLOBAL and reads
 * ~/.gitconfig and $XDG_CONFIG_HOME/git/config instead.
 */
export function safeGitEnv(baseEnv = process.env, { home } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(baseEnv || {})) if (!/^GIT_/i.test(k) && v !== undefined) out[k] = v;
  // git's own child lookups (sh, a pager, helpers) search PATH too: an empty or relative entry would mean "the folder
  // git runs in". Keep only absolute entries (the key is case-insensitive on Windows: Path).
  for (const k of Object.keys(out)) if (pathKeyMatches(k)) out[k] = absolutePathEntries(out[k]).join(path.delimiter);
  out.GIT_CONFIG_NOSYSTEM = '1';
  out.GIT_CONFIG_GLOBAL = nullConfigPath();
  out.GIT_TERMINAL_PROMPT = '0';
  out.GIT_NO_LAZY_FETCH = '1';
  out.GIT_OPTIONAL_LOCKS = '0';
  out.GIT_LFS_SKIP_SMUDGE = '1';
  if (home) {
    out.HOME = home;
    out.XDG_CONFIG_HOME = home;
  }
  return out;
}

// ---------------------------------------------------------------- git runner

const pathKeyMatches = (k) => (process.platform === 'win32' ? k.toUpperCase() === 'PATH' : k === 'PATH');
const envGet = (env, name) => {
  if (process.platform !== 'win32') return env?.[name];
  const key = Object.keys(env || {}).find(k => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
};

/** The PATH entries that are absolute; empty, '.' and relative entries (which mean "the current folder") are dropped. */
export function absolutePathEntries(value, { delimiter = path.delimiter, isAbsolute = path.isAbsolute } = {}) {
  return String(value ?? '').split(delimiter).filter(e => e !== '' && isAbsolute(e));
}

const gitPathCache = new Map();

/**
 * The absolute path of the git program, found by scanning only the absolute entries of env.PATH (on Windows with each
 * PATHEXT extension). Never a bare name: a bare 'git' is looked up in the child's cwd on Windows, and through an
 * empty or relative PATH entry on POSIX, so a git committed to the repository being read would run. Cached per
 * PATH/PATHEXT. KitExit 1 when no git is found.
 */
export function resolveGit(env = process.env) {
  const win = process.platform === 'win32';
  const pathValue = envGet(env, 'PATH') ?? '';
  const exts = win ? String(envGet(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const key = `${pathValue}\0${exts.join(';')}`;
  if (gitPathCache.has(key)) return gitPathCache.get(key);
  for (const dir of absolutePathEntries(pathValue)) {
    for (const ext of exts) {
      const file = path.join(dir, `git${ext.toLowerCase()}`);
      try {
        if (!fsSync.statSync(file).isFile()) continue;
        if (!win) fsSync.accessSync(file, fsSync.constants.X_OK);
      } catch { continue; }
      gitPathCache.set(key, file);
      return file;
    }
  }
  throw new KitExit('cannot run git: no git program in any absolute PATH entry (empty and relative entries are not searched)', 1);
}

/**
 * Default runner: `git(args, { cwd, env, input, timeout })` → { code, stdout, stderr }. stdin is closed without input.
 * git is spawned by its absolute path (resolveGit), never by bare name.
 */
export function defaultGitRunner(args, { cwd, env, input, timeout } = {}) {
  const hasInput = input !== undefined && input !== null;
  const r = spawnSync(resolveGit(env || process.env), args, {
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

/**
 * Read one config FILE as data. git runs in an empty scratch dir below a ceiling, so it opens no repository. Always
 * --no-includes: an include.path / includeIf names any path (a FIFO that hangs the read, a UNC share that sends the
 * user's credentials), and nothing from an included file is ever used — the shadow config is ours.
 */
async function readConfigFile(ctx, file) {
  if (!(await isRegular(file))) return [];
  const r = await ctx.git(['config', '--file', file, '--no-includes', '--list', '-z'],
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

/**
 * The text of an attributes file, read only when it is a regular file (lstat: a symlink, FIFO or anything else is
 * skipped, as git >= 2.32 skips a symlinked in-tree .gitattributes) whose folder resolves inside `root`. Read through
 * an O_NOFOLLOW, non-blocking descriptor and capped at MAX_ATTR_BYTES (over it: KitExit 2). '' when skipped.
 */
async function readAttributesFile(file, root) {
  const st = await lstatOrNull(file);
  if (!st || !st.isFile()) return '';
  const [dir, realRoot] = await Promise.all([fs.realpath(path.dirname(file)).catch(() => null), fs.realpath(root).catch(() => null)]);
  if (!dir || !realRoot || (dir !== realRoot && !dir.startsWith(realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep))) return '';
  const tooBig = () => refuse(`${file} is larger than ${MAX_ATTR_BYTES} bytes; its filter drivers cannot be checked`);
  if (st.size > MAX_ATTR_BYTES) throw tooBig();
  let fh;
  try {
    fh = await fs.open(file, fsSync.constants.O_RDONLY | (fsSync.constants.O_NOFOLLOW || 0) | (fsSync.constants.O_NONBLOCK || 0));
  } catch { return ''; }
  try {
    const fst = await fh.stat();
    if (!fst.isFile()) return '';
    const chunks = [];
    let total = 0;
    for (;;) {
      const buf = Buffer.alloc(MAX_SMALL_FILE);
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_ATTR_BYTES) throw tooBig();
      chunks.push(buf.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks).toString('utf-8');
  } finally {
    await fh.close();
  }
}

/**
 * The work-tree .gitattributes files git would read, as the shadow's own index sees them: tracked ones plus untracked
 * ones outside git-ignored folders (`ls-files --others --exclude-standard` does not descend into an ignored
 * node_modules). Returns [{ rel, text }]; a tracked file missing from the work tree (deleted, sparse) is read from the
 * index, as git does. KitExit 1 when git cannot list them (fail closed).
 */
async function workTreeAttributes(exec, top) {
  const r = await exec(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(top,glob)**/.gitattributes']);
  if (r.code !== 0) throw new KitExit(`cannot list the .gitattributes files of ${top}: ${(r.stderr || '').trim() || 'git ls-files failed'}`, 1);
  const out = [];
  for (const rel of new Set(String(r.stdout).split('\0').filter(Boolean))) {
    if (path.posix.basename(rel) !== '.gitattributes') continue;
    const file = path.join(top, ...rel.split('/'));
    if (await lstatOrNull(file)) { out.push({ rel, text: await readAttributesFile(file, top) }); continue; } // a symlink: skipped, as git does
    const size = await exec(['cat-file', '-s', `:${rel}`]);
    if (size.code !== 0) continue; // untracked and gone, or not in the index: git reads nothing either
    if (Number(String(size.stdout).trim()) > MAX_ATTR_BYTES) throw refuse(`${rel} in the index is larger than ${MAX_ATTR_BYTES} bytes; its filter drivers cannot be checked`);
    const blob = await exec(['cat-file', 'blob', `:${rel}`]);
    if (blob.code === 0) out.push({ rel, text: blob.stdout });
  }
  return out;
}

// ---------------------------------------------------------------- index paths

// Characters HFS+ ignores in names (so ".g‌it" is ".git" there), as git's is_hfs_dotgit lists them.
const HFS_IGNORABLE = /[‌-‏‪-‮⁪-⁯﻿]/g;

/**
 * Why an index entry path would let git read outside the work tree (or into a git dir), or null when it is safe.
 * Refused: an absolute path (/x, \x, C:...), and any component (split on / and \) that is empty, '.', '..', or a git
 * dir alias — '.git' in any case, also with trailing dots/spaces, an NTFS stream suffix (.git::$INDEX_ALLOCATION),
 * HFS+ ignorable characters, or the NTFS short name git~<n>. A sparse-index directory entry may end in one '/'.
 */
export function unsafeIndexPath(p, { dir = false } = {}) {
  let s = String(p);
  if (s === '') return 'empty path';
  if (dir && s.endsWith('/')) s = s.slice(0, -1);
  if (/^[\\/]/.test(s) || /^[A-Za-z]:/.test(s)) return 'absolute path';
  for (const c of s.split(/[\\/]/)) {
    if (c === '' || c === '.' || c === '..') return `component ${JSON.stringify(c)}`;
    const name = c.replace(HFS_IGNORABLE, '').split(':')[0].replace(/[. ]+$/, '').toLowerCase();
    if (name === '.git' || /^git~\d+$/.test(name)) return `component ${JSON.stringify(c).slice(0, 40)} names a git dir`;
  }
  return null;
}

/**
 * List the SHADOW's index copy (`ls-files -z --stage`, which reads only the index) and refuse (KitExit 2) when any
 * entry is unsafe (unsafeIndexPath): git does not re-check index entries it reads from disk, so an entry named
 * ../outside/sec makes diff and status read and print a file outside the repository. The listing is bounded by the
 * index copy limit and the runner's output cap (an overflow is a git failure: KitExit 1, fail closed).
 */
async function checkIndexPaths(exec) {
  const r = await exec(['ls-files', '-z', '--stage']);
  if (r.code !== 0) throw new KitExit(`cannot list the index: ${(r.stderr || '').trim() || 'git ls-files failed'}`, 1);
  for (const rec of String(r.stdout).split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    if (tab === -1) throw new KitExit(`cannot parse git ls-files --stage output: ${JSON.stringify(rec).slice(0, 80)}`, 1);
    const p = rec.slice(tab + 1);
    const why = unsafeIndexPath(p, { dir: rec.startsWith('040000 ') });
    if (why) throw refuse(`the index has an entry ${JSON.stringify(p).slice(0, 120)} (${why}) that would make git read outside the work tree; refusing to read this repository`);
  }
}

/** Empties the resolved git path cache (resolveGit); repository state is never cached, every call re-reads it. */
export function clearSafeGitCache() { gitPathCache.clear(); }

const NO_PROGRAM = process.platform === 'win32' ? nullConfigPath() : '/dev/null'; // exists, is not executable
const STATIC_OVERRIDES = [
  'core.hooksPath=/dev/null', 'core.fsmonitor=', 'core.pager=cat', 'submodule.recurse=false',
  'diff.ignoreSubmodules=all', 'status.submoduleSummary=false',
  'protocol.allow=never', ...['file', 'git', 'ssh', 'http', 'https', 'ext'].map(p => `protocol.${p}.allow=never`),
  'diff.external=', 'log.showSignature=false', 'format.pretty=medium', 'credential.helper=',
  `gpg.program=${NO_PROGRAM}`, `gpg.ssh.program=${NO_PROGRAM}`, `gpg.x509.program=${NO_PROGRAM}`
];

/**
 * --dir must name the top of the work tree or the git dir itself (a bare repo, .git, a linked worktree's git dir).
 * git never runs inside the repository, so every command runs as from the top: a subfolder would silently re-root
 * pathspecs (`log -- f` from sub/ would show nothing). KitExit 1 instead of a wrong answer.
 */
export function checkRepoRoot(loc) {
  if ([loc.top, loc.gitDir, loc.commonDir].includes(loc.real)) return;
  throw new KitExit(`${loc.real} is inside the repository ${loc.top ?? loc.gitDir}, not its top: pass the repository top; paths are relative to it`, 1);
}

/** Everything we learn about the repo, reading files only. `ctx` = { git, scratch, cfgEnv, timeout }. */
async function inspect(dir, ctx) {
  const loc = await locateRepo(dir);
  checkRepoRoot(loc);
  const mainCfg = path.join(loc.commonDir, 'config');
  const fmt = repoFormat(await readConfigFile(ctx, mainCfg));
  const files = [mainCfg];
  if (fmt.worktreeConfig) files.push(path.join(loc.gitDir, 'config.worktree'));
  const entries = [];
  for (const f of files) entries.push(...await readConfigFile(ctx, f)); // the repo's own files only, no includes
  const core = allowedCore(entries);
  const top = core.bare === true ? null : loc.top;
  return { loc, fmt, entries, core, top };
}

function overrideArgs(names) {
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

/**
 * The -c overrides: static switches + every driver named in the config entries, info/attributes and (with a work
 * tree) the .gitattributes files the shadow lists. core.attributesFile is never opened: the shadow config does not
 * carry it, so git never reads it either (and its value may name a file outside the repository or a UNC share).
 * `shadowExec(args, extra)` runs git in the shadow.
 */
async function overridesFor(info, shadowExec) {
  const { loc, entries } = info;
  const names = driversFromKeys(entries.map(([k]) => k));
  for (const d of new Set([loc.gitDir, loc.commonDir])) {
    for (const n of driversFromAttributes(await readAttributesFile(path.join(d, 'info', 'attributes'), d))) names.add(n);
  }
  // validate the config/info names first: the listing below runs git, and must not run with a name we cannot switch off
  const base = overrideArgs(names);
  if (!info.top) return base;
  const listExec = (a, extra) => shadowExec([...base, ...a], extra);
  // before anything reads the work tree (the listing below, then the user's command): no index entry may lead out of it
  await checkIndexPaths(listExec);
  for (const { text } of await workTreeAttributes(listExec, info.top)) for (const n of driversFromAttributes(text)) names.add(n);
  return overrideArgs(names);
}

async function withScratch(fn) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-git-shadow-'));
  try {
    await fs.chmod(scratch, 0o700);
    await fs.mkdir(path.join(scratch, 'home'), { mode: 0o700 });
    return await fn(scratch);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

function makeCtx(git, env, scratch, timeout, limits) {
  // git config --file still looks for a repository around its cwd: give it an empty folder and a ceiling above it.
  // HOME / XDG_CONFIG_HOME = the empty private scratch/home for every git child (git < 2.32 ignores GIT_CONFIG_GLOBAL).
  const home = path.join(scratch, 'home');
  const cfgEnv = { ...safeGitEnv(env, { home }), GIT_CEILING_DIRECTORIES: path.dirname(scratch) };
  return { git, env, home, scratch, cfgEnv, timeout: timeout ?? INTERNAL_TIMEOUT, limits: mergeLimits(limits) };
}

/** inspect + shadow + overrides for one call. Returns { info, shadow, overrides, exec } where exec runs git in the shadow. */
async function prepare(dir, ctx) {
  const info = await inspect(dir, ctx);
  const shadow = await buildShadow(ctx.scratch, info, ctx.limits);
  const genv = { ...safeGitEnv(ctx.env, { home: ctx.home }), GIT_DIR: shadow, GIT_OBJECT_DIRECTORY: path.join(info.loc.commonDir, 'objects') };
  if (info.top) genv.GIT_WORK_TREE = info.top;
  const raw = async (a, extra = {}) => {
    // cwd is the private scratch folder, never the repository: the work tree reaches git only through GIT_WORK_TREE
    const r = await ctx.git(a, { cwd: ctx.scratch, env: genv, timeout: ctx.timeout, ...extra });
    return { stdout: r.stdout, stderr: r.stderr || '', code: r.code };
  };
  const overrides = await overridesFor(info, raw);
  const exec = (a, extra = {}) => raw([...overrides, ...a], extra);
  return { info, shadow, overrides, exec };
}

/**
 * The `-c` override argv for the folder (defence in depth; git never reads the repo config through safeGit anyway):
 * static switches plus, for every driver name in its own config files (config, config.worktree — read as data,
 * without includes), info/attributes or a .gitattributes the shadow's ls-files lists, empty filter.<n>.{clean,smudge,process}, filter.<n>.required=false, empty
 * diff.<n>.{command,textconv} and merge.<n>.driver. KitExit 2 for a driver name outside [A-Za-z0-9._-] or an
 * unsupported repository format, KitExit 1 when git cannot answer. Computed afresh on every call.
 */
export async function safeGitConfig(dir, { git = defaultGitRunner, env = process.env, timeout, limits } = {}) {
  return withScratch(async (scratch) => (await prepare(dir, makeCtx(git, env, scratch, timeout, limits))).overrides);
}

// ---------------------------------------------------------------- the shadow git dir

const mib = (n) => `${Math.round(n / MiB * 10) / 10} MiB`;

/**
 * Copy one file into the shadow if it is a regular file (lstat: a symlink or anything else is skipped; a missing
 * source is fine), refusing (KitExit 2, naming the file) when it is larger than `cap` or would take the call past
 * limits.total. The copy is a bounded read of an O_NOFOLLOW descriptor, so a file that grows or is swapped after the
 * size check still cannot write more than the cap. `budget` = { limits, used, entries }. Returns the source stat or null.
 */
async function copyCapped(src, dst, cap, budget) {
  const st = await lstatOrNull(src);
  if (!st || !st.isFile()) return null;
  const left = budget.limits.total - budget.used;
  const tooBig = (size) => refuse(size > cap
    ? `${src} is ${mib(size)}, over safe-git's ${mib(cap)} limit for this file; refusing to copy it (safeGit's limits option raises it for a repository trusted to be that large)`
    : `${src} (${mib(size)}) would take this call past safe-git's ${mib(budget.limits.total)} total copy limit; refusing`);
  if (st.size > cap || st.size > left) throw tooBig(st.size);
  let fh;
  try {
    fh = await fs.open(src, fsSync.constants.O_RDONLY | (fsSync.constants.O_NOFOLLOW || 0) | (fsSync.constants.O_NONBLOCK || 0));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ELOOP') return null;
    throw err;
  }
  const max = Math.min(cap, left);
  let out;
  try {
    const fst = await fh.stat();
    if (!fst.isFile()) return null;
    if (fst.size > max) throw tooBig(fst.size);
    out = await fs.open(dst, 'w', 0o600); // a worktree's own ref may replace the common one
    const buf = Buffer.alloc(Math.min(MiB, Math.max(1, max + 1)));
    let total = 0;
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > max) throw tooBig(total);
      await out.write(buf, 0, bytesRead);
    }
    budget.used += total;
    return fst;
  } finally {
    await fh.close();
    if (out) await out.close();
  }
}

/**
 * Copy a tree of regular files (symlinks below the top and anything else skipped, each file capped); a missing source
 * is fine. A top folder that is itself a symlink is refused (KitExit 2): plain git would follow it out of the repository.
 */
async function copyTree(src, dst, budget, label) {
  const top = await lstatOrNull(src);
  if (!top) return;
  if (top.isSymbolicLink()) throw refuse(`${src} (${label}) is a symlink; git would read refs from wherever it points, so safe-git refuses to read this repository`);
  if (!top.isDirectory()) return;
  const walk = async (s0, d0) => {
    let ents;
    try { ents = await fs.readdir(s0, { withFileTypes: true }); } catch { return; }
    await fs.mkdir(d0, { recursive: true, mode: 0o700 });
    for (const e of ents) {
      if (++budget.entries > budget.limits.entries) throw refuse(`more than ${budget.limits.entries} entries under ${src}; refusing to copy them`);
      const s = path.join(s0, e.name);
      const d = path.join(d0, e.name);
      if (e.isDirectory()) await walk(s, d);
      else if (e.isFile()) await copyCapped(s, d, budget.limits.file, budget);
    }
  };
  await walk(src, dst);
}

/**
 * Copy the index keeping its mtime (rounded DOWN, minus 1µs): git treats an entry whose mtime is not older than the
 * index file as "racily clean" and compares its content. A copy stamped "now" would make a same-size edit made in
 * the same second as the last index write look unchanged.
 */
async function copyIndex(src, dst, budget) {
  const st = await fs.lstat(src, { bigint: true }).catch(() => null);
  if (!st || !st.isFile()) return;
  if (!(await copyCapped(src, dst, budget.limits.index, budget))) return;
  const us = (ns) => (Number(ns / 1000n) - 1) / 1e6;
  await fs.utimes(dst, us(st.atimeNs), us(st.mtimeNs)).catch((err) => { if (err.code !== 'ENOENT') throw err; });
}

/** Build the shadow git dir inside `scratch` (see the header) and return its path. `limits` as DEFAULT_LIMITS. */
/** DEFAULT_LIMITS with the caller's overrides; an override must be a positive integer (undefined keeps the default). */
function mergeLimits(limits) {
  const out = { ...DEFAULT_LIMITS };
  for (const [k, v] of Object.entries(limits || {})) {
    if (v === undefined) continue;
    if (!(k in DEFAULT_LIMITS)) throw new KitExit(`unknown safe-git limit ${k}`, 1);
    if (!Number.isSafeInteger(v) || v <= 0) throw new KitExit(`safe-git limit ${k} must be a positive integer (got ${v})`, 1);
    out[k] = v;
  }
  return out;
}

export async function buildShadow(scratch, info, limits = DEFAULT_LIMITS) {
  const { loc, fmt, core, top } = info;
  const budget = { limits: mergeLimits(limits), used: 0, entries: 0 };
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

  // the small, bounded files first, so an oversized one is refused before the refs tree is walked
  await copyCapped(path.join(loc.commonDir, 'packed-refs'), path.join(sg, 'packed-refs'), budget.limits.packedRefs, budget);
  await copyCapped(path.join(loc.commonDir, 'shallow'), path.join(sg, 'shallow'), budget.limits.file, budget);
  for (const f of ['ORIG_HEAD', 'FETCH_HEAD', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) await copyCapped(path.join(loc.gitDir, f), path.join(sg, f), budget.limits.file, budget);
  if (top) {
    await copyIndex(path.join(loc.gitDir, 'index'), path.join(sg, 'index'), budget);
    let ents = [];
    try { ents = await fs.readdir(loc.gitDir); } catch { /* none */ }
    for (const n of ents) if (/^sharedindex\.[0-9a-f]+$/.test(n)) await copyIndex(path.join(loc.gitDir, n), path.join(sg, n), budget);
  }
  await fs.mkdir(path.join(sg, 'info'));
  if ((await lstatOrNull(path.join(loc.commonDir, 'info')))?.isDirectory()) { // a symlinked info/ is skipped
    for (const f of ['exclude', 'attributes']) await copyCapped(path.join(loc.commonDir, 'info', f), path.join(sg, 'info', f), budget.limits.file, budget);
  }
  await copyTree(path.join(loc.commonDir, 'refs'), path.join(sg, 'refs'), budget, 'refs/');
  if (loc.gitDir !== loc.commonDir) await copyTree(path.join(loc.gitDir, 'refs'), path.join(sg, 'refs'), budget, "the worktree's refs/"); // per-worktree refs
  await fs.mkdir(path.join(sg, 'refs', 'heads'), { recursive: true });
  await fs.mkdir(path.join(sg, 'refs', 'tags'), { recursive: true });
  return sg;
}

// ---------------------------------------------------------------- argument policy

/** Long options that run a repository-named program, write a file or reach into submodules (any prefix is refused). */
export const DENIED_LONG = Object.freeze([
  'ext-diff', 'textconv', 'filters', 'no-index', 'show-signature', 'open-files-in-pager', 'output', 'output-directory',
  'exec', 'upload-pack', 'receive-pack', 'recurse-submodules', 'ignore-submodules', 'submodule'
]);
/**
 * Real options that are also prefixes of a denied one, per subcommand: git matches an exact option name before it
 * tries abbreviations, so these are the harmless option itself (diff's --text is -a; rev-list's --filter=<spec> is
 * the object filter). Only where the subcommand really has the option: `cat-file --text` abbreviates --textconv.
 */
const EXACT_SAFE = Object.freeze({ text: DIFFING, filter: new Set(['rev-list']) });
/** rev-parse options that would print the private shadow git dir instead of the repository's. */
const REV_PARSE_SHADOW = new Set(['git-dir', 'absolute-git-dir', 'git-common-dir', 'git-path', 'shared-index-path']);
const SIGNATURE_FORMAT = /%G|%\(\s*signature/i;

/** True for an argument that is an absolute path (POSIX, Windows drive or UNC) or whose '..' components climb above its start. */
export function escapingPath(a) {
  if (a.startsWith('/') || a.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(a)) return true;
  if (process.platform === 'win32' && /^[A-Za-z]:/.test(a)) return true; // C:x is relative to drive C's own cwd
  let depth = 0;
  for (const part of a.split(/[\\/]/)) {
    if (part === '..') { if (--depth < 0) return true; } else if (part !== '' && part !== '.') depth++;
  }
  return false;
}

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
    // git's option parser accepts any unambiguous prefix of a long option, so refuse every prefix of a denied one,
    // except a real option of this subcommand that git matches exactly (EXACT_SAFE).
    const exactSafe = name !== null && Object.hasOwn(EXACT_SAFE, name) && EXACT_SAFE[name].has(sub);
    if ((name !== null && !exactSafe && (name === '' || DENIED_LONG.some(d => d.startsWith(name))))
      || /^-O/.test(a) || SIGNATURE_FORMAT.test(a)) {
      throw refuse(`git option ${a} is, or abbreviates, an option safe-git does not allow (it would re-enable code execution, write a file or read a submodule)`);
    }
    if (sub === 'rev-parse' && name !== null && REV_PARSE_SHADOW.has(name)) {
      throw refuse(`git rev-parse ${a} would print safe-git's private shadow git dir, not the repository's`);
    }
  }
  if (DIFFING.has(sub)) {
    // git diff turns into `diff --no-index` on its own when either path lies outside the work tree: no path argument
    // of a diffing command may be absolute or climb out with '..'.
    for (const [k, a] of rest.entries()) {
      if ((dashdash === -1 || k < dashdash) && a.startsWith('-')) continue;
      if (k === dashdash) continue;
      if (escapingPath(a)) throw refuse(`git ${sub} path ${a} is absolute or leaves the work tree (git would read files outside the repository)`);
    }
    return [sub, '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', ...rest];
  }
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

/** rev-parse options whose answer depends on the folder git runs in (always the private scratch folder). */
const REV_PARSE_POSITION = new Set(['--show-prefix', '--show-cdup', '--is-inside-work-tree', '--is-inside-git-dir']);
const within = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/**
 * Answer rev-parse --show-prefix / --show-cdup / --is-inside-work-tree / --is-inside-git-dir for `info` as from the top
 * of the work tree (every command runs that way). Returns null when argv asks none of them; KitExit 2 when they are
 * mixed with other arguments (rev-parse prints one line per argument, and the others go to git).
 */
export function revParsePosition(argv, info) {
  if (argv[0] !== 'rev-parse' || !argv.slice(1).some(a => REV_PARSE_POSITION.has(a))) return null;
  if (!argv.slice(1).every(a => REV_PARSE_POSITION.has(a))) {
    throw refuse(`git rev-parse ${[...REV_PARSE_POSITION].join('/')} must be asked on their own through safe-git (it runs git outside the work tree)`);
  }
  const { loc, top } = info;
  const lines = argv.slice(1).map(a => {
    if (a === '--is-inside-work-tree') return String(!!top && !within(loc.real, loc.gitDir));
    if (a === '--is-inside-git-dir') return String(within(loc.real, loc.gitDir) || within(loc.real, loc.commonDir));
    return ''; // --show-prefix, --show-cdup: commands run as from the top of the work tree
  });
  return { stdout: lines.map(l => `${l}\n`).join(''), stderr: '', code: 0 };
}

async function describeDirty(exec, plan) {
  const d = await exec(plan.argv);
  if (d.code !== 0) return d;
  // Refresh the SHADOW index copy, then compare it with HEAD — both with submodules ignored.
  await exec(['update-index', '-q', '--ignore-submodules', '--refresh']);
  const q = await exec(['diff-index', '--quiet', '--ignore-submodules=all', 'HEAD', '--']);
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
 * Returns { stdout, stderr, code }. `git` and `env` are injectable; `input` becomes stdin (closed otherwise);
 * `limits` overrides DEFAULT_LIMITS for the shadow copy.
 */
export async function safeGit(dir, args, { input, git = defaultGitRunner, env = process.env, timeout, limits } = {}) {
  const argv = checkReadArgs(args);
  const dirtyPlan = describeDirtyPlan(argv);
  return withScratch(async (scratch) => {
    const { exec, info } = await prepare(dir, makeCtx(git, env, scratch, timeout, limits));
    const position = revParsePosition(argv, info);
    if (position) return position;
    // exec applies ctx.timeout (the caller's, or INTERNAL_TIMEOUT): never pass `timeout` here, since an undefined
    // value would override that default and let a hostile repo (a FIFO .gitattributes) hang the read forever.
    if (dirtyPlan) return describeDirty(exec, dirtyPlan);
    return exec(argv, { input });
  });
}

// ---------------------------------------------------------------- CLI

export async function run(args, io = {}) {
  let dir = io.cwd || process.cwd();
  let wantInput = false;
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { i++; break; }
    if (a === '--help' || a === '-h') return { usage };
    if (a === '--input') {
      if (args[i + 1] !== '-') throw new KitExit('--input takes only - (read git\'s stdin from this process\'s stdin)', 1);
      if (io.stdinIsTTY) throw new KitExit('--input - needs piped stdin, not a terminal', 1);
      i++; wantInput = true; continue;
    }
    if (a === '--dir') {
      if (i + 1 >= args.length || args[i + 1] === '--') throw new KitExit('--dir needs a path', 1);
      dir = path.resolve(io.cwd || process.cwd(), args[++i]);
    } else if (!a.startsWith('-')) throw new KitExit(`expected \`--\` before the git arguments (got ${a}; usage: ${usage})`, 1);
    else throw new KitExit(`unknown flag ${a} (usage: ${usage})`, 1);
  }
  const gitArgs = args.slice(i);
  if (gitArgs.length === 0) throw new KitExit(`no git command given (usage: ${usage})`, 1);
  if (!wantInput && gitArgs.some(a => a === '--stdin' || /^--batch/.test(a))) {
    throw new KitExit(`${gitArgs[0]} with --stdin or --batch reads stdin: pass --input - before \`--\` (usage: ${usage})`, 1);
  }
  const input = wantInput ? await io.stdin() : undefined;
  const result = await safeGit(dir, gitArgs, { env: io.env || process.env, git: io.git, input });
  return { ...result, exit: result.code === 0 ? 0 : GIT_FAILED_EXIT };
}
