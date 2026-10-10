/**
 * Run-wide infrastructure for marathon 2026-10-10-bbs-openqodex-2: the kit CLI's verb discovery,
 * the kit plugin install, the no-egress preload used by every packaged check, and the callers count.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadVerbs } from '../src/lib/kit/cli.js';
import { installPackaged } from './helpers/packaged.js';
import { countCallers } from '../scripts/marathon-measure.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(HERE, 'helpers', 'no-egress.mjs');

describe('kit cli — verb discovery', () => {
  it('a module exporting verb + run is a verb; two modules with one verb is an error', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kit-verbs-'));
    try {
      await fs.writeFile(path.join(dir, 'a.js'), "export const verb = 'alpha'; export function run() { return { ok: 1 }; }\n");
      await fs.writeFile(path.join(dir, 'lib.js'), 'export const helper = 1;\n');
      const verbs = await loadVerbs(dir);
      assert.deepEqual([...verbs.keys()], ['alpha']);
      await fs.writeFile(path.join(dir, 'b.js'), "export const verb = 'alpha'; export function run() {}\n");
      await assert.rejects(() => loadVerbs(dir), /verb "alpha" is exported by a\.js and b\.js/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('kit — packaged install and the no-egress preload', () => {
  it('installs helpers/kit/cli.js; an unknown verb exits 1', async () => {
    const pkg = await installPackaged();
    try {
      const help = pkg.kit(['help']);
      assert.equal(help.code, 0, help.err);
      assert.ok(Array.isArray(help.json.verbs));
      assert.equal(pkg.kit(['no-such-verb']).code, 1);
      assert.deepEqual(pkg.egress(), []);
    } finally { await pkg.cleanup(); }
  });

  it('the preload refuses and logs fetch, a socket, dns and a non-allowed child process; allows local git', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kit-noegress-'));
    const log = path.join(dir, 'log.jsonl');
    try {
      const script = [
        "import net from 'net'; import dns from 'dns'; import { execFileSync, spawnSync } from 'child_process';",
        "const tries = [];",
        "try { await fetch('https://example.com'); } catch (e) { tries.push(e.code); }",
        "try { net.connect(443, 'example.com'); } catch (e) { tries.push(e.code); }",
        "try { dns.lookup('example.com', () => {}); } catch (e) { tries.push(e.code); }",
        "try { execFileSync('curl', ['https://example.com']); } catch (e) { tries.push(e.code); }",
        "try { execFileSync('git', ['ls-remote', 'https://example.com/x']); } catch (e) { tries.push(e.code); }",
        "const ok = spawnSync('git', ['--version'], { encoding: 'utf-8' });",
        "console.log(JSON.stringify({ tries, git: ok.status }));"
      ].join('\n');
      const file = path.join(dir, 's.mjs');
      await fs.writeFile(file, script);
      const r = spawnSync(process.execPath, ['--import', PRELOAD, file], { encoding: 'utf-8', env: { ...process.env, KIT_EGRESS_LOG: log } });
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.deepEqual(out.tries, Array(5).fill('EGRESS_BLOCKED'));
      assert.equal(out.git, 0, 'a local git subcommand is allowed');
      const rows = (await fs.readFile(log, 'utf-8')).split('\n').filter(Boolean);
      assert.equal(rows.length, 5);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('marathon-measure — callers', () => {
  it('counts commands and helpers that call the verb or import the module, never the module itself or cli.js', async () => {
    const c = await fs.mkdtemp(path.join(os.tmpdir(), 'kit-callers-'));
    try {
      await fs.mkdir(path.join(c, 'helpers', 'kit'), { recursive: true });
      await fs.mkdir(path.join(c, 'commands'), { recursive: true });
      await fs.mkdir(path.join(c, 'helpers', 'bbs'), { recursive: true });
      await fs.writeFile(path.join(c, 'helpers', 'kit', 'redact.js'), "export const verb = 'redact';\n");
      await fs.writeFile(path.join(c, 'helpers', 'kit', 'cli.js'), "import x from './redact.js';\n");
      await fs.writeFile(path.join(c, 'commands', 'a.md'), 'run `node .claude/helpers/kit/cli.js redact --x`\n');
      await fs.writeFile(path.join(c, 'commands', 'b.md'), 'run `node .claude/helpers/kit/cli.js redaction`\n');
      await fs.writeFile(path.join(c, 'helpers', 'bbs', 'intake.js'), "import { redact } from '../kit/redact.js';\n");
      await fs.writeFile(path.join(c, 'helpers', 'kit', 'other.js'), "import { redact } from './redact.js';\n");
      assert.deepEqual(await countCallers(c, 'redact', 'redact.js'), ['commands/a.md', 'helpers/bbs/intake.js', 'helpers/kit/other.js']);
    } finally { await fs.rm(c, { recursive: true, force: true }); }
  });
});

describe('kit — the repo dogfoods its own copy', () => {
  it('.claude/helpers/kit/ holds exactly the files of src/lib/kit/, byte for byte', async () => {
    const ROOT = path.dirname(HERE);
    const list = async (d, rel = '') => {
      const out = [];
      for (const e of await fs.readdir(path.join(d, rel), { withFileTypes: true })) {
        const r = path.join(rel, e.name);
        if (e.isDirectory()) out.push(...await list(d, r)); else out.push(r);
      }
      return out.sort();
    };
    const src = path.join(ROOT, 'src', 'lib', 'kit');
    const dog = path.join(ROOT, '.claude', 'helpers', 'kit');
    const files = await list(src);
    assert.deepEqual(await list(dog), files, 'same file list (copy src/lib/kit/. into .claude/helpers/kit/)');
    for (const f of files) assert.ok((await fs.readFile(path.join(src, f))).equals(await fs.readFile(path.join(dog, f))), `${f} equals the library`);
  });
});
