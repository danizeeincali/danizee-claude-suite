import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
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
    const fake = { chromium: { launch: async () => ({ newContext: async (o) => { calls.push(['ctx', o.viewport.width, o.viewport.height, o.deviceScaleFactor]); return { route: async () => {}, routeWebSocket: async () => {}, newPage: async () => fakePage }; }, close: async () => { closed = true; } }) } };
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

// A stand-in playwright that records the launch options, the context options and the context-level route handlers.
// The page has no route(): egress must be guarded on the context, so popups are covered too.
function fakePlaywright({ animations } = {}) {
  const rec = { launch: null, ctxOpts: null, route: null, ws: null, closed: false };
  const page = {
    clock: { install: async () => {}, pauseAt: async () => {}, runFor: async () => {} },
    goto: async () => {},
    evaluate: async (fn, t) => {
      if (!animations) return;
      const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
      globalThis.document = { getAnimations: () => animations(t) };
      try { fn(t); } finally { if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document; }
    },
    screenshot: async () => Buffer.from('PNG'),
  };
  const ctx = {
    route: async (pat, h) => { rec.route = [pat, h]; },
    routeWebSocket: async (pat, h) => { rec.ws = [pat, h]; },
    newPage: async () => { if (!rec.route) throw new Error('page opened before the context route was set'); return page; },
  };
  const pw = { chromium: { launch: async (o) => { rec.launch = o; return { newContext: async (o2) => { rec.ctxOpts = o2; return ctx; }, close: async () => { rec.closed = true; } }; } } };
  return { rec, pw };
}

describe('frame-capture capture review r1', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-r1-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const cap = (pw, out, extra = []) => run(['capture', '--url', 'file:///tmp/x.html', '--out', out, '--fps', '30', ...extra], { cwd: dir, resolvePlaywright: async () => pw });

  it('blocks egress at the browser and context level: resolver rules, no proxy, no service workers, context routes', async () => {
    const { rec, pw } = fakePlaywright();
    await cap(pw, path.join(dir, 'eg'), ['--frames', '2']);
    assert.ok(rec.launch.args.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'), JSON.stringify(rec.launch));
    assert.ok(rec.launch.args.includes('--no-proxy-server'));
    assert.equal(rec.ctxOpts.serviceWorkers, 'block');
    assert.equal(rec.route[0], '**/*');
    const verdict = async (url) => {
      let v = null;
      await rec.route[1]({ request: () => ({ url: () => url }), continue: async () => { v = 'continue'; }, abort: async () => { v = 'abort'; }, fulfill: async () => { v = 'fulfill'; } });
      return v;
    };
    for (const u of ['https://example.com/x', 'http://blocked.invalid/redirect-target', 'http://localhost.evil.com/', 'http://127.0.0.2/', 'http://user@localhost/']) assert.equal(await verdict(u), 'abort', u);
    for (const u of ['file:///tmp/x.html', 'http://127.0.0.1:8080/a.css', 'http://localhost/b.js']) assert.equal(await verdict(u), 'continue', u);
    const sock = async (url) => {
      let v = null;
      await rec.ws[1]({ url: () => url, connectToServer: () => { v = 'connect'; }, close: async () => { v = 'close'; } });
      return v;
    };
    for (const u of ['wss://example.com/s', 'ws://blocked.invalid/', 'ws://user@localhost/', 'ws://127.0.0.2/']) assert.equal(await sock(u), 'close', u);
    for (const u of ['ws://127.0.0.1:8080/s', 'ws://localhost/s']) assert.equal(await sock(u), 'connect', u);
  });

  it('a capture without --loop-ms writes a manifest that seam accepts', async () => {
    const { pw } = fakePlaywright();
    const out = path.join(dir, 'noloop');
    assert.equal((await cap(pw, out, ['--frames', '30'])).captured, 30);
    const r = await run(['seam', '--file', path.join(out, 'manifest.json'), '--loop-ms', '1000'], { cwd: dir });
    assert.equal(r.ok, true);
    assert.deepEqual(r.findings, []);
    const off = await run(['seam', '--file', path.join(out, 'manifest.json'), '--loop-ms', '900'], { cwd: dir });
    assert.equal(off.ok, false);
    assert.ok(off.findings.some((f) => f.kind === 'seam'));
  });

  it('capturing twice into the same --out leaves only the new frames', async () => {
    const out = path.join(dir, 'twice');
    assert.equal((await cap(fakePlaywright().pw, out, ['--frames', '6'])).captured, 6);
    await fs.writeFile(path.join(out, 'notes.txt'), 'mine');
    assert.equal((await cap(fakePlaywright().pw, out, ['--frames', '3'])).captured, 3);
    assert.deepEqual((await fs.readdir(out)).sort(), ['frame-00001.png', 'frame-00002.png', 'frame-00003.png', 'manifest.json', 'notes.txt']);
    const man = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8'));
    assert.deepEqual(man.frames.map((f) => f.file), ['frame-00001.png', 'frame-00002.png', 'frame-00003.png']);
  });

  it('an animation that starts after load is seeked from its own start, not from page load', async () => {
    const set = [];
    const mk = (name) => { const a = { pause() {} }; Object.defineProperty(a, 'currentTime', { get: () => null, set: (v) => set.push([name, v]) }); return a; };
    const early = mk('early');
    const late = mk('late');
    const { pw } = fakePlaywright({ animations: (t) => (t >= 100 ? [early, late] : [early]) });
    assert.equal((await cap(pw, path.join(dir, 'late'), ['--frames', '6'])).captured, 6);
    assert.deepEqual(set.filter((s) => s[0] === 'early').map((s) => s[1]), [0, 33, 66, 100, 133, 166]);
    assert.deepEqual(set.filter((s) => s[0] === 'late').map((s) => s[1]), [0, 33, 66]);
  });
});

if (browserOk) {
  describe('frame-capture capture egress with real playwright (local server only; blocked.invalid is a reserved name)', () => {
    let dir, server, port;
    const hits = [];
    const finals = ['redirect', 'direct', 'fetch', 'ws'];
    let release;
    const allIn = new Promise((r) => { release = r; });
    const HTML = `<!doctype html><body><div style="width:20px;height:20px;background:red"></div>
<script>
const sent = new Set();
const b = (p) => { if (sent.has(p)) return; sent.add(p); fetch('/beacon/' + p).catch(() => {}); };
</script>
<img src="/redir" onload="b('redirect-loaded')" onerror="b('redirect-blocked')">
<img src="http://blocked.invalid/x.png" onload="b('direct-loaded')" onerror="b('direct-blocked')">
<script>
fetch('http://blocked.invalid/f').then(() => b('fetch-ok'), () => b('fetch-blocked'));
try {
  const ws = new WebSocket('ws://blocked.invalid/s');
  ws.onopen = () => b('ws-open');
  ws.onmessage = () => b('ws-message');
  ws.onclose = () => b('ws-closed');
  ws.onerror = () => b('ws-error');
} catch (e) { b('ws-closed'); }
</script>
<img src="/hold">`;
    before(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-egress-'));
      server = http.createServer((req, res) => {
        hits.push({ path: req.url, host: req.headers.host });
        if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HTML); return; }
        if (req.url === '/redir') { res.writeHead(302, { location: 'http://blocked.invalid/redirected.png' }); res.end(); return; }
        if (req.url === '/hold') {
          // Hold the load event until every check has reported, so the capture sees them all.
          const done = () => { if (!res.writableEnded) { res.writeHead(204); res.end(); } };
          const t = setTimeout(done, 8000);
          allIn.then(() => { clearTimeout(t); done(); });
          return;
        }
        res.writeHead(204); res.end();
        if (finals.every((w) => hits.some((h) => h.path.startsWith(`/beacon/${w}-`)))) release();
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      port = server.address().port;
    });
    after(async () => { await new Promise((r) => server.close(r)); await fs.rm(dir, { recursive: true, force: true }); });

    it('a local page that requests, redirects to and opens a socket to a non-local host never reaches it', async () => {
      const r = await run(['capture', '--url', `http://127.0.0.1:${port}/`, '--out', path.join(dir, 'out'), '--fps', '30', '--frames', '3', '--width', '120', '--height', '60'], { cwd: dir });
      assert.equal(r.captured, 3);
      const paths = hits.map((h) => h.path);
      assert.ok(paths.includes('/redir'), JSON.stringify(paths));
      for (const p of ['redirect-blocked', 'direct-blocked', 'fetch-blocked', 'ws-closed']) assert.ok(paths.includes(`/beacon/${p}`), `${p}: ${JSON.stringify(paths)}`);
      for (const p of ['redirect-loaded', 'direct-loaded', 'fetch-ok', 'ws-open', 'ws-message']) assert.ok(!paths.includes(`/beacon/${p}`), `${p}: ${JSON.stringify(paths)}`);
      assert.ok(hits.every((h) => h.host === `127.0.0.1:${port}`), JSON.stringify(hits));
    });
  });
}

describe('frame-capture capture review r2', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-r2-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const cap = (pw, out, extra = []) => run(['capture', '--url', 'file:///tmp/x.html', '--out', out, '--fps', '30', ...extra], { cwd: dir, resolvePlaywright: async () => pw });
  const exists = (p) => fs.stat(p).then(() => true, () => false);

  it('HTTP error status exits 1 and writes nothing', async () => {
    const { pw } = fakePlaywright();
    const orig = pw.chromium.launch;
    pw.chromium.launch = async (o) => {
      const b = await orig(o);
      const nc = b.newContext;
      b.newContext = async (o2) => { const c = await nc(o2); const np = c.newPage; c.newPage = async () => { const pg = await np(); pg.goto = async () => ({ ok: () => false, status: () => 404 }); return pg; }; return c; };
      return b;
    };
    const out = path.join(dir, 'http404');
    assert.equal(await code(cap(pw, out, ['--frames', '2'])), 1);
    assert.equal(await exists(out), false);
  });

  it('rejected goto is a one-line KitExit 1 naming the URL and leaves no --out', async () => {
    const { pw } = fakePlaywright();
    const orig = pw.chromium.launch;
    pw.chromium.launch = async (o) => {
      const b = await orig(o);
      const nc = b.newContext;
      b.newContext = async (o2) => { const c = await nc(o2); const np = c.newPage; c.newPage = async () => { const pg = await np(); pg.goto = async () => { throw new Error('net::ERR_FILE_NOT_FOUND\nat x'); }; return pg; }; return c; };
      return b;
    };
    const out = path.join(dir, 'gotofail');
    await assert.rejects(cap(pw, out, ['--frames', '2']), (e) => e instanceof KitExit && e.code === 1 && e.message.includes('file:///tmp/x.html') && !e.message.includes('\n'));
    assert.equal(await exists(out), false);
  });

  it('a failed second capture leaves no manifest and no old frames', async () => {
    const out = path.join(dir, 'partial');
    await cap(fakePlaywright().pw, out, ['--frames', '3']);
    assert.ok(await exists(path.join(out, 'manifest.json')));
    const { pw } = fakePlaywright();
    const orig = pw.chromium.launch;
    pw.chromium.launch = async (o) => {
      const b = await orig(o);
      const nc = b.newContext;
      b.newContext = async (o2) => { const c = await nc(o2); const np = c.newPage; c.newPage = async () => { const pg = await np(); let n = 0; pg.screenshot = async () => { if (++n === 2) throw new Error('crash'); return Buffer.from('NEW'); }; return pg; }; return c; };
      return b;
    };
    await assert.rejects(cap(pw, out, ['--frames', '3']));
    assert.equal(await exists(path.join(out, 'manifest.json')), false);
    assert.equal(await exists(path.join(out, 'frame-00003.png')), false);
  });

  it('old playwright without routeWebSocket or page.clock is exit 4', async () => {
    const a = fakePlaywright();
    const o1 = a.pw.chromium.launch;
    a.pw.chromium.launch = async (o) => { const b = await o1(o); const nc = b.newContext; b.newContext = async (x) => { const c = await nc(x); delete c.routeWebSocket; return c; }; return b; };
    const r1 = await cap(a.pw, path.join(dir, 'old1'), ['--frames', '2']);
    assert.deepEqual([r1.captured, r1.exit, r1.reason], [0, 4, 'playwright >= 1.48 required']);
    const b = fakePlaywright();
    const o2 = b.pw.chromium.launch;
    b.pw.chromium.launch = async (o) => { const br = await o2(o); const nc = br.newContext; br.newContext = async (x) => { const c = await nc(x); const np = c.newPage; c.newPage = async () => { const pg = await np(); delete pg.clock; return pg; }; return c; }; return br; };
    const r2 = await cap(b.pw, path.join(dir, 'old2'), ['--frames', '2']);
    assert.deepEqual([r2.captured, r2.exit], [0, 4]);
    assert.equal(b.rec.closed, true);
  });
});

describe('frame-capture integration fixes (group D)', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-d-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const mk = (pageOver = {}) => {
    const rec = {};
    const page = {
      clock: { install: async () => {}, pauseAt: async () => {}, runFor: async () => {} },
      goto: async () => ({ ok: () => true, status: () => 200 }),
      evaluate: async () => {},
      screenshot: async () => Buffer.from('PNG'),
      ...pageOver,
    };
    const ctx = { route: async (p, h) => { rec.route = h; }, routeWebSocket: async (p, h) => { rec.ws = h; }, newPage: async () => page };
    const pw = { chromium: { launch: async () => ({ newContext: async () => ctx, close: async () => { rec.closed = true; } }) } };
    return { rec, pw };
  };
  const cap = (pw, extra = []) => run(['capture', '--url', 'file:///tmp/x.html', '--out', path.join(dir, 'o' + Math.random().toString(36).slice(2)), '--fps', '30', ...(extra.includes('--frames') ? [] : ['--frames', '3']), ...extra], { cwd: dir, resolvePlaywright: async () => pw });

  it('a failing or stalled per-frame call becomes a one-line exit 1 naming the frame', async () => {
    for (const [what, over] of [
      ['screenshot', { screenshot: async () => { throw new Error('Timeout 30000ms exceeded.\n  - waiting for fonts'); } }],
      ['evaluate', { evaluate: async () => { throw new Error('Target closed'); } }],
      ['runFor', { clock: { install: async () => {}, pauseAt: async () => {}, runFor: async () => { throw new Error('clock gone'); } } }],
    ]) {
      const { rec, pw } = mk(over);
      await assert.rejects(cap(pw), (e) => e instanceof KitExit && e.code === 1 && /frame \d+ of 3/.test(e.message) && !e.message.includes('\n'), what);
      assert.equal(rec.closed, true);
    }
  });

  it('reports the blocked non-local origins in the result', async () => {
    const { rec, pw } = mk({
      screenshot: async () => {
        await rec.route({ request: () => ({ url: () => 'https://cdn.blocked.invalid/a.png?x=1' }), continue: async () => {}, abort: async () => {} });
        await rec.route({ request: () => ({ url: () => 'http://127.0.0.1:9/ok.css' }), continue: async () => {}, abort: async () => {} });
        await rec.ws({ url: () => 'wss://sock.blocked.invalid/s', connectToServer: () => {}, close: async () => {} });
        return Buffer.from('PNG');
      },
    });
    const r = await cap(pw, ['--frames', '2']);
    assert.deepEqual(r.blocked_origins, ['https://cdn.blocked.invalid', 'wss://sock.blocked.invalid']);
    const clean = await cap(mk().pw, ['--frames', '2']);
    assert.deepEqual(clean.blocked_origins, []);
  });

  // A stand-in `playwright` without a chromium, so a globally installed one cannot answer first.
  const stub = async (proj) => {
    const d = path.join(proj, 'node_modules', 'playwright');
    await fs.mkdir(d, { recursive: true });
    await fs.writeFile(path.join(d, 'package.json'), JSON.stringify({ name: 'playwright', version: '1.0.0', main: 'index.js' }));
    await fs.writeFile(path.join(d, 'index.js'), 'module.exports = {};\n');
  };
  it('falls back to @playwright/test and playwright-core when playwright is not installed', async () => {
    for (const name of ['@playwright/test', 'playwright-core']) {
      const proj = path.join(dir, 'proj-' + name.replace(/\W/g, '_'));
      const nm = path.join(proj, 'node_modules', ...name.split('/'));
      await fs.mkdir(nm, { recursive: true });
      await stub(proj);
      await fs.writeFile(path.join(nm, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
      await fs.writeFile(path.join(nm, 'index.js'), "module.exports = { chromium: { marker: '" + name + "' } };\n");
      const mod = await resolvePlaywright(proj);
      assert.ok(mod && mod.chromium && mod.chromium.marker === name, name);
    }
    const empty = path.join(dir, 'empty');
    await stub(empty);
    assert.equal(await resolvePlaywright(empty), null);
  });
});
