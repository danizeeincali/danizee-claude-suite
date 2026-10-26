import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run, plan, seamCheck, checkUrl, resolvePlaywright, NOT_INSTALLED } from '../src/lib/kit/frame-capture.js';
import { KitExit } from '../src/lib/kit/kit-exit.js';

const code = async (p) => { try { await p; return 0; } catch (e) { assert.ok(e instanceof KitExit, String(e)); return e.code; } };
const stdinOf = (text) => ({ stdinBytes: async ({ maxBytes }) => { const b = Buffer.from(text); return b.subarray(0, maxBytes); }, stdinIsTTY: false });

describe('frame-capture plan', () => {
  it('30 fps steps are 33,33,34 and never drift more than 1 ms', () => {
    const p = plan({ fps: 30, frames: 5 });
    assert.deepEqual(p.steps_ms.slice(0, 3), [33, 33, 34]);
    assert.deepEqual(p.frames.map((f) => f.t_ms), [0, 33, 66, 100, 133]);
  });
  for (const fps of [24, 30, 60]) {
    it(`${fps} fps: running sum within 1 ms of index*1000/fps over many frames`, () => {
      const p = plan({ fps, frames: 3000, warmup: 7 });
      let sum = 0;
      for (let i = 0; i < p.steps_ms.length; i++) {
        assert.ok(Number.isInteger(p.steps_ms[i]) && p.steps_ms[i] > 0);
        assert.ok(Math.abs(sum - (i * 1000) / fps) <= 1, `index ${i}`);
        sum += p.steps_ms[i];
      }
      assert.equal(p.steps_ms.length, 3007);
      assert.ok(Math.abs(p.mean_fps - fps) < 0.01);
    });
  }
  it('loop_t_ms = t mod loop_ms and warm-up frames are excluded', () => {
    const p = plan({ fps: 30, frames: 40, warmup: 3, loopMs: 1000 });
    assert.equal(p.frames.length, 40);
    assert.equal(p.frames[0].index, 0);
    assert.equal(p.frames[0].t_ms, 100); // frame 3 of the clock
    for (const f of p.frames) assert.equal(f.loop_t_ms, f.t_ms % 1000);
    assert.equal(p.frames[39].t_ms, 1400);
    assert.equal(p.frames[39].loop_t_ms, 400);
    assert.equal(plan({ fps: 30, frames: 2 }).frames[0].loop_t_ms, null);
  });
  it('run plan parses flags and rejects bad ones with exit 1', async () => {
    const r = await run(['plan', '--fps', '30', '--frames=3', '--loop-ms', '100'], {});
    assert.deepEqual(r.steps_ms, [33, 33, 34]);
    for (const a of [
      ['plan', '--fps', '30'], ['plan', '--fps', '0', '--frames', '3'], ['plan', '--fps', '3.5', '--frames', '3'],
      ['plan', '--fps', '30', '--frames', '3', '--fps', '24'], ['plan', '--fps', '', '--frames', '3'],
      ['plan', '--fps', '30', '--frames', '3', '--bogus', '1'], ['plan', '--fps', '30', '--frames'], ['nope'],
      ['plan', '--fps', '30', '--frames', '99999'], ['plan', 'extra'],
    ]) assert.equal(await code(run(a, {})), 1, a.join(' '));
  });
});

describe('frame-capture seam', () => {
  const good = (fps = 30, loop = 1000) => {
    const frames = plan({ fps, frames: 30, loopMs: loop }).frames;
    return { fps, loop_ms: loop, frames };
  };
  it('passes a good manifest', () => {
    const r = seamCheck(good(), 1000);
    assert.equal(r.ok, true);
    assert.deepEqual(r.findings, []);
  });
  it('flags a broken seam (one frame too many lands on the first loop time)', () => {
    const m = { fps: 30, frames: plan({ fps: 30, frames: 31, loopMs: 1000 }).frames };
    const kinds = seamCheck(m, 1000).findings.map((f) => f.kind);
    assert.ok(kinds.includes('seam'));
    assert.ok(kinds.includes('duplicate'));
  });
  it('flags a seam where the last frame falls short', () => {
    const m = good();
    m.frames.pop();
    const r = seamCheck(m, 1000);
    assert.equal(r.ok, false);
    assert.ok(r.findings.some((f) => f.kind === 'seam'));
  });
  it('flags a duplicate loop time', () => {
    const m = good();
    m.frames[10] = { ...m.frames[10], t_ms: m.frames[9].t_ms, loop_t_ms: m.frames[9].loop_t_ms };
    assert.ok(seamCheck(m, 1000).findings.some((f) => f.kind === 'duplicate'));
  });
  it('flags a missing loop time', () => {
    const m = good();
    m.frames.splice(12, 1);
    const kinds = seamCheck(m, 1000).findings.map((f) => f.kind);
    assert.ok(kinds.includes('missing'));
    const renumbered = good();
    renumbered.frames.splice(12, 1);
    renumbered.frames.forEach((f, i) => { f.index = i; });
    assert.ok(seamCheck(renumbered, 1000).findings.some((f) => f.kind === 'missing' || f.kind === 'timing'));
  });
  it('flags inconsistent loop_t_ms and rejects malformed manifests with exit 1', async () => {
    const m = good();
    m.frames[3].loop_t_ms = 5;
    assert.ok(seamCheck(m, 1000).findings.some((f) => f.kind === 'inconsistent'));
    assert.throws(() => seamCheck({ ...good(), extra: 1 }, 1000), /unknown manifest key/);
    assert.throws(() => seamCheck({ fps: 30, frames: [] }, 1000), /frames/);
    assert.throws(() => seamCheck({ fps: 30, frames: [{ index: 0, t_ms: '0', loop_t_ms: 0 }] }, 1000), /frames\[0\]\.t_ms/);
    assert.throws(() => seamCheck({ ...good(), loop_ms: 500 }, 1000), /differs/);
  });
  describe('input reading', () => {
    let dir;
    before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-seam-')); });
    after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
    it('--file and stdin give the same result', async () => {
      const text = JSON.stringify(good());
      await fs.writeFile(path.join(dir, 'm.json'), text);
      const a = await run(['seam', '--file', 'm.json', '--loop-ms', '1000'], { cwd: dir });
      const b = await run(['seam', '--loop-ms', '1000'], stdinOf('﻿' + text));
      assert.deepEqual(a, b);
      assert.equal(a.ok, true);
    });
    it('refuses empty, repeated, non-regular, /dev, /proc, over-cap and missing input', async () => {
      await fs.writeFile(path.join(dir, 'm.json'), JSON.stringify(good()));
      await fs.writeFile(path.join(dir, 'empty.json'), '');
      assert.equal(await code(run(['seam', '--file', '', '--loop-ms', '1000'], { cwd: dir })), 1);
      assert.equal(await code(run(['seam', '--file', 'm.json', '--file', 'm.json', '--loop-ms', '1000'], { cwd: dir })), 1);
      assert.equal(await code(run(['seam', '--file', 'empty.json', '--loop-ms', '1000'], { cwd: dir })), 1);
      assert.equal(await code(run(['seam', '--file', dir, '--loop-ms', '1000'], { cwd: dir })), 1);
      assert.equal(await code(run(['seam', '--file', '/dev/stdin', '--loop-ms', '1000'], { cwd: dir })), 1);
      assert.equal(await code(run(['seam', '--file', '/dev/null', '--loop-ms', '1000'], { cwd: dir })), 1);
      assert.equal(await code(run(['seam', '--file', '/proc/self/status', '--loop-ms', '1000'], { cwd: dir })), 1);
      assert.equal(await code(run(['seam', '--file', 'gone.json', '--loop-ms', '1000'], { cwd: dir })), 1);
      assert.equal(await code(run(['seam', '--file', 'm.json'], { cwd: dir })), 1);
      assert.equal(await code(run(['seam', '--loop-ms', '1000'], { stdinIsTTY: true })), 1);
      assert.equal(await code(run(['seam', '--loop-ms', '1000'], stdinOf('   '))), 1);
      assert.equal(await code(run(['seam', '--loop-ms', '1000'], stdinOf('{nope'))), 1);
    });
    it('counts the cap in bytes, not characters', async () => {
      // 3 bytes per character: 3.2M characters is under 8 MiB as a length but over it in bytes
      const text = '"' + '€'.repeat(3_000_000) + '"';
      assert.ok(text.length < 8 * 1048576 && Buffer.byteLength(text) > 8 * 1048576);
      assert.equal(await code(run(['seam', '--loop-ms', '1000'], stdinOf(text))), 1);
      await fs.writeFile(path.join(dir, 'big.json'), text);
      assert.equal(await code(run(['seam', '--file', 'big.json', '--loop-ms', '1000'], { cwd: dir })), 1);
    });
    it('a large valid manifest is checked in linear time', async () => {
      const m = { fps: 240, frames: plan({ fps: 240, frames: 20000, loopMs: 1000 }).frames };
      const t0 = Date.now();
      seamCheck(m, 1000);
      assert.ok(Date.now() - t0 < 2000);
    });
  });
});

describe('frame-capture URL refusal', () => {
  const fetches = [];
  const resolver = async () => { fetches.push('resolver'); return null; };
  for (const url of ['https://example.com', 'http://example.com', 'http://evil.localhost.example', 'http://localhost.evil.com/', 'http://localhost@evil.com/', 'http://user:pw@localhost/', 'ftp://localhost/', 'data:text/html,hi', 'javascript:alert(1)', 'file://remote-host/share/x.html', 'about:blank', 'not a url', 'http://[::1]/', 'http://127.0.0.2/']) {
    it(`refuses ${url} with exit 2 before anything is loaded`, async () => {
      fetches.length = 0;
      assert.equal(await code(run(['capture', '--url', url, '--out', 'o', '--fps', '30', '--frames', '2'], { resolvePlaywright: resolver })), 2);
      assert.deepEqual(fetches, []);
    });
  }
  it('accepts file:// and local http URLs', () => {
    for (const u of ['file:///tmp/x.html', 'http://localhost:8080/a', 'http://127.0.0.1/']) assert.ok(checkUrl(u));
  });
  it('bad flags still exit 1 before the URL is looked at', async () => {
    assert.equal(await code(run(['capture', '--url', 'https://example.com', '--out', 'o', '--fps', 'x', '--frames', '2'], {})), 1);
    assert.equal(await code(run(['capture', '--out', 'o', '--fps', '30', '--frames', '2'], {})), 1);
    assert.equal(await code(run(['capture', '--url', 'file:///x.html', '--fps', '30', '--frames', '2'], {})), 1);
    assert.equal(await code(run(['capture', '--url', 'file:///x.html', '--out', 'o', '--fps', '30', '--frames', '2', '--scale', '9'], {})), 1);
  });
});

describe('frame-capture capture', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-cap-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('playwright not installed: reason + exit 4, nothing written', async () => {
    for (const resolver of [async () => null, async () => ({})]) {
      const r = await run(['capture', '--url', 'file:///tmp/x.html', '--out', 'out', '--fps', '30', '--frames', '2'], { cwd: dir, resolvePlaywright: resolver });
      assert.deepEqual(r, { captured: 0, reason: 'playwright not installed: frame-capture capture needs it', exit: 4 });
      assert.equal(r.reason, NOT_INSTALLED);
    }
    await assert.rejects(fs.stat(path.join(dir, 'out')));
  });

  it('drives a stand-in playwright: stepped clock, paused animations, frames and manifest', async () => {
    const calls = [];
    const fakePage = {
      route: async () => {},
      clock: { install: async (o) => calls.push(['install', o.time]), pauseAt: async (t) => calls.push(['pauseAt', t]), runFor: async (ms) => calls.push(['runFor', ms]) },
      goto: async (u) => calls.push(['goto', u]),
      evaluate: async (fn, t) => calls.push(['seek', t]),
      screenshot: async () => Buffer.from('PNG' + calls.length),
    };
    let closed = false;
    const fake = { chromium: { launch: async () => ({ newContext: async (o) => { calls.push(['ctx', o.viewport.width, o.viewport.height, o.deviceScaleFactor]); return { newPage: async () => fakePage }; }, close: async () => { closed = true; } }) } };
    const out = path.join(dir, 'frames');
    const r = await run(['capture', '--url', 'file:///tmp/x.html', '--out', out, '--fps', '30', '--frames', '4', '--warmup', '1', '--loop-ms', '100', '--width', '320', '--height', '200', '--scale', '2'], { cwd: dir, resolvePlaywright: async () => fake });
    assert.equal(r.captured, 4);
    assert.ok(closed);
    assert.deepEqual(calls.filter((c) => c[0] === 'runFor').map((c) => c[1]), [33, 33, 34, 33]);
    assert.deepEqual(calls.filter((c) => c[0] === 'seek').map((c) => c[1]), [0, 33, 66, 100, 133]);
    assert.deepEqual(calls.find((c) => c[0] === 'ctx'), ['ctx', 320, 200, 2]);
    const names = (await fs.readdir(out)).sort();
    assert.deepEqual(names, ['frame-00001.png', 'frame-00002.png', 'frame-00003.png', 'frame-00004.png', 'manifest.json']);
    const man = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8'));
    assert.deepEqual(man.frames.map((f) => f.t_ms), [33, 66, 100, 133]);
    assert.deepEqual(man.frames.map((f) => f.loop_t_ms), [33, 66, 0, 33]);
    assert.equal(man.frames[0].file, 'frame-00001.png');
    assert.equal(man.warmup, 1);
  });

  it('refuses a symlinked --out', async () => {
    const real = path.join(dir, 'real'); await fs.mkdir(real);
    const link = path.join(dir, 'link'); await fs.symlink(real, link);
    const fake = { chromium: { launch: async () => { throw new Error('should not launch'); } } };
    assert.equal(await code(run(['capture', '--url', 'file:///tmp/x.html', '--out', link, '--fps', '30', '--frames', '2'], { cwd: dir, resolvePlaywright: async () => fake })), 1);
  });

  it('a browser that cannot start is a precondition (exit 4), not a crash', async () => {
    const fake = { chromium: { launch: async () => { throw new Error('Executable doesn\'t exist'); } } };
    const r = await run(['capture', '--url', 'file:///tmp/x.html', '--out', path.join(dir, 'nb'), '--fps', '30', '--frames', '2'], { cwd: dir, resolvePlaywright: async () => fake });
    assert.equal(r.captured, 0);
    assert.equal(r.exit, 4);
  });
});

// Real capture: defined only when playwright resolves from this project and its browser launches.
const pw = await resolvePlaywright(process.cwd());
let browserOk = false;
if (pw) { try { const b = await pw.chromium.launch({ headless: true }); await b.close(); browserOk = true; } catch { /* no browser in this environment */ } }
if (browserOk) {
  describe('frame-capture capture with real playwright', () => {
    let dir;
    before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-real-')); });
    after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
    it('captures N PNG frames and a manifest with each loop time', async () => {
      const page = path.join(dir, 'a.html');
      await fs.writeFile(page, '<!doctype html><style>div{width:50px;height:50px;background:red;animation:m 1s linear infinite}@keyframes m{from{margin-left:0}to{margin-left:200px}}</style><div></div>');
      const out = path.join(dir, 'out');
      const r = await run(['capture', '--url', pathToFileURL(page).href, '--out', out, '--fps', '30', '--frames', '30', '--loop-ms', '1000', '--width', '320', '--height', '120'], { cwd: dir });
      assert.equal(r.captured, 30);
      const man = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8'));
      assert.equal(man.frames.length, 30);
      assert.equal(seamCheck(man, 1000).ok, true);
      const png = await fs.readFile(path.join(out, 'frame-00001.png'));
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      const mid = await fs.readFile(path.join(out, 'frame-00016.png'));
      assert.notDeepEqual(png, mid, 'the animation advanced between frame 1 and frame 16');
      const again = path.join(dir, 'again');
      await run(['capture', '--url', pathToFileURL(page).href, '--out', again, '--fps', '30', '--frames', '30', '--loop-ms', '1000', '--width', '320', '--height', '120'], { cwd: dir });
      assert.deepEqual(await fs.readFile(path.join(again, 'frame-00016.png')), mid, 'repeatable');
    });
  });
}
