/**
 * The packaged check for kit verbs: install the suite into a temp project and drive the INSTALLED
 * `.claude/helpers/kit/cli.js` with the no-egress preload. Every egress attempt lands in the log.
 *
 *   const pkg = await installPackaged();
 *   const r = pkg.kit(['redact', '--secrets', 'x'], input);   // { code, out, err, json }
 *   pkg.egress()                                                // rows logged so far
 *   await pkg.cleanup();
 */
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { DaniZeeSuiteInstaller } from '../../src/installer.js';

const PRELOAD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'no-egress.mjs');

export async function installPackaged({ git = true } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kit-pkg-'));
  if (git) {
    spawnSync('git', ['init', '-q', '.'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  }
  const installer = new DaniZeeSuiteInstaller({ path: dir, force: true, withoutCookbook: true });
  const result = await installer.install();
  if (!result.success) throw new Error('suite install failed');
  const log = process.env.KIT_EGRESS_LOG || path.join(dir, '.egress.jsonl');
  const env = (extra = {}) => ({
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${PRELOAD}`.trim(),
    KIT_EGRESS_LOG: log,
    KIT_EGRESS_ALLOW_DIR: dir,
    ...extra
  });
  const cli = path.join(dir, '.claude', 'helpers', 'kit', 'cli.js');
  return {
    dir,
    cli,
    log,
    env,
    kit(args, input, { cwd = dir, extraEnv = {} } = {}) {
      const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf-8', input, env: env(extraEnv) });
      let json = null;
      try { json = JSON.parse(r.stdout); } catch {}
      return { code: r.status, out: r.stdout, err: r.stderr, json };
    },
    egress() {
      try { return fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
    },
    async cleanup() { await fsp.rm(dir, { recursive: true, force: true }); }
  };
}
