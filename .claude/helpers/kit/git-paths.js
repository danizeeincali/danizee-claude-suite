/**
 * Shared helper (no verb): absolute git paths from `git rev-parse` WITHOUT `--path-format`.
 * Git < 2.31 does not know `--path-format`; it echoes the flag on stdout and exits 0, so a caller would read the
 * flag text as a path. Instead we ask for plain `--show-toplevel` / `--git-dir` / `--git-common-dir` /
 * `--git-path <name>` and resolve each line against the cwd git ran in (all git versions print these relative to it).
 *
 * A query is 'toplevel' | 'gitDir' | 'commonDir' | { gitPath: '<name>' }.
 */

import path from 'path';
import { KitExit } from './kit-exit.js';

const FLAG = { toplevel: '--show-toplevel', gitDir: '--git-dir', commonDir: '--git-common-dir' };

/** The `git rev-parse ...` argv for these queries. */
export function revParseArgs(queries) {
  const args = ['rev-parse'];
  for (const q of queries) {
    if (q && typeof q === 'object' && typeof q.gitPath === 'string') args.push('--git-path', q.gitPath);
    else if (FLAG[q]) args.push(FLAG[q]);
    else throw new Error(`unknown git path query ${JSON.stringify(q)}`);
  }
  return args;
}

/**
 * rev-parse stdout → absolute paths, one per query. Throws KitExit 1 unless there is exactly one non-empty line per
 * query and none looks like an echoed flag (a line starting with "-"), so odd output never becomes a path.
 */
export function resolveRevParse(cwd, queries, stdout) {
  const lines = String(stdout || '').split('\n').map(s => s.replace(/\r$/, '')).filter(s => s !== '');
  if (lines.length !== queries.length || lines.some(l => l.startsWith('-'))) {
    const first = (lines[0] || '(empty)').slice(0, 200);
    throw new KitExit(`unexpected git rev-parse output (got ${lines.length} line(s), wanted ${queries.length}; first: ${first})`, 1);
  }
  return lines.map(l => path.resolve(cwd, l));
}

/**
 * Run rev-parse through `exec(args)` → `{ code, stdout, stderr }` (sync or async) and return the absolute paths.
 * `what` names the failure in the KitExit message.
 */
export async function gitPaths(exec, cwd, queries, what = 'cannot locate the git directory') {
  const r = await exec(revParseArgs(queries));
  if (r.code !== 0) throw new KitExit(`${what}: ${(r.stderr || r.stdout || '').trim() || 'git failed'}`, 1);
  return resolveRevParse(cwd, queries, r.stdout);
}
