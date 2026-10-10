// A fake git < 2.31: `git rev-parse` does not know `--path-format`; it echoes such flags on stdout and exits 0.
// Everything else is passed to the real git, so the output is otherwise real (relative --git-dir/--git-common-dir).
import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';

/** Writes the fake into `dir`; returns a spawnSync-compatible `spawn(cmd, args, opts)` that runs it. */
export async function oldGitSpawn(dir) {
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf-8' }).stdout.trim();
  const script = path.join(dir, 'old-git.mjs');
  await fs.writeFile(script, `import { spawnSync } from 'child_process';
const args = process.argv.slice(2);
const echoed = args.filter(a => a.startsWith('--path-format'));
for (const a of echoed) process.stdout.write(a + '\\n');
const r = spawnSync(${JSON.stringify(realGit)}, args.filter(a => !echoed.includes(a)), { stdio: ['inherit', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
if (r.stdout) process.stdout.write(r.stdout);
process.exitCode = r.status ?? 1;
`);
  return (cmd, args, opts) => spawnSync(process.execPath, [script, ...args], opts);
}
