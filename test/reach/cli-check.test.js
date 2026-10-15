// Reach test: `danizee-claude-suite check` (bin/cli.js, the "check" command) runs the doctor checks and its exit
// status follows the kit exit-code contract (0 clean, 1 usage, 4 a fatal prerequisite is missing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = path.join(root, 'bin', 'cli.js');
const shim = path.join(root, 'test', 'fixtures', 'offline-deps', 'register.mjs');

function project(withKit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-check-'));
  if (withKit) {
    fs.mkdirSync(path.join(dir, '.claude', 'helpers', 'kit'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'helpers', 'kit', 'cli.js'), '// stub\n');
  }
  return dir;
}

// The shim only stands in for commander/chalk/ora when they are not installed.
function depsResolve() {
  try { const req = createRequire(cli); for (const d of ['commander', 'chalk', 'ora']) req.resolve(d); return true; } catch { return false; }
}
const preload = depsResolve() ? [] : ['--import', shim]; // --import needs Node 20.6+: only used when the real deps are absent

function check(dir, ...args) {
  const r = spawnSync(process.execPath, [...preload, cli, 'check', '--path', dir, ...args], { cwd: dir, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('check runs the doctor checks and exits 0 when no fatal check fails', () => {
  const dir = project(true);
  const r = check(dir);
  assert.match(r.out, /Doctor checks \(kit\)/);
  assert.match(r.out, /node-version/);
  assert.match(r.out, /file:\.claude\/helpers\/kit\/cli\.js/);
  assert.equal(r.code, 0, r.out);
});

test('check exits with the missing-prerequisite code (4) on a fatal doctor check', () => {
  const dir = project(false);
  const r = check(dir);
  assert.match(r.out, /Fatal: file:\.claude\/helpers\/kit\/cli\.js/);
  assert.match(r.out, /fix: /);
  assert.equal(r.code, 4, r.out);
});

test('check exits with the usage code (1) on an unknown profile', () => {
  const dir = project(true);
  const r = check(dir, '--profile', 'nope');
  assert.match(r.out, /unknown profile/);
  assert.equal(r.code, 1, r.out);
});

test('check loads .claude/kit/doctor.json: a fatal custom check that fails exits 4', () => {
  const dir = project(true);
  fs.mkdirSync(path.join(dir, '.claude', 'kit'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'kit', 'doctor.json'), JSON.stringify({ checks: [{ name: 'needs-token', kind: 'env', target: 'CLI_CHECK_TEST_TOKEN_ABSENT', fatal: true }] }));
  const r = check(dir);
  assert.match(r.out, /needs-token/);
  assert.match(r.out, /Fatal: needs-token/);
  assert.equal(r.code, 4, r.out);
});

test('check exits with the usage code (1) on an invalid doctor.json', () => {
  const dir = project(true);
  fs.mkdirSync(path.join(dir, '.claude', 'kit'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'kit', 'doctor.json'), '{ not json');
  const r = check(dir);
  assert.match(r.out, /not valid JSON/);
  assert.equal(r.code, 1, r.out);
});
