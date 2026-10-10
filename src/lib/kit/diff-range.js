/**
 * diff-range — the review range as ONE unified diff on stdout, raw text, ready for `lenses|graph|impact --diff -`.
 *
 *   diff-range [--dir <repo>] [--base <ref>] [--no-untracked] [--base-only] [--json] [--timeout <ms>] [--max-untracked <n>] [--max-file-bytes <n>]
 *
 * The range: tracked changes from <base> to the working tree (committed since the base plus uncommitted edits), plus
 * every untracked, not-ignored file as an added file (unless --no-untracked). <base> is --base <ref> (a commit, or the empty-tree id that --base-only prints when there is no upstream), else the merge
 * base of HEAD and @{upstream}, else the empty tree (the whole history). Paths are bare and relative to the repository
 * top. When an upstream exists but `git merge-base HEAD <upstream>` fails (a shallow clone, or a git error) the verb is exit 1
 * ("no merge base with <upstream> (shallow clone?): pass --base <ref>"); the empty-tree fallback is only for no upstream.
 * --base also accepts the repository's own empty-tree id (`git hash-object -t tree /dev/null`: SHA-1 or SHA-256) as well as the
 * SHA-1 constant.
 *
 * Hardening (the repository under review may be one you did not write; --dir can name any folder): git runs with no
 * inherited GIT_* variables and, on EVERY call (rev-parse, hash-object, merge-base, config, ls-files, both diffs), with
 * safe-git.js's override list (overrideArgs there is the source of truth, reused here): hooks off (core.hooksPath=/dev/null),
 * the file system monitor off (`core.fsmonitor=` EMPTY, not "false", which old git runs as a hook path), the pager
 * (core.pager=cat), the external diff (diff.external=), submodule recursion (submodule.recurse=false,
 * diff.ignoreSubmodules=all), every transport (protocol.allow=never and
 * protocol.<file|git|ssh|http|https|ext>.allow=never), the credential helper (credential.helper=) and signature programs;
 * plus every filter/diff/merge driver name found in `git config --list -z --no-includes --show-scope` (all scopes, incl. the per-worktree
 * config.worktree; read as data; an include.path is NEVER followed by this read, so a FIFO or a share it names cannot hang it)
 * gets empty filter.<n>.{clean,smudge,process}, filter.<n>.required=false, empty diff.<n>.{command,textconv} and
 * merge.<n>.driver (a name outside [A-Za-z0-9._-] is refused, exit 2). The static overrides go in GIT_CONFIG_PARAMETERS (what `-c`
 * itself sets, inherited by any git child; a caller's own value is dropped, not appended), the per-driver pairs go on argv as
 * `-c k=v` (so hundreds of driver names cannot overflow the environment), and the env also carries GIT_NO_LAZY_FETCH=1 and
 * GIT_LFS_SKIP_SMUDGE=1. Every git child has a timeout (--timeout <ms>, default 60000): on expiry the verb is exit 1 naming the
 * git command. Both diffs also get --no-ext-diff --no-textconv --ignore-submodules=dirty (overrides diff.ignoreSubmodules=all, so a
 * committed submodule pointer change IS in the range; `dirty` runs nothing from the submodule's config, `none` would run its
 * clean filter) and no colour. So nothing named in a config file git reads directly (.git/config, config.worktree, the
 * global and system files) is executed, and textconv output never replaces the real content; drivers defined in files your
 * own global/system config includes are yours and are not switched off. In a partial clone a blob
 * that is not local is NOT fetched (lazy fetch off, transports refused): the verb exits 1 naming the missing object and
 * that diff-range never downloads, never printing a partial diff (the note says it is a partial clone only when extensions.partialClone or a
 * remote.<name>.promisor says so, else "if this is a partial clone"). An include.path / includeIf in the repository's OWN config
 * (scope local, .git/config, or scope worktree, $GIT_DIR/config.worktree when extensions.worktreeConfig is on) is refused,
 * exit 2, before any diff (a driver defined in an included file could not be switched off); the scopes come from the same
 * --show-scope read as the driver names (git older than 2.26: `--local` plus, when extensions.worktreeConfig is true,
 * `--worktree`). Includes in the user's global/system config are the user's own and stay allowed. The remaining trust: the work tree's own files (and the
 * .gitattributes / .gitignore in it) are read as DATA, the object store is read as is, and git itself is trusted.
 *
 * Untracked files go through ONE git process: a temporary copy of the index (GIT_INDEX_FILE; the real index is never touched) gets
 * `git add -N --pathspec-from-file=- --pathspec-file-nul` (names on stdin, NUL-separated, GIT_LITERAL_PATHSPECS=1) and a single `git diff <base>`
 * then prints them as new files; a git without --pathspec-from-file (< 2.25) falls back to one `--no-index` diff per file. Caps: --max-untracked <n>
 * (default 20000) and --max-file-bytes <n> (default 8 MiB, by lstat); a file over either goes to `skipped` (--json: also `skipped_detail`
 * [{path, reason}], reason nested_repository | max_untracked | too_large) with a note on stderr, `untracked_count` counts every untracked file
 * seen, and a range larger than graph's maxDiffBytes (32 MiB) is refused, exit 2.
 * Untracked paths: a path is listed under `untracked` (--json) only when its diff text is non-empty. A nested git repository
 * (ls-files shows it as `sub/`) is not this repository's file: it is SKIPPED, never diffed, and reported in `skipped` (--json).
 * An untracked SYMLINK is never followed (git would fail on a link to a directory): its added-file diff is written here in git's
 * own shape for a mode-120000 blob (`new file mode 120000`, one added line holding the link target, `\ No newline at end of file`).
 * The link name is C-quoted exactly as git quotes it (`"`, `\`, control characters incl. newline, and bytes >= 0x80, which these runs pin
 * with core.quotePath=true) and a name with a space gets git's trailing TAB after `+++`, so a hand-written entry and a `--no-index` entry
 * spell a path identically and a newline in a name cannot split the header.
 * The `--no-index` diff runs with core.safecrlf=false; a remaining stderr line that is git's "warning: in the working copy of ..." CRLF
 * notice (core.autocrlf, eol=crlf) is benign. Any other `git diff --no-index` failure (exit above 1, or exit 1 with empty stdout or other text on stderr) is a failure, exit 1 naming
 * the path and git's stderr, so a range with an unread untracked path is never exit 3.
 * Bytes: the diffs are read as bytes. When they are valid UTF-8 `raw` is a string; otherwise `raw` is a Buffer the cli writes undecoded.
 *
 * Exit: 0 printed, 3 empty (nothing printed), 1 bad input or git failed, 2 refused.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { isUtf8 } from 'buffer';
import { KitExit } from './kit-exit.js';
import { defaultGit } from './push-gate.js';
import { gitPaths } from './git-paths.js';
import { parseDiff } from './lenses.js';
import { DEFAULTS as graphDefaults } from './graph.js';
import { overrideArgs, driversFromConfig, parseConfigList } from './safe-git.js';

const driversFromKeys = (keys) => driversFromConfig(keys.map(k => `${k}\n`).join('\0'));

export const verb = 'diff-range';
export const usage = 'cli.js diff-range [--dir <repo>] [--base <ref>] [--no-untracked] [--base-only] [--json] [--timeout <ms>] [--max-untracked <n>] [--max-file-bytes <n>]   (prints the review range as one raw unified diff: '
  + 'tracked changes from the base to the working tree plus untracked files; base = --base, else the merge base with the upstream, else the empty tree; '
  + '--no-untracked leaves untracked files out, --base-only prints the resolved base, --json prints the summary (with the skipped nested repositories); --timeout <ms> stops any git call after that long (default 60000); --max-untracked <n> (default 20000) and --max-file-bytes <n> (default 8388608) leave the extra or oversized untracked files out (listed in skipped); '
  + 'exit 0 printed, 3 empty, 1 bad input or git failed, 2 refused)';

const BOOL_FLAGS = ['no-untracked', 'base-only', 'json', 'help'];
const VALUE_FLAGS = ['dir', 'base', 'timeout', 'max-untracked', 'max-file-bytes'];
const DEFAULT_MAX_UNTRACKED = 20000;
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;
const invalid = (m) => new KitExit(m, 1);

function parseArgs(args) {
  const f = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) throw invalid(`unexpected argument "${a}" (see cli.js diff-range --help)`);
    const eq = a.indexOf('=');
    const k = a.slice(2, eq === -1 ? undefined : eq);
    if (BOOL_FLAGS.includes(k) && eq === -1) { f[k] = true; continue; }
    if (!VALUE_FLAGS.includes(k)) throw invalid(`unknown flag --${k} (see cli.js diff-range --help)`);
    if (eq !== -1) f[k] = a.slice(eq + 1);
    else if (i + 1 < args.length) f[k] = args[++i];
    else throw invalid(`--${k} needs a value`);
  }
  if (f.base !== undefined && (f.base === '' || f.base.startsWith('-'))) throw invalid('--base needs a ref');
  if (f.timeout !== undefined && !/^[1-9]\d{0,9}$/.test(f.timeout)) throw invalid('--timeout must be a positive whole number of milliseconds');
  if (f['max-untracked'] !== undefined && !/^\d{1,9}$/.test(f['max-untracked'])) throw invalid('--max-untracked must be a whole number (0 or more)');
  if (f['max-file-bytes'] !== undefined && !/^[1-9]\d{0,12}$/.test(f['max-file-bytes'])) throw invalid('--max-file-bytes must be a positive whole number of bytes');
  return f;
}

const fail = (what, r) => new KitExit(`${what}: ${(r.stderr || r.stdout || '').trim() || 'git failed'}`, 1);
const DEFAULT_TIMEOUT = 60000;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DIFF = ['-c', 'core.quotePath=true', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--no-prefix'];

/** `-c` pairs as GIT_CONFIG_PARAMETERS ('k=v' 'k2=v2', single-quoted the way git's sq_quote does). */
export function configParameters(cArgs) {
  const out = [];
  for (let i = 0; i < cArgs.length; i += 2) out.push(`'${cArgs[i + 1].replace(/'/g, "'\\''")}'`);
  return out.join(' ');
}

/**
 * `git` with the overrides and the no-lazy-fetch / no-lfs-smudge env on every call (see the header). The static overrides
 * (the first `nStatic` * 2 entries of cArgs) go in the env; the per-driver pairs go on argv via the `pre` option.
 */
function hardened(git, cArgs, nStatic) {
  const statics = cArgs.slice(0, nStatic);
  const pre = cArgs.slice(nStatic);
  const base = { GIT_CONFIG_PARAMETERS: configParameters(statics), GIT_NO_LAZY_FETCH: '1', GIT_LFS_SKIP_SMUDGE: '1' };
  const h = (args, o = {}) => git(args, { ...o, env: { ...(o.env || {}), ...base }, ...(pre.length ? { pre } : {}) });
  h.cwd = git.cwd;
  return h;
}

// A blob a partial clone does not hold locally: with lazy fetch off git cannot read it. The same text also fits a corrupt
// full clone, so the note says "this is a partial clone" only when the config says so (partial: true).
const MISSING = /unable to read|missing (blob|object)|bad object|could not fetch|promisor|lazy fetch|unable to access|not our ref/i;
/** A path single-quoted for a POSIX shell (a ' inside becomes '\''). */
export const shQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
export const missingNote = (r, dir, partial) => (MISSING.test(r.stderr || '')
  ? `; ${partial ? 'this is a partial clone and some file contents are not downloaded' : 'if this is a partial clone, some file contents are not downloaded'}; diff-range never downloads. Run \`git -C ${shQuote(dir)} diff <base> >/dev/null\` once to fetch them, or use a full clone.`
  : '');
const noConfig = (r) => r.code === 1 && !(r.stdout || '').length && !(r.stderr || '').trim(); // exit 1 with no output: no config at all
const INCLUDE = /^include(if\..+)?\.path$/i;
const truthy = (v) => v === null || /^(true|yes|on|1)$/i.test(String(v).trim());

/** `git config --list -z --show-scope` output: scope\0key\nvalue\0 ... as [scope, key, value]. */
export function parseScopedConfigList(stdout) {
  const parts = String(stdout || '').split('\0');
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const rec = parts[i + 1];
    const nl = rec.indexOf('\n');
    out.push([parts[i], nl === -1 ? rec : rec.slice(0, nl), nl === -1 ? null : rec.slice(nl + 1)]);
  }
  return out;
}

/**
 * The whole config as [scope, key, value], read once with --no-includes. On a git without --show-scope (< 2.26): the
 * unscoped list (driver names), plus `--local` and, when extensions.worktreeConfig is true, `--worktree` for the scopes
 * that matter to the include refusal (entries from other scopes are tagged 'other').
 */
async function readScopedConfig(git) {
  const r = await git(['config', '--list', '-z', '--no-includes', '--show-scope']);
  if (r.code === 0 || noConfig(r)) return parseScopedConfigList(r.stdout);
  if (!/show-scope|unknown option|usage:/i.test(r.stderr || '')) throw fail('cannot read the git config', r);
  const all = await git(['config', '-z', '--list', '--no-includes']);
  if (all.code !== 0 && !noConfig(all)) throw fail('cannot read the git config', all);
  const rows = parseConfigList(all.stdout).map(([k, v]) => ['other', k, v]);
  const scoped = async (scope) => {
    const s = await git(['config', `--${scope}`, '--list', '-z', '--no-includes']);
    if (s.code === 0 || noConfig(s)) return parseConfigList(s.stdout).map(([k, v]) => [scope, k, v]);
    if (/not in a git (directory|repository)|outside a repository/i.test(s.stderr || '')) return [];
    throw fail('cannot read the repository config', s);
  };
  const local = await scoped('local');
  const wtc = local.find(([, k]) => k.toLowerCase() === 'extensions.worktreeconfig');
  return [...rows, ...local, ...(wtc && truthy(wtc[2]) ? await scoped('worktree') : [])];
}
const ESC = { 7: 'a', 8: 'b', 9: 't', 10: 'n', 11: 'v', 12: 'f', 13: 'r', 34: '"', 92: '\\' };

/** A path as git spells it in a diff header: C-quoted when it has a control char, `"`, `\` or a byte >= 0x80 (core.quotePath on). */
export function gitQuote(name) {
  const b = Buffer.from(name);
  if (![...b].some(c => c < 0x20 || c === 34 || c === 92 || c >= 0x7f)) return name;
  let o = '"';
  for (const c of b) o += ESC[c] ? `\\${ESC[c]}` : (c < 0x20 || c >= 0x7f) ? `\\${c.toString(8).padStart(3, '0')}` : String.fromCharCode(c);
  return `${o}"`;
}

// With core.autocrlf / eol=crlf git warns on stderr that LF will become CRLF; the diff on stdout is still right.
const BENIGN = /^warning: in the working copy of /;

export async function run(args, io = {}) {
  const f = parseArgs(args);
  if (f.help) return { usage };
  const dir = path.resolve(io.cwd || process.cwd(), f.dir || '.');
  const env = io.env || process.env;
  const timeout = f.timeout ? Number(f.timeout) : DEFAULT_TIMEOUT;
  const rawAt = io.git || defaultGit(dir, { env, timeout });
  const statics = overrideArgs([]);
  // ONE read (never run unprotected) gives both the driver names and the scopes the include refusal checks, so they agree.
  const cfg = await readScopedConfig(hardened(rawAt, statics, statics.length));
  // The repo's OWN config (.git/config, and config.worktree) must not carry an include: a driver defined in an included file could not be switched off.
  const inc = cfg.find(([scope, k]) => (scope === 'local' || scope === 'worktree') && INCLUDE.test(k));
  if (inc) {
    throw new KitExit(`the repository's own config has an include.path/includeIf entry (scope ${inc[0]}); diff-range does not follow includes because a driver defined there could not be switched off. Remove it (git config --local --unset-all include.path, or --worktree) and run diff-range again.`, 2);
  }
  const cArgs = overrideArgs(driversFromKeys(cfg.map(([, k]) => k)));
  const partial = cfg.some(([, k, v]) => (k.toLowerCase() === 'extensions.partialclone' && v) || (/^remote\..+\.promisor$/i.test(k) && truthy(v)));
  const at = hardened(rawAt, cArgs, statics.length);
  const [top] = await gitPaths(at, dir, ['toplevel'], 'cannot locate the git repository');
  const git = hardened(io.git || defaultGit(top, { env, timeout }), cArgs, statics.length);

  let base;
  let upstream = null;
  let fromUpstream = false;
  const up = await git(['rev-parse', '--verify', '-q', '@{upstream}']);
  if (up.code === 0 && up.stdout.trim()) upstream = up.stdout.trim();
  let emptyTree; // the repository's own empty-tree id, computed once
  const getEmptyTree = async () => {
    if (emptyTree) return emptyTree;
    const r = await git(['hash-object', '-t', 'tree', '/dev/null']);
    if (r.code !== 0 || !r.stdout.trim()) throw fail('cannot find the empty tree', r);
    return (emptyTree = r.stdout.trim());
  };
  if (f.base !== undefined) {
    const r = await git(['rev-parse', '--verify', '-q', `${f.base}^{commit}`]);
    if (r.code === 0 && r.stdout.trim()) base = r.stdout.trim();
    else if (f.base === EMPTY_TREE || f.base === await getEmptyTree()) base = f.base; // what --base-only prints when there is no upstream: the whole history
    else throw invalid(`--base "${f.base}" does not resolve to a commit`);
  } else if (upstream) {
    const mb = await git(['merge-base', 'HEAD', upstream]);
    if (mb.code === 0 && mb.stdout.trim()) { base = mb.stdout.trim(); fromUpstream = true; }
    else throw invalid(`no merge base with ${upstream} (shallow clone?): pass --base <ref>`);
  }
  if (!base) base = await getEmptyTree();
  if (f['base-only']) return { raw: `${base}\n` };

  const buf = (x) => (Buffer.isBuffer(x) ? x : Buffer.from(x || ''));
  const maxUntracked = f['max-untracked'] !== undefined ? Number(f['max-untracked']) : DEFAULT_MAX_UNTRACKED;
  const maxFileBytes = f['max-file-bytes'] !== undefined ? Number(f['max-file-bytes']) : DEFAULT_MAX_FILE_BYTES;
  const note = (m) => (io.stderr || process.stderr).write(`diff-range: ${m}\n`);
  const untracked = [];
  const skipped = [];
  const skippedDetail = []; // { path, reason }: nested_repository | max_untracked | too_large
  const skip = (file, reason) => { skipped.push(file); skippedDetail.push({ path: file, reason }); };
  let untrackedCount = 0;
  const candidates = []; // regular untracked files, diffed through ONE intent-to-add index
  const links = []; // untracked symlinks, written by hand below (git's own entry carries an index line the hand-written one never had)
  if (!f['no-untracked']) {
    const l = await git(['ls-files', '-z', '--others', '--exclude-standard']);
    if (l.code !== 0) throw fail('cannot list untracked files', l);
    let over = 0;
    for (const file of l.stdout.split('\0').filter(Boolean)) {
      if (file.endsWith('/')) { skip(file, 'nested_repository'); continue; } // a nested repository
      untrackedCount++;
      if (candidates.length + links.length >= maxUntracked) { skip(file, 'max_untracked'); over++; continue; }
      let st = null;
      try { st = await fs.lstat(path.join(top, file)); } catch { /* gone or unreadable: let git report it */ }
      if (st && st.isSymbolicLink()) { links.push(file); continue; }
      if (st && st.size > maxFileBytes) { skip(file, 'too_large'); note(`skipped ${file}: ${st.size} bytes is over --max-file-bytes ${maxFileBytes} (too_large)`); continue; }
      candidates.push(file);
    }
    if (over) note(`${untrackedCount} untracked files, over --max-untracked ${maxUntracked}: ${over} left out of the range (skipped, reason max_untracked); raise --max-untracked or add a .gitignore`);
  }

  // The tracked diff and every untracked regular file in ONE git diff: a temporary copy of the index gets `add -N` for the untracked
  // list (intent-to-add, so the files show as new files), the user's own index is never touched.
  const candSet = new Set(candidates);
  let parts;
  let merged = false;
  let tracked = Buffer.alloc(0);
  const diffBase = async (extra = {}) => {
    const t = await git([...DIFF, base], { binary: true, ...extra });
    if (t.code !== 0 && t.code !== 1) throw new KitExit(`${fail('cannot diff against the base', t).message}${missingNote(t, top, partial)}`, 1);
    return buf(t.stdout);
  };
  if (candidates.length) {
    const [real] = await gitPaths(git, top, [{ gitPath: 'index' }], 'cannot find the index');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diff-range-index-'));
    try {
      const tmp = path.join(tmpDir, 'index');
      try { await fs.copyFile(real, tmp); } catch (e) { if (e.code !== 'ENOENT') throw new KitExit(`cannot copy the index: ${e.message}`, 1); }
      const env = { GIT_INDEX_FILE: tmp, GIT_LITERAL_PATHSPECS: '1' };
      const add = await git(['-c', 'core.safecrlf=false', 'add', '-N', '--pathspec-from-file=-', '--pathspec-file-nul'], { env, input: Buffer.from(`${candidates.join('\0')}\0`) });
      if (add.code === 0) {
        tracked = await diffBase({ env: { GIT_INDEX_FILE: tmp } });
        parts = [tracked];
        merged = true;
      } else if (!/pathspec-from-file|pathspec-file-nul|unknown option|usage:/i.test(add.stderr || '')) {
        throw new KitExit(`${fail('cannot list the untracked files for the diff', add).message}${missingNote(add, top, partial)}`, 1);
      }
    } finally { await fs.rm(tmpDir, { recursive: true, force: true }); }
  }
  if (!merged) {
    // no untracked regular files, or a git older than 2.25 (no --pathspec-from-file): the tracked diff, then one --no-index diff per file
    tracked = await diffBase();
    parts = [tracked];
    for (const file of candidates) {
      const d = await git(['-c', 'core.safecrlf=false', ...DIFF, '--no-index', '--', '/dev/null', file], { binary: true });
      const out = buf(d.stdout);
      if (d.code > 1 || (d.code === 1 && (!out.length || (d.stderr || '').split('\n').some(l => l.trim() && !BENIGN.test(l))))) throw new KitExit(`${fail(`cannot diff untracked file ${file}`, d).message}${missingNote(d, top, partial)}`, 1);
      if (!out.length) continue;
      untracked.push(file);
      parts.push(out);
    }
  }
  for (const file of links) {
    // An untracked symlink is never followed: written in git's own shape for a mode-120000 blob.
    const target = await fs.readlink(path.join(top, file), { encoding: 'buffer' });
    untracked.push(file);
    const q = gitQuote(file);
    parts.push(Buffer.concat([Buffer.from(`diff --git ${q} ${q}\nnew file mode 120000\n--- /dev/null\n+++ ${q}${file.includes(' ') ? '\t' : ''}\n@@ -0,0 +1 @@\n+`), target, Buffer.from('\n\\ No newline at end of file\n')]));
  }
  const all = parts.length === 1 ? parts[0] : Buffer.concat(parts);
  parts = null;
  if (all.length > graphDefaults.maxDiffBytes) {
    throw new KitExit(`the review range is ${all.length} bytes, larger than the ${graphDefaults.maxDiffBytes} bytes that lenses, graph and impact accept; use --no-untracked, --max-file-bytes <n> or a .gitignore to shrink it`, 2);
  }
  // Decode once, and only when the bytes are valid UTF-8 (otherwise `raw` is the Buffer, undecoded).
  const valid = isUtf8(all);
  const text = all.toString('utf-8');
  const exit = !valid || text.trim() ? 0 : 3;
  if (f.json) {
    let trackedPaths;
    if (merged) {
      const inRange = parseDiff(text).map(x => x.path);
      for (const p of inRange) if (candSet.has(p)) untracked.push(p);
      trackedPaths = inRange.filter(p => !candSet.has(p) && !links.includes(p));
    } else trackedPaths = parseDiff(tracked.toString('utf-8')).map(x => x.path);
    return { base, upstream, from_upstream: fromUpstream, tracked: trackedPaths, untracked, untracked_count: untrackedCount, skipped, skipped_detail: skippedDetail, empty: exit === 3 };
  }
  return { raw: valid ? text : all, exit };
}
