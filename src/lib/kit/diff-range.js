/**
 * diff-range — the review range as ONE unified diff on stdout, raw text, ready for `lenses|graph|impact --diff -`.
 *
 *   diff-range [--dir <repo>] [--base <ref>] [--no-untracked] [--base-only] [--json]
 *
 * The range: tracked changes from <base> to the working tree (committed since the base plus uncommitted edits), plus
 * every untracked, not-ignored file as an added file (unless --no-untracked). <base> is --base <ref> (a commit, or the empty-tree id that --base-only prints when there is no upstream), else the merge
 * base of HEAD and @{upstream}, else the empty tree (the whole history). Paths are bare and relative to the repository
 * top. When an upstream exists but `git merge-base HEAD <upstream>` fails (a shallow clone, or a git error) the verb is exit 1
 * ("no merge base with <upstream> (shallow clone?): pass --base <ref>"); the empty-tree fallback is only for no upstream.
 * --base also accepts the repository's own empty-tree id (`git hash-object -t tree /dev/null`: SHA-1 or SHA-256) as well as the
 * SHA-1 constant. Git runs with hooks off, no external diff, no colour and no inherited GIT_* variables.
 *
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
import path from 'path';
import { KitExit } from './kit-exit.js';
import { defaultGit } from './push-gate.js';
import { gitPaths } from './git-paths.js';
import { parseDiff } from './lenses.js';

export const verb = 'diff-range';
export const usage = 'cli.js diff-range [--dir <repo>] [--base <ref>] [--no-untracked] [--base-only] [--json]   (prints the review range as one raw unified diff: '
  + 'tracked changes from the base to the working tree plus untracked files; base = --base, else the merge base with the upstream, else the empty tree; '
  + '--no-untracked leaves untracked files out, --base-only prints the resolved base, --json prints the summary (with the skipped nested repositories); '
  + 'exit 0 printed, 3 empty, 1 bad input or git failed, 2 refused)';

const BOOL_FLAGS = ['no-untracked', 'base-only', 'json', 'help'];
const VALUE_FLAGS = ['dir', 'base'];
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
  return f;
}

const fail = (what, r) => new KitExit(`${what}: ${(r.stderr || r.stdout || '').trim() || 'git failed'}`, 1);
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DIFF = ['-c', 'core.quotePath=true', 'diff', '--no-color', '--no-ext-diff', '--no-prefix'];
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
  const at = io.git || defaultGit(dir, { env });
  const [top] = await gitPaths(at, dir, ['toplevel'], 'cannot locate the git repository');
  const git = io.git || defaultGit(top, { env });

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
  const t = await git([...DIFF, base], { binary: true });
  if (t.code !== 0 && t.code !== 1) throw fail('cannot diff against the base', t);
  const tracked = buf(t.stdout);
  const parts = [tracked];
  const untracked = [];
  const skipped = [];
  if (!f['no-untracked']) {
    const l = await git(['ls-files', '-z', '--others', '--exclude-standard']);
    if (l.code !== 0) throw fail('cannot list untracked files', l);
    for (const file of l.stdout.split('\0').filter(Boolean)) {
      if (file.endsWith('/')) { skipped.push(file); continue; } // a nested repository
      let st = null;
      try { st = await fs.lstat(path.join(top, file)); } catch { /* gone or unreadable: let git report it */ }
      if (st && st.isSymbolicLink()) {
        const target = await fs.readlink(path.join(top, file), { encoding: 'buffer' });
        untracked.push(file);
        const q = gitQuote(file);
        parts.push(Buffer.concat([Buffer.from(`diff --git ${q} ${q}\nnew file mode 120000\n--- /dev/null\n+++ ${q}${file.includes(' ') ? '\t' : ''}\n@@ -0,0 +1 @@\n+`), target, Buffer.from('\n\\ No newline at end of file\n')]));
        continue;
      }
      const d = await git(['-c', 'core.safecrlf=false', ...DIFF, '--no-index', '--', '/dev/null', file], { binary: true });
      const out = buf(d.stdout);
      if (d.code > 1 || (d.code === 1 && (!out.length || (d.stderr || '').split('\n').some(l => l.trim() && !BENIGN.test(l))))) throw fail(`cannot diff untracked file ${file}`, d);
      if (!out.length) continue;
      untracked.push(file);
      parts.push(out);
    }
  }
  const all = Buffer.concat(parts);
  const text = all.toString('utf-8');
  const exit = text.trim() ? 0 : 3;
  if (f.json) {
    return { base, upstream, from_upstream: fromUpstream, tracked: parseDiff(tracked.toString('utf-8')).map(x => x.path), untracked, skipped, empty: exit === 3 };
  }
  return { raw: Buffer.from(text, 'utf-8').equals(all) ? text : all, exit };
}
