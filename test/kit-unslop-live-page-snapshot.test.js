import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync, execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import * as ps from '../src/lib/kit/page-snapshot.js';
import { resolvePlaywright, LAUNCH_ARGS } from '../src/lib/kit/frame-capture.js';
import { KitExit } from '../src/lib/kit/kit-exit.js';

const { run, plan, transformHtml, transformCss, scanHtml, forceScheme, absolutizeUrl, inlineAsset, makeBudget, buildSnapshot, allowRequest, classifyUrl } = ps;
const { isPrivateHost, isPrivateAddress, hostVerdict, resolvePending, blockedOrigin, EMBEDDING } = ps;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const code = async (p) => { try { await p; return 0; } catch (e) { assert.ok(e instanceof KitExit, String(e)); return e.code; } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// A valid w x h RGB PNG of incompressible pixels (so its size is predictable and above a small cap).
function noisePng(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let seed = 12345;
  for (let i = 0; i < raw.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; raw[i] = (seed >> 16) & 255; }
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
const spyResolver = () => { const s = { resolved: 0, launched: 0 }; s.fn = async () => { s.resolved++; return { chromium: { launch: async () => { s.launched++; throw new Error('must not launch'); } } }; }; return s; };

describe('page-snapshot header contract', () => {
  const src = readFileSync(path.join(ROOT, 'src/lib/kit/page-snapshot.js'), 'utf-8');
  const header = src.slice(0, src.indexOf('*/'));
  it('plan output has exactly the documented fields', () => {
    const got = Object.keys(plan({ url: 'file:///x.html' }));
    for (const f of ['url', 'local', 'needs_consent', 'out_files', 'viewport', 'next']) assert.ok(header.includes(f), f);
    assert.deepEqual(got.sort(), ['local', 'needs_consent', 'next', 'out_files', 'url', 'viewport']);
  });
  it('documents exit codes 0 1 2 4 and the files it writes', () => {
    for (const c of ['0', '1', '2', '4']) assert.match(header, new RegExp(`(Exit codes: |· )${c} `));
    for (const f of ['page.html', 'screenshot.png', 'manifest.json', 'snapshot-source', '2 MiB', '20 MiB', '--allow-remote', '--full-page', '--theme']) assert.ok(header.includes(f), f);
    assert.ok(header.endsWith('no foreign code.\n '), 'last line');
  });
  it('the installed helper is byte-identical', async () => {
    assert.deepEqual(await fs.readFile(path.join(ROOT, '.claude/helpers/kit/page-snapshot.js')), await fs.readFile(path.join(ROOT, 'src/lib/kit/page-snapshot.js')));
  });
});

describe('page-snapshot plan', () => {
  it('file and localhost URLs are local and need no consent', async () => {
    for (const u of ['file:///tmp/a.html', 'http://localhost:3000/', 'http://127.0.0.1:8080/x?y=1', 'https://localhost/']) {
      const p = await run(['plan', '--url', u]);
      assert.equal(p.local, true, u);
      assert.equal(p.needs_consent, false);
      assert.deepEqual(p.out_files, ['page.html', 'screenshot.png', 'manifest.json']);
    }
  });
  it('a live URL needs consent; --out prefixes the files', async () => {
    const p = await run(['plan', '--url', 'https://example.com/pricing', '--out', 'snap']);
    assert.equal(p.local, false);
    assert.equal(p.needs_consent, true);
    assert.deepEqual(p.out_files, ['snap/page.html', 'snap/screenshot.png', 'snap/manifest.json']);
    assert.match(p.next, /--allow-remote/);
    assert.equal((await run(['plan', '--url', 'http://localhost.evil.com/'])).needs_consent, true);
    assert.equal((await run(['plan', '--url', 'http://127.0.0.1.nip.io/'])).needs_consent, true);
  });
  it('bad input exits 1, disallowed schemes and credentials exit 2', async () => {
    assert.equal(await code(run(['plan'])), 1);
    assert.equal(await code(run(['plan', '--url', 'not a url'])), 1);
    assert.equal(await code(run(['plan', '--url', 'a', '--url', 'b'])), 1);
    assert.equal(await code(run(['plan', '--url', ''])), 1);
    assert.equal(await code(run(['plan', '--url', 'file:///x', '--nope', '1'])), 1);
    assert.equal(await code(run(['plan', '--constructor', 'x'])), 1);
    assert.equal(await code(run(['plan', 'stray'])), 1);
    assert.equal(await code(run(['plan', '--url', 'ftp://example.com/a'])), 2);
    assert.equal(await code(run(['plan', '--url', 'javascript:alert(1)'])), 2);
    assert.equal(await code(run(['plan', '--url', 'https://user:pw@example.com/'])), 2);
    assert.equal(await code(run(['plan', '--url', 'file://host/share/x.html'])), 2);
  });
  it('help and unknown subcommands', async () => {
    assert.ok((await run([])).usage);
    assert.ok((await run(['capture', '--help'])).usage);
    assert.equal(await code(run(['nope'])), 1);
  });
});

describe('page-snapshot URL policy', () => {
  for (const u of ['https://example.com/', 'http://192.168.1.5/', 'http://localhost.evil.com/', 'ftp://x/y', 'https://user:p@localhost/']) {
    it(`refuses ${u} without --allow-remote or at all: exit 2, no resolver call, no launch, nothing written`, async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-pol-'));
      try {
        const spy = spyResolver();
        const extra = u.startsWith('ftp') || u.includes('@') ? ['--allow-remote'] : [];
        assert.equal(await code(run(['capture', '--url', u, '--out', 'o', ...extra], { cwd: dir, resolvePlaywright: spy.fn })), 2);
        assert.deepEqual([spy.resolved, spy.launched], [0, 0]);
        await assert.rejects(fs.stat(path.join(dir, 'o')));
      } finally { await fs.rm(dir, { recursive: true, force: true }); }
    });
  }
  it('with --allow-remote a remote http(s) URL passes the policy, reaches the launcher, and a failed launch is exit 4', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-rl-'));
    try {
      const spy = spyResolver();
      // the spy launcher throws: capture reports it as a browser that could not start (it resolves, it does not reject)
      const r = await run(['capture', '--url', 'https://example.com/', '--out', 'o', '--allow-remote'], { cwd: dir, resolvePlaywright: spy.fn });
      assert.deepEqual(r, { captured: false, reason: 'playwright browser could not start: must not launch', exit: 4 });
      assert.deepEqual([spy.resolved, spy.launched], [1, 1]);
      await assert.rejects(fs.stat(path.join(dir, 'o')), { code: 'ENOENT' });
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('classifyUrl and allowRequest', () => {
    assert.equal(classifyUrl('file:///a/b.html').local, true);
    assert.equal(classifyUrl('https://example.com').local, false);
    assert.equal(allowRequest('data:image/png;base64,AA', 'local'), true);
    assert.equal(allowRequest('http://127.0.0.1:9/x', 'local'), true);
    assert.equal(allowRequest('https://example.com/x', 'local'), false);
    assert.equal(allowRequest('file:///x.png', 'local', 'file:'), true);
    assert.equal(allowRequest('file:///x.png', 'local', 'http:'), false);
    assert.equal(allowRequest('file:///x.png', 'remote'), false);
    assert.equal(allowRequest('https://cdn.example.com/x.css', 'remote'), true);
    assert.equal(allowRequest('wss://example.com/', 'remote'), false);
    assert.equal(allowRequest('garbage', 'remote'), false);
  });
});

describe('page-snapshot flags and path handling', () => {
  const base = ['capture', '--url', 'file:///tmp/x.html', '--out', 'o'];
  it('bad flags exit 1 before anything else', async () => {
    const spy = spyResolver();
    const io = { resolvePlaywright: spy.fn };
    for (const extra of [['--width', 'x'], ['--width', '5'], ['--height', '99999'], ['--theme', 'blue'], ['--full-page=yes'], ['--full-page', '--full-page'], ['--allow-remote=1'], ['--timeout-ms', '10'], ['--max-asset-bytes', '0'], ['--bogus', '1'], ['--out', 'again'], ['--width']]) {
      assert.equal(await code(run([...base, ...extra], io)), 1, extra.join(' '));
    }
    assert.equal(await code(run(['capture', '--out', 'o'], io)), 1);
    assert.equal(await code(run(['capture', '--url', 'file:///x.html'], io)), 1);
    assert.equal(spy.resolved, 0);
  });
  it('playwright missing: reason and exit 4, nothing written', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-nopw-'));
    try {
      for (const resolver of [async () => null, async () => ({})]) {
        const r = await run([...base], { cwd: dir, resolvePlaywright: resolver });
        assert.deepEqual(r, { captured: false, reason: 'playwright not installed: page-snapshot capture needs it', exit: 4 });
      }
      assert.deepEqual(await fs.readdir(dir), []);
      const r = await run([...base], { cwd: dir, resolvePlaywright: async () => ({ chromium: { launch: async () => { throw new Error('no browser here\nmore'); } } }) });
      assert.equal(r.exit, 4);
      assert.match(r.reason, /could not start: no browser here$/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('--out that is a symlink or a file is refused with exit 1 before launch', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-out-'));
    try {
      const spy = spyResolver();
      await fs.mkdir(path.join(dir, 'real'));
      await fs.symlink(path.join(dir, 'real'), path.join(dir, 'link'));
      await fs.writeFile(path.join(dir, 'afile'), 'x');
      for (const o of ['link', 'afile']) assert.equal(await code(run(['capture', '--url', 'file:///tmp/x.html', '--out', o], { cwd: dir, resolvePlaywright: spy.fn })), 1);
      assert.equal(spy.launched, 0);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('local pages launch with the egress-blocking args; remote pages get only --no-proxy-server; the context is fresh', async () => {
    const seen = [];
    const mk = () => ({ chromium: { launch: async (o) => ({ close: async () => {}, newContext: async (c) => { seen.push({ launch: o, ctx: c }); throw new Error('stop'); } }) } });
    await assert.rejects(run(['capture', '--url', 'http://127.0.0.1:9/', '--out', '/tmp/ps-never', '--width', '800', '--theme', 'dark'], { resolvePlaywright: async () => mk() }), /stop/);
    await assert.rejects(run(['capture', '--url', 'https://example.com/', '--out', '/tmp/ps-never', '--allow-remote'], { resolvePlaywright: async () => mk() }), /stop/);
    assert.deepEqual(seen[0].launch.args, [...LAUNCH_ARGS]);
    // remote mode connects directly (no proxy) so the address the browser reached can be checked; no local resolver rules
    assert.deepEqual(seen[1].launch.args, ['--no-proxy-server']);
    assert.ok(!seen[1].launch.args.some((x) => x.startsWith('--host-resolver-rules')));
    for (const s of seen) {
      assert.equal(s.ctx.serviceWorkers, 'block');
      assert.equal(s.ctx.acceptDownloads, false);
      assert.deepEqual(s.ctx.permissions, []);
      assert.equal(s.ctx.storageState, undefined);
      assert.equal(s.ctx.httpCredentials, undefined);
    }
    assert.equal(seen[0].ctx.viewport.width, 800);
    assert.equal(seen[0].ctx.colorScheme, 'dark');
    assert.equal(seen[1].ctx.viewport.width, 1440);
    assert.equal(seen[1].ctx.viewport.height, 900);
    assert.equal(seen[1].ctx.colorScheme, undefined);
  });
});

describe('page-snapshot string rewriting', () => {
  const base = 'https://site.test/dir/page.html';
  it('absolutizeUrl keeps data, fragments and mailto, resolves the rest', () => {
    assert.equal(absolutizeUrl('a.png', base), 'https://site.test/dir/a.png');
    assert.equal(absolutizeUrl('/x', base), 'https://site.test/x');
    assert.equal(absolutizeUrl('//cdn.test/y', base), 'https://cdn.test/y');
    assert.equal(absolutizeUrl('#top', base), '#top');
    assert.equal(absolutizeUrl('data:image/png;base64,AA', base), 'data:image/png;base64,AA');
    assert.equal(absolutizeUrl('mailto:a@b.c', base), 'mailto:a@b.c');
    assert.equal(absolutizeUrl('', base), '');
  });
  it('removes scripts, iframes, base, refresh/csp metas, preloads, handlers and srcset; absolutizes links', () => {
    const html = '<html><head><base href="/zzz/"><meta http-equiv="refresh" content="0;url=/x"><meta http-equiv="Content-Security-Policy" content="default-src none"><meta charset="latin1">'
      + '<link rel="preload" as="script" href="/a.js"><link rel="modulepreload" href="/m.js"><link rel="canonical" href="c.html">'
      + '<script>alert(1)</script><script src="/x.js"></script></head><body onload="x()"><a href="next.html" onclick="y()">n</a><a href="javascript:void(0)">j</a>'
      + '<iframe src="/frame.html">fallback</iframe><picture><source srcset="a.webp 1x"><img src="a.png" srcset="a.png 1x, b.png 2x" sizes="100vw" alt="A"></picture>'
      + '<form action="/post"><input type="submit"></form></body></html>';
    const b = makeBudget();
    const out = transformHtml(html, { base, budget: b });
    assert.ok(!/<script|alert|<iframe|<base|refresh|content-security|modulepreload|preload|onload|onclick|srcset|sizes=|latin1|<source/i.test(out), out);
    assert.match(out, /<a href="https:\/\/site\.test\/dir\/next\.html">n<\/a>/);
    assert.match(out, /<a href="#">j<\/a>/);
    assert.match(out, /<link rel="canonical" href="https:\/\/site\.test\/dir\/c\.html">/);
    assert.match(out, /<img src="https:\/\/site\.test\/dir\/a\.png" alt="A">/);
    assert.match(out, /<form action="https:\/\/site\.test\/post">/);
    assert.equal(b.removed.scripts, 2);
    assert.equal(b.removed.iframes, 1);
    assert.equal(b.skipped.get('https://site.test/frame.html'), 'iframe removed from the static copy');
  });
  it('script content with angle brackets and comments does not confuse the walker', () => {
    const out = transformHtml('<!-- <script> --><p>1</p><script>if (a<b && "</p>") {}</script><p>2</p><!-- unterminated', { base });
    assert.equal(out, '<!-- <script> --><p>1</p><p>2</p><!-- unterminated');
  });
  it('keeps svg attribute case and untouched tags verbatim', () => {
    const html = '<svg viewBox="0 0 1 1" xmlns:xlink="x"><path d="M0 0"/></svg><p class=\'a "b"\'>t</p>';
    assert.equal(transformHtml(html, { base }), html);
    assert.match(transformHtml('<svg viewBox="0 0 1 1"><image href="i.png" width="1"/></svg>', { base }), /<svg viewBox="0 0 1 1"><image href="https:\/\/site\.test\/dir\/i\.png" width="1"\/>/);
  });
  it('entities in URLs survive a rewrite', () => {
    const out = transformHtml('<a href="/q?a=1&amp;b=2">x</a>', { base });
    assert.equal(out, '<a href="https://site.test/q?a=1&amp;b=2">x</a>');
  });
  it('inlines img, icon, poster and svg image sources, style text and style attributes under a lookup', () => {
    const png = { mime: 'image/png', body: PNG };
    const lookup = (u) => (u.startsWith('https://site.test/dir/') && u.endsWith('.png') && !u.includes('gone') ? png : null);
    const b = makeBudget({ lookup });
    const html = '<link rel="shortcut icon" href="f.png"><img src="a.png"><video poster="p.png" src="v.mp4"></video><div style="background:url(a.png)"></div><style>.x{background:url("b.png")}</style><img src="gone.png">';
    const out = transformHtml(html, { base, budget: b });
    const uri = `data:image/png;base64,${PNG.toString('base64')}`;
    assert.equal(out.split(uri).length - 1, 5);
    assert.match(out, /<video poster="data:[^"]+" src="https:\/\/site\.test\/dir\/v\.mp4">/);
    assert.match(out, /<img src="https:\/\/site\.test\/dir\/gone\.png">/);
    assert.equal(b.skipped.get('https://site.test/dir/gone.png'), 'the page never loaded it');
    assert.equal(b.inlined.get('https://site.test/dir/a.png').bytes, PNG.length);
  });
  it('transformCss: urls absolutized against the sheet, data kept, theme forced, imports absolute', () => {
    const css = '@import "other.css";.a{background:url(img/a.png)}.b{background:url( \'../b.png\' )}.c{background:url(data:image/gif;base64,AA)}.d{mask:url(#m)}@media (prefers-color-scheme: dark){.e{color:#fff}}';
    const out = transformCss(css, { base: 'https://site.test/css/main.css', theme: 'light' });
    assert.match(out, /@import "https:\/\/site\.test\/css\/other\.css"/);
    assert.match(out, /url\("https:\/\/site\.test\/css\/img\/a\.png"\)/);
    assert.match(out, /url\("https:\/\/site\.test\/b\.png"\)/);
    assert.match(out, /url\(data:image\/gif;base64,AA\)/);
    assert.match(out, /url\(#m\)/);
    assert.ok(!out.includes('prefers-color-scheme'));
    assert.match(out, /\(max-width: -1px\)/);
    assert.equal(forceScheme('@media (prefers-color-scheme:dark){}', 'dark'), '@media (min-width: 0px){}');
    assert.equal(forceScheme('@media screen and ( prefers-color-scheme : LIGHT ){}', 'dark'), '@media screen and (max-width: -1px){}');
  });
  it('the style raw text cannot close its own element', () => {
    const lookup = () => null;
    const out = transformHtml('<style>.a::after{content:"</style><b>"}</style><p>x</p>', { base, budget: makeBudget({ lookup }) });
    assert.ok(out.includes('<p>x</p>'));
  });
  it('buildSnapshot: pending sheets, source meta, doctype, charset', () => {
    const dom = { doctype: '<!DOCTYPE html>', baseUri: base, pending: [{ n: 0, href: 'https://cdn.test/s.css', media: 'print' }, { n: 1, href: 'https://cdn.test/t.css', media: 'all' }],
      html: '<html><head><meta charset="windows-1252"><style data-snapshot-pending="0"></style><style data-snapshot-pending="1"></style></head><body>b</body></html>' };
    const { html, budget } = buildSnapshot(dom, { url: 'https://site.test/dir/page.html?a=1&b=2', at: '2026-10-30T00:00:00.000Z', pendingCss: { 0: '.a{background:url(x.png)}' } });
    assert.ok(html.startsWith('<!DOCTYPE html>\n<html><head><meta charset="utf-8"><meta name="snapshot-source" content="https://site.test/dir/page.html?a=1&amp;b=2" data-at="2026-10-30T00:00:00.000Z">'));
    assert.match(html, /<style media="print" data-snapshot-href="https:\/\/cdn\.test\/s\.css">\.a\{background:url\("https:\/\/cdn\.test\/x\.png"\)\}<\/style>/);
    assert.match(html, /<link rel="stylesheet" href="https:\/\/cdn\.test\/t\.css">/);
    assert.equal(budget.skipped.get('https://cdn.test/t.css'), 'stylesheet could not be read; linked instead');
    assert.ok(!html.includes('windows-1252'));
  });
});

describe('page-snapshot caps', () => {
  const asset = (n) => ({ mime: 'image/png', body: Buffer.alloc(n, 1) });
  it('defaults are 2 MiB per asset and 20 MiB in all', () => {
    assert.equal(ps.MAX_ASSET_BYTES, 2 * 1048576);
    assert.equal(ps.MAX_TOTAL_BYTES, 20 * 1048576);
    const b = makeBudget({ lookup: (u) => (u.endsWith('/big') ? asset(2 * 1048576 + 1) : u.endsWith('/ok') ? asset(2 * 1048576) : null) });
    assert.ok(inlineAsset('https://s.test/ok', b));
    assert.equal(inlineAsset('https://s.test/big', b), null);
    assert.match(b.skipped.get('https://s.test/big'), /over the per-asset cap/);
  });
  it('the total cap takes effect and skips later assets', () => {
    const b = makeBudget({ lookup: () => asset(60), maxAsset: 100, maxTotal: 130 });
    assert.ok(inlineAsset('https://s.test/1', b));
    assert.ok(inlineAsset('https://s.test/2', b));
    assert.equal(inlineAsset('https://s.test/3', b), null);
    assert.match(b.skipped.get('https://s.test/3'), /over the total cap/);
    assert.equal(b.used, 120);
  });
  it('a tooBig marker, an unsafe type and a missing asset are skipped with reasons; octet-stream uses the extension', () => {
    const b = makeBudget({ lookup: (u) => ({ 'https://s.test/t': { tooBig: true, bytes: 9 }, 'https://s.test/x.js': { mime: 'text/javascript', body: Buffer.from('a') }, 'https://s.test/f.woff2': { mime: 'application/octet-stream', body: Buffer.from('a') } })[u] || null });
    assert.equal(inlineAsset('https://s.test/t', b), null);
    assert.equal(inlineAsset('https://s.test/x.js', b), null);
    assert.equal(inlineAsset('https://s.test/none', b), null);
    assert.match(inlineAsset('https://s.test/f.woff2', b), /^data:font\/woff2;base64,/);
    assert.match(b.skipped.get('https://s.test/x.js'), /unsupported type text\/javascript/);
    assert.equal(b.skipped.get('https://s.test/none'), 'the page never loaded it');
  });
  it('no lookup means nothing is inlined and non-http urls are ignored', () => {
    assert.equal(inlineAsset('https://s.test/a', makeBudget()), null);
    assert.equal(inlineAsset('ftp://s.test/a', makeBudget({ lookup: () => asset(1) })), null);
  });
});

describe('page-snapshot linear time on the 8 MiB worst-case shapes', () => {
  const MB8 = 8 * 1048576;
  const shapes = {
    'unterminated quotes': '<a b="'.repeat(Math.floor(MB8 / 6)),
    'bare angle brackets': '<'.repeat(MB8),
    'many tags': '<img src="a.png">'.repeat(Math.floor(MB8 / 17)),
    'many open tags without close': '<div class="x" '.repeat(Math.floor(MB8 / 15)),
    'script openers': '<script>'.repeat(Math.floor(MB8 / 8)),
    'url( runs': '<style>' + 'a{b:url( url( url(\n'.repeat(Math.floor(MB8 / 19)) + '</style>',
    'long spaces in url()': '<style>a{b:url(' + ' '.repeat(MB8) + '</style>',
    'unterminated css strings': '<style>' + 'a{b:url("x'.repeat(Math.floor(MB8 / 10)) + '</style>',
    'import openers': '<style>' + '@import '.repeat(Math.floor(MB8 / 8)) + '</style>',
    'comments': '<!--'.repeat(Math.floor(MB8 / 4)),
  };
  for (const [name, html] of Object.entries(shapes)) {
    it(name, () => {
      const t0 = Date.now();
      transformHtml(html, { base: 'https://s.test/', budget: makeBudget({ lookup: () => null }), theme: 'dark' });
      assert.ok(Date.now() - t0 < 5000, `${name} took ${Date.now() - t0} ms`);
    });
  }
});


describe('page-snapshot review r1: remote address policy (unit)', () => {
  it('isPrivateHost: loopback, private, link-local, CGNAT, unique-local, unspecified in every numeric form, and localhost names', () => {
    const priv = ['127.0.0.1', '127.0.0.2', '2130706433', '0x7f.1', '0177.0.0.1', '017700000001', '10.1.2.3', '172.16.0.1', '172.31.255.255',
      '192.168.1.5', '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0', '0', '224.0.0.1', '255.255.255.255', '192.0.0.8', '198.18.0.1',
      '[::1]', '[::]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::ffff:a9fe:a9fe]', '[::127.0.0.1]', '[fc00::1]', '[fd12:3456::1]', '[fe80::1]',
      '[febf::1]', '[fec0::1]', '[ff02::1]', '[64:ff9b::a00:1]', '[2002:c0a8:101::1]', 'localhost', 'LOCALHOST', 'localhost.', 'a.localhost', 'x.y.localhost.'];
    for (const h of priv) assert.equal(isPrivateHost(h), true, h);
    const pub = ['example.com', '8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.1.1', '11.0.0.1',
      '192.169.0.1', '[2001:4860:4860::8888]', '[2606:4700::1111]', '[64:ff9b::808:808]', 'localhost.example.com', '10.example.com', '127.0.0.1.nip.io'];
    for (const h of pub) assert.equal(isPrivateHost(h), false, h);
    assert.equal(isPrivateAddress('::ffff:10.0.0.1'), true);
    assert.equal(isPrivateAddress('fe80::1%eth0'), true);
    assert.equal(isPrivateAddress('93.184.216.34'), false);
    assert.equal(isPrivateAddress('not an ip'), false);
  });
  it('allowRequest remote: private hosts refused unless they are the page origin; local mode unchanged', () => {
    for (const u of ['http://127.0.0.1:9/secret', 'http://2130706433/', 'http://0x7f000001/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/', 'https://192.168.0.1/', 'http://100.100.1.1/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://0.0.0.0:8080/', 'http://localhost/', 'http://a.localhost/']) {
      assert.equal(allowRequest(u, 'remote', 'http:', 'http://127.0.0.2:8080'), false, u);
      assert.equal(allowRequest(u, 'remote'), false, u);
    }
    assert.equal(allowRequest('http://127.0.0.2:8080/s.css', 'remote', 'http:', 'http://127.0.0.2:8080'), true);
    assert.equal(allowRequest('http://127.0.0.2:8081/s.css', 'remote', 'http:', 'http://127.0.0.2:8080'), false);
    assert.equal(allowRequest('https://cdn.example.com/x.css', 'remote', 'https:', 'https://example.com'), true);
    assert.equal(allowRequest('http://127.0.0.1:9/x', 'local'), true);
  });
  it('hostVerdict: a DNS name answering a private address is private, a failed or empty lookup is private, results are cached', async () => {
    const calls = [];
    const answers = { 'evil.test': [{ address: '127.0.0.1', family: 4 }], 'mixed.test': [{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }],
      'meta.test': [{ address: '::ffff:169.254.169.254', family: 6 }], 'cdn.test': [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }], 'empty.test': [] };
    const lookup = async (h, o) => { calls.push([h, o]); if (h in answers) return answers[h]; throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); };
    const cache = new Map();
    assert.equal(await hostVerdict('evil.test', lookup, cache), true);
    assert.equal(await hostVerdict('mixed.test', lookup, cache), true);
    assert.equal(await hostVerdict('meta.test', lookup, cache), true);
    assert.equal(await hostVerdict('empty.test', lookup, cache), true);
    assert.equal(await hostVerdict('nx.test', lookup, cache), true);
    assert.equal(await hostVerdict('cdn.test', lookup, cache), false);
    assert.equal(await hostVerdict('cdn.test.', lookup, cache), false);
    assert.equal(await hostVerdict('CDN.test', lookup, cache), false);
    assert.equal(await hostVerdict('127.0.0.1', lookup, cache), true);
    assert.equal(await hostVerdict('8.8.8.8', lookup, cache), false);
    assert.equal(await hostVerdict('localhost', lookup, cache), true);
    assert.deepEqual(calls.map((c) => c[0]), ['evil.test', 'mixed.test', 'meta.test', 'empty.test', 'nx.test', 'cdn.test', 'cdn.test']);
    assert.deepEqual(calls[0][1], { all: true, verbatim: true });
  });
  it('blockedOrigin lists file URLs as file://, never the string "null"', () => {
    assert.equal(blockedOrigin('file:///tmp/x/obj.html'), 'file://');
    assert.equal(blockedOrigin('https://a.test:8443/x?y'), 'https://a.test:8443');
    assert.equal(blockedOrigin('ws://a.test/s'), 'ws://a.test');
    assert.equal(blockedOrigin('nope'), '(unparseable url)');
  });
});

describe('page-snapshot review r1: copy rewriting (unit)', () => {
  const base = 'https://site.test/dir/page.html';
  it('embed, object, applet, portal, frame and frameset are removed and each listed in skipped', () => {
    assert.deepEqual([...EMBEDDING], ['embed', 'object', 'applet', 'portal', 'frame', 'frameset']);
    const b = makeBudget({ lookup: () => null });
    const out = transformHtml('<body><embed src="obj.html" type="text/html"><object data="logo.svg" type="image/svg+xml"><p>fallback</p></object>'
      + '<applet code="A.class"></applet><portal src="https://x.test/"></portal><frameset><frame src="f.html"></frameset><EMBED SRC=up.html><embed></body>', { base, budget: b });
    assert.ok(!/<(embed|object|applet|portal|frame|frameset)\b/i.test(out), out);
    assert.ok(out.includes('<p>fallback</p>'));
    const sk = Object.fromEntries(b.skipped);
    assert.equal(sk['https://site.test/dir/obj.html'], '<embed> removed from the static copy');
    assert.equal(sk['https://site.test/dir/logo.svg'], '<object> removed from the static copy');
    assert.equal(sk['https://site.test/dir/A.class'], '<applet> removed from the static copy');
    assert.equal(sk['https://x.test/'], '<portal> removed from the static copy');
    assert.equal(sk['https://site.test/dir/f.html'], '<frame> removed from the static copy');
    assert.equal(sk['https://site.test/dir/up.html'], '<embed> removed from the static copy');
    assert.equal(sk['(<frameset> without a source)'], '<frameset> removed from the static copy');
    assert.equal(sk['(<embed> without a source)'], '<embed> removed from the static copy');
    assert.equal(b.removed.embedded, 8);
  });
  it('--theme rewrites media= on <style>, <link> and <source>, including a pending sheet placeholder', () => {
    const html = '<head><link rel="stylesheet" href="d.css" media="(prefers-color-scheme: dark)"><style media="screen and (prefers-color-scheme:dark)">h1{color:red}</style>'
      + '<style media="(prefers-color-scheme: light)">h1{color:blue}</style></head><picture><source src="d.png" media="(prefers-color-scheme: dark)"></picture>';
    const light = transformHtml(html, { base, theme: 'light' });
    assert.ok(!light.includes('prefers-color-scheme'), light);
    assert.match(light, /<link rel="stylesheet" href="https:\/\/site.test\/dir\/d.css" media="\(max-width: -1px\)">/);
    assert.match(light, /<style media="screen and \(max-width: -1px\)">/);
    assert.match(light, /<style media="\(min-width: 0px\)">h1\{color:blue\}/);
    assert.match(light, /<source src="https:\/\/site.test\/dir\/d.png" media="\(max-width: -1px\)">/);
    const dark = transformHtml(html, { base, theme: 'dark' });
    assert.match(dark, /<style media="screen and \(min-width: 0px\)">/);
    assert.ok(transformHtml(html, { base }).includes('media="(prefers-color-scheme: dark)"'), 'no theme: left alone');
    const dom = { html: '<html><head><style data-snapshot-pending="0"></style><style data-snapshot-pending="1"></style></head><body></body></html>', baseUri: base,
      pending: [{ n: 0, href: 'https://cdn.test/dark.css', media: '(prefers-color-scheme: dark)' }, { n: 1, href: 'https://cdn.test/unread.css', media: '(prefers-color-scheme: dark)' }] };
    const built = buildSnapshot(dom, { url: base, at: 'T', pendingCss: { 0: 'h1{color:red}', 1: null }, theme: 'light' }).html;
    assert.ok(!built.includes('prefers-color-scheme'), built);
    assert.match(built, /<style media="\(max-width: -1px\)" data-snapshot-href="https:\/\/cdn.test\/dark.css">h1\{color:red\}<\/style>/);
    assert.match(built, /<link rel="stylesheet" media="\(max-width: -1px\)" href="https:\/\/cdn.test\/unread.css">/);
  });
  it('resolvePending: a blocked sheet is dropped, an unread one linked, failed/disabled links from the DOM are listed in skipped', () => {
    const dom = { html: '<html><head><style data-snapshot-pending="0"></style><style data-snapshot-pending="1"></style><style data-snapshot-pending="2"></style>'
      + '<style data-snapshot-pending="9"></style></head></html>', baseUri: 'https://s.test/',
      pending: [{ n: 0, href: 'https://s.test/a.css', media: 'all' }, { n: 1, href: 'http://127.0.0.1/secret', media: 'all' }, { n: 2, href: 'https://cdn.test/u.css', media: 'print' }],
      dropped: [{ href: 'https://s.test/missing.css', reason: 'stylesheet did not load (blocked or failed); dropped from the copy' }, { href: 'https://s.test/alt.css', reason: 'stylesheet is disabled or alternate; dropped from the copy' }] };
    const r = resolvePending(dom, { 0: 'a{b:c}', 1: false, 2: null });
    assert.equal(r.html, '<html><head><style data-snapshot-href="https://s.test/a.css">a{b:c}</style><link rel="stylesheet" media="print" href="https://cdn.test/u.css"><style data-snapshot-pending="9"></style></head></html>');
    assert.deepEqual(r.skipped, [['https://s.test/missing.css', 'stylesheet did not load (blocked or failed); dropped from the copy'], ['https://s.test/alt.css', 'stylesheet is disabled or alternate; dropped from the copy'],
      ['http://127.0.0.1/secret', ps.PENDING_BLOCKED], ['https://cdn.test/u.css', ps.PENDING_UNREAD]]);
    const b = buildSnapshot(dom, { url: 'https://s.test/', at: 'T', resolved: r }).budget;
    assert.deepEqual([...b.skipped.keys()], ['https://s.test/missing.css', 'https://s.test/alt.css', 'http://127.0.0.1/secret', 'https://cdn.test/u.css']);
  });
  it('resolvePending is one linear pass: 1000 pending sheets in an 8 MiB DOM', () => {
    const MB8 = 8 * 1048576;
    const n = 1000;
    const chunk = '<style data-snapshot-pending="N"></style>';
    const filler = '<div class="x">' + 'y'.repeat(Math.floor(MB8 / n) - 60) + '</div>';
    let html = '<html><body>';
    for (let i = 0; i < n; i++) html += chunk.replace('N', String(i)) + filler;
    html += '</body></html>';
    assert.ok(html.length >= MB8 - 100000 && html.length <= MB8 + 100000, String(html.length));
    const pending = Array.from({ length: n }, (_, i) => ({ n: i, href: `https://s.test/${i}.css`, media: 'all' }));
    const pendingCss = Object.fromEntries(pending.map((p) => [p.n, `.c${p.n}{color:red}`]));
    const t0 = Date.now();
    const r = resolvePending({ html, pending, baseUri: 'https://s.test/' }, pendingCss);
    const t1 = Date.now() - t0;
    assert.ok(t1 < 2000, `resolvePending took ${t1} ms`);
    assert.ok(!r.html.includes('data-snapshot-pending'));
    assert.ok(r.html.includes('<style data-snapshot-href="https://s.test/999.css">.c999{color:red}</style>'));
    const t2 = Date.now();
    buildSnapshot({ html, pending, baseUri: 'https://s.test/' }, { url: 'https://s.test/', at: 'T', resolved: r, lookup: () => null });
    assert.ok(Date.now() - t2 < 5000, `buildSnapshot took ${Date.now() - t2} ms`);
  });
});

// ---------------------------------------------------------------- real browser
const pw = await resolvePlaywright(process.cwd());
let browserOk = false;
if (pw) { try { const b = await pw.chromium.launch({ headless: true }); await b.close(); browserOk = true; } catch { /* no browser */ } }
if (!browserOk) console.log('# real page-snapshot capture tests skipped: playwright or its browser cannot be resolved here');

describe('page-snapshot real capture', { skip: browserOk ? false : 'playwright or its browser cannot be resolved here' }, () => {
  let server; let port; let dir; const seen = [];
  const BIG = noisePng(32, 32);
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-real-'));
    server = http.createServer((req, res) => {
      seen.push({ url: req.url, method: req.method, cookie: req.headers.cookie || null });
      const send = (type, body) => { res.writeHead(200, { 'content-type': type, 'set-cookie': 'sid=1; Path=/' }); res.end(body); };
      if (req.url === '/') {
        return send('text/html', '<!doctype html><html><head><title>Live</title><link rel="stylesheet" href="/s.css"><style>.inline{letter-spacing:2px}</style>'
          + '<script src="/app.js"></script><script>document.body.setAttribute("data-ran", "1")</script></head>'
          + '<body><h1 class="inline">Hello</h1><div class="bg"></div><img id="pic" src="/i.png" alt="x"><img src="/big.png"><img src="http://blocked.invalid/x.png">'
          + '<a href="/other">go</a><form action="/submit" method="post"><button>go</button></form></body></html>');
      }
      if (req.url === '/s.css') return send('text/css', '@import "/imp.css";h1{font-size:40px}.bg{width:40px;height:40px;background:url(/bg.png) no-repeat}@media (prefers-color-scheme: dark){h1{color:rgb(255, 0, 255)}}');
      if (req.url === '/imp.css') return send('text/css', 'body{margin:0;border-top:3px solid rgb(1, 2, 3)}');
      if (req.url === '/i.png' || req.url === '/bg.png') return send('image/png', PNG);
      if (req.url === '/big.png') return send('image/png', BIG);
      if (req.url === '/app.js') return send('text/javascript', 'document.title="changed by script"');
      if (req.url === '/missing') { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end('other');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  after(async () => { await new Promise((r) => server.close(r)); await fs.rm(dir, { recursive: true, force: true }); });

  async function openStandalone(file) {
    const b = await pw.chromium.launch({ headless: true });
    try {
      const reqs = [];
      const ctx = await b.newContext({ viewport: { width: 400, height: 300 } });
      await ctx.route('**/*', (r) => { const u = r.request().url(); reqs.push(u); return u.startsWith('file:') || u.startsWith('data:') ? r.continue() : r.abort(); });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(file).href);
      await page.waitForLoadState('load');
      const info = await page.evaluate(() => {
        const cs = (s) => getComputedStyle(document.querySelector(s) || document.body);
        const imgs = [...document.images].map((i) => ({ src: i.getAttribute('src').slice(0, 30), ok: i.complete && i.naturalWidth > 0 }));
        return { ran: document.body.hasAttribute('data-ran'), title: document.title, scripts: document.scripts.length, imgs, bg: cs('.bg').backgroundImage.slice(0, 20), size: cs('h1').fontSize, color: cs('h1').color, spacing: cs('h1').letterSpacing, border: cs('body').borderTopWidth, html: document.documentElement.outerHTML };
      });
      return { ...info, reqs };
    } finally { await b.close(); }
  }

  it('captures a localhost page into a standalone page.html, a screenshot and a manifest', async () => {
    const out = path.join(dir, 'live');
    const r = await run(['capture', '--url', `http://127.0.0.1:${port}/`, '--out', out, '--width', '500', '--height', '320'], { cwd: dir, now: () => new Date('2026-10-30T12:00:00Z') });
    assert.equal(r.captured, true);
    assert.equal(r.out, out);
    assert.equal(r.page, path.join(out, 'page.html'));
    assert.deepEqual((await fs.readdir(out)).sort(), ['manifest.json', 'page.html', 'screenshot.png']);
    const png = await fs.readFile(path.join(out, 'screenshot.png'));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    const html = await fs.readFile(path.join(out, 'page.html'), 'utf-8');
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(!/<script/i.test(html), 'no script element');
    assert.ok(!html.includes('/app.js'));
    assert.ok(html.includes(`<meta name="snapshot-source" content="http://127.0.0.1:${port}/" data-at="2026-10-30T12:00:00.000Z">`));
    assert.ok(html.includes('<style'), 'styles inline');
    assert.ok(!html.includes('rel="stylesheet"'));
    assert.match(html, /<a href="http:\/\/127\.0\.0\.1:\d+\/other">/);

    const man = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8'));
    assert.equal(man.url, `http://127.0.0.1:${port}/`);
    assert.equal(man.at, '2026-10-30T12:00:00.000Z');
    assert.deepEqual(man.viewport, { width: 500, height: 320, full_page: false });
    assert.deepEqual(man.files, ['page.html', 'screenshot.png', 'manifest.json']);
    assert.equal(man.remote, false);
    const inl = man.inlined.map((x) => new URL(x.url).pathname).sort();
    assert.deepEqual(inl, ['/bg.png', '/big.png', '/i.png']);
    assert.ok(man.inlined.every((x) => x.mime === 'image/png' && x.bytes === (x.url.endsWith('/big.png') ? BIG.length : PNG.length)));
    const sk = Object.fromEntries(man.skipped.map((x) => [x.url, x.reason]));
    assert.deepEqual(Object.keys(sk), ['http://blocked.invalid/x.png']);
    assert.equal(sk['http://blocked.invalid/x.png'], 'the page never loaded it');
    assert.ok(man.blocked_origins.includes('http://blocked.invalid'));
    assert.equal(r.inlined_count, 3);
    assert.equal(r.inlined_bytes, PNG.length * 2 + BIG.length);
    assert.ok(r.blocked_origins.includes('http://blocked.invalid'));

    // opens standalone: nothing but the file itself is requested
    const s = await openStandalone(path.join(out, 'page.html'));
    assert.deepEqual(s.reqs, [pathToFileURL(path.join(out, 'page.html')).href, 'http://blocked.invalid/x.png'], 'only the file itself and the one asset listed in skipped');
    assert.equal(s.ran, false);
    assert.equal(s.scripts, 0);
    assert.equal(s.title, 'changed by script');
    assert.equal(s.imgs[0].src.startsWith('data:image/png;base64,'), true);
    assert.equal(s.imgs[0].ok, true);
    assert.ok(s.bg.startsWith('url("data:image/png'), s.bg);
    assert.equal(s.size, '40px');
    assert.equal(s.spacing, '2px');
    assert.notEqual(s.color, 'rgb(255, 0, 255)', 'light: the dark rule does not apply');
    assert.equal(s.border, '3px', 'the @import-ed sheet is inlined too');
    // no cookies sent, no link followed, no form submitted
    assert.ok(seen.every((q) => q.method === 'GET'));
    assert.equal(seen[0].cookie, null);
    assert.ok(!seen.some((q) => q.url === '/other' || q.url === '/submit'));
  });

  it('the per-asset and total caps take effect on a real capture; skipped assets keep absolute URLs', async () => {
    const out = path.join(dir, 'caps');
    const r = await run(['capture', '--url', `http://127.0.0.1:${port}/`, '--out', out, '--max-asset-bytes', String(BIG.length - 1)], { cwd: dir });
    const man = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8'));
    const big = man.skipped.find((x) => x.url.endsWith('/big.png'));
    assert.match(big.reason, /per-asset cap/);
    assert.ok((await fs.readFile(path.join(out, 'page.html'), 'utf-8')).includes(`src="http://127.0.0.1:${port}/big.png"`));
    assert.equal(r.skipped_count, man.skipped.length);
    const out2 = path.join(dir, 'caps2');
    await run(['capture', '--url', `http://127.0.0.1:${port}/`, '--out', out2, '--max-total-bytes', String(PNG.length + 5)], { cwd: dir });
    const m2 = JSON.parse(await fs.readFile(path.join(out2, 'manifest.json'), 'utf-8'));
    assert.equal(m2.inlined.length, 1);
    assert.ok(m2.skipped.some((x) => /total cap/.test(x.reason)));
  });

  it('--theme dark forces the dark media query in the copy; --full-page is recorded', async () => {
    const out = path.join(dir, 'dark');
    await run(['capture', '--url', `http://127.0.0.1:${port}/`, '--out', out, '--theme', 'dark', '--full-page'], { cwd: dir });
    const html = await fs.readFile(path.join(out, 'page.html'), 'utf-8');
    assert.ok(!html.includes('prefers-color-scheme'));
    const man = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8'));
    assert.equal(man.theme, 'dark');
    assert.equal(man.viewport.full_page, true);
    assert.equal((await openStandalone(path.join(out, 'page.html'))).color, 'rgb(255, 0, 255)');
  });

  it('a file:// page: sheets and images are read from disk, zero requests leave the machine', async () => {
    const site = path.join(dir, 'site');
    await fs.mkdir(path.join(site, 'img'), { recursive: true });
    await fs.writeFile(path.join(site, 'a.html'), '<!doctype html><link rel="stylesheet" href="s.css"><img src="img/i.png"><div class="bg"></div><img src="http://blocked.invalid/z.png"><script>1</script>');
    await fs.writeFile(path.join(site, 's.css'), '.bg{width:9px;height:9px;background:url(img/i.png)}');
    await fs.writeFile(path.join(site, 'img', 'i.png'), PNG);
    const out = path.join(dir, 'filecap');
    const r = await run(['capture', '--url', pathToFileURL(path.join(site, 'a.html')).href, '--out', out], { cwd: dir });
    assert.equal(r.captured, true);
    assert.ok(r.blocked_origins.includes('http://blocked.invalid'));
    const s = await openStandalone(path.join(out, 'page.html'));
    assert.equal(s.imgs[0].ok, true);
    assert.ok(s.bg.startsWith('url("data:image/png'));
    assert.equal(s.scripts, 0);
  });

  it('an HTTP error exits 1 and writes nothing; a stale manifest is removed by a failed run', async () => {
    const out = path.join(dir, 'err');
    assert.equal(await code(run(['capture', '--url', `http://127.0.0.1:${port}/missing`, '--out', out], { cwd: dir })), 1);
    await assert.rejects(fs.stat(out));
    assert.equal(await code(run(['capture', '--url', 'http://127.0.0.1:1/', '--out', out, '--timeout-ms', '2000'], { cwd: dir })), 1);
    await assert.rejects(fs.stat(out));
  });

  it('with --allow-remote on a local URL the page is still held to the local policy', async () => {
    const out = path.join(dir, 'ar');
    const r = await run(['capture', '--url', `http://127.0.0.1:${port}/`, '--out', out, '--allow-remote'], { cwd: dir });
    assert.ok(r.blocked_origins.includes('http://blocked.invalid'));
    assert.equal(JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8')).remote, false);
  });

  it('through the real CLI: plan, refusal (exit 2, stderr, nothing on stdout) and a capture', async () => {
    const cli = path.join(ROOT, '.claude/helpers/kit/cli.js');
    const sh = (args) => new Promise((resolve) => execFile(process.execPath, [cli, 'page-snapshot', ...args], { cwd: dir, encoding: 'utf-8' }, (err, stdout, stderr) => resolve({ status: err ? err.code : 0, stdout, stderr })));
    const p = await sh(['plan', '--url', 'https://example.com/']);
    assert.equal(p.status, 0);
    assert.equal(JSON.parse(p.stdout).needs_consent, true);
    const refused = await sh(['capture', '--url', 'https://example.com/', '--out', 'cliout']);
    assert.equal(refused.status, 2);
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /refused: .*--allow-remote/);
    const bad = await sh(['capture', '--url', 'x', '--out', 'cliout']);
    assert.equal(bad.status, 1);
    const ok = await sh(['capture', '--url', `http://127.0.0.1:${port}/`, '--out', 'cliout']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).captured, true);
  });
});

describe('page-snapshot scanHtml basics', () => {
  it('an unclosed tag leaves the rest verbatim', () => {
    assert.equal(scanHtml('<p>a</p><img src="x', {}), '<p>a</p><img src="x');
  });
});

describe('page-snapshot review r1: real captures', { skip: browserOk ? false : 'playwright or its browser cannot be resolved here' }, () => {
  let dir; let loop; let lp; let pub; let pp; const loopHits = []; let loop6 = null;
  const SECRET = 'AWS_SECRET=hunter2-from-loopback';
  // a resolver that maps test names to loopback in the browser only, as a DNS name pointing at a private address would
  const mappedPw = (rules) => async () => ({ chromium: { launch: (o) => pw.chromium.launch({ ...o, args: [...(o.args || []), `--host-resolver-rules=${rules}`] }) } });
  const fakeLookup = (answers) => async (h) => { if (h in answers) return answers[h].map((a) => ({ address: a, family: a.includes(':') ? 6 : 4 })); throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); };
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-r1-'));
    const loopHandler = (req, res) => { loopHits.push(req.url); res.writeHead(200, { 'content-type': req.url.endsWith('.png') ? 'image/png' : 'text/plain' }); res.end(req.url.endsWith('.png') ? PNG : `h1{color:red} /* ${SECRET} */`); };
    loop = http.createServer(loopHandler);
    await new Promise((r) => loop.listen(0, '127.0.0.1', r));
    lp = loop.address().port;
    try { loop6 = http.createServer(loopHandler); await new Promise((r, j) => { loop6.once('error', j); loop6.listen(lp, '::1', r); }); } catch { loop6 = null; }
    pub = http.createServer((req, res) => {
      const html = (b) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(b); };
      if (req.url === '/probe') {
        return html(`<!doctype html><title>Probe</title><link rel="stylesheet" href="http://127.0.0.1:${lp}/secret"><link rel="stylesheet" href="/redir.css">`
          + `<link rel="stylesheet" href="http://evil.test:${lp}/dns-secret"><img src="http://[::1]:${lp}/v6.png"><img src="http://2130706433:${lp}/dec.png">`
          + `<img src="http://0x7f.1:${lp}/hex.png"><img src="http://[::ffff:127.0.0.1]:${lp}/mapped.png"><img src="http://localhost:${lp}/name.png"><img src="/ok.png">`
          + `<script>fetch("http://127.0.0.1:${lp}/fetch").catch(()=>{});</script><h1>probe</h1>`);
      }
      if (req.url === '/redir.css') { res.writeHead(302, { location: `http://127.0.0.1:${lp}/redir-secret` }); return res.end(); }
      if (req.url === '/redir-name.css') { res.writeHead(302, { location: `http://evil.test:${lp}/redir-name-secret` }); return res.end(); }
      if (req.url === '/names') return html(`<!doctype html><link rel="stylesheet" href="/redir-name.css"><link rel="stylesheet" href="http://rebind.test:${lp}/rebind-secret"><h1>n</h1>`);
      if (req.url === '/go') { res.writeHead(302, { location: `http://evil.test:${lp}/landing` }); return res.end(); }
      if (req.url === '/go-literal') { res.writeHead(302, { location: `http://127.0.0.1:${lp}/landing` }); return res.end(); }
      if (req.url === '/go-rebind') { res.writeHead(302, { location: `http://rebind.test:${lp}/landing` }); return res.end(); }
      if (req.url === '/ok.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => pub.listen(0, '127.0.0.2', r));
    pp = pub.address().port;
  });
  after(async () => {
    await new Promise((r) => loop.close(r)); if (loop6) await new Promise((r) => loop6.close(r));
    await new Promise((r) => pub.close(r)); await fs.rm(dir, { recursive: true, force: true });
  });

  it('SSRF probe: a 127.0.0.2 page asking for 127.0.0.1 (link, redirect, numeric and IPv6 forms, a DNS name, fetch) never reaches loopback', async () => {
    loopHits.length = 0;
    const out = path.join(dir, 'probe');
    const r = await run(['capture', '--url', `http://127.0.0.2:${pp}/probe`, '--out', out, '--allow-remote'],
      { cwd: dir, lookup: fakeLookup({ 'evil.test': ['127.0.0.1'] }), resolvePlaywright: mappedPw('MAP evil.test 127.0.0.1') });
    assert.equal(r.captured, true);
    assert.deepEqual(loopHits, [], `loopback was reached: ${loopHits.join(', ')}`);
    const html = await fs.readFile(path.join(out, 'page.html'), 'utf-8');
    assert.ok(!html.includes('hunter2'), 'the secret is in page.html');
    for (const o of [`http://127.0.0.1:${lp}`, `http://evil.test:${lp}`, `http://[::1]:${lp}`, `http://localhost:${lp}`, `http://[::ffff:7f00:1]:${lp}`]) assert.ok(r.blocked_origins.includes(o), `${o} not in ${r.blocked_origins}`);
    const man = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8'));
    assert.deepEqual(man.blocked_origins, r.blocked_origins);
    assert.ok(man.inlined.some((x) => x.url === `http://127.0.0.2:${pp}/ok.png`), 'the page origin itself is still reached');
  });

  it('a redirect to a DNS name on loopback and a rebinding name: bodies never copied, the sheets dropped and listed', async () => {
    loopHits.length = 0;
    const out = path.join(dir, 'names');
    const r = await run(['capture', '--url', `http://127.0.0.2:${pp}/names`, '--out', out, '--allow-remote'],
      { cwd: dir, lookup: fakeLookup({ 'evil.test': ['127.0.0.1'], 'rebind.test': ['93.184.216.34'] }), resolvePlaywright: mappedPw('MAP evil.test 127.0.0.1, MAP rebind.test 127.0.0.1') });
    assert.equal(r.captured, true);
    const html = await fs.readFile(path.join(out, 'page.html'), 'utf-8');
    assert.ok(!html.includes('hunter2'), 'the secret is in page.html');
    assert.ok(!html.includes('rebind.test') && !html.includes('redir-name-secret'), 'a sheet from a private address is still linked');
    assert.ok(r.blocked_origins.includes(`http://evil.test:${lp}`) && r.blocked_origins.includes(`http://rebind.test:${lp}`), String(r.blocked_origins));
    const man = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8'));
    assert.ok(man.skipped.some((x) => x.url === `http://rebind.test:${lp}/rebind-secret` && x.reason === ps.PENDING_BLOCKED), JSON.stringify(man.skipped));
  });

  it('a remote page whose navigation redirects to a private address (a name, a literal, a rebinding name) exits 2 and writes nothing', async () => {
    for (const [p, expectHits] of [['/go', 0], ['/go-literal', 0], ['/go-rebind', 1]]) {
      loopHits.length = 0;
      const out = path.join(dir, 'go' + p.replace(/\W/g, ''));
      assert.equal(await code(run(['capture', '--url', `http://127.0.0.2:${pp}${p}`, '--out', out, '--allow-remote'],
        { cwd: dir, lookup: fakeLookup({ 'evil.test': ['127.0.0.1'], 'rebind.test': ['93.184.216.34'] }), resolvePlaywright: mappedPw('MAP evil.test 127.0.0.1, MAP rebind.test 127.0.0.1') })), 2, p);
      await assert.rejects(fs.stat(path.join(out, 'page.html')), { code: 'ENOENT' });
      // rebinding is the documented gap: the browser connects before Node can know, the page is still refused
      assert.equal(loopHits.length, expectHits, `${p}: ${loopHits}`);
    }
  });

  async function openCopy(file, colorScheme) {
    const b = await pw.chromium.launch({ headless: true });
    try {
      const ctx = await b.newContext({ colorScheme });
      await ctx.route('**/*', (rt) => { const u = rt.request().url(); return u.startsWith('file:') || u.startsWith('data:') ? rt.continue() : rt.abort(); });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(file).href);
      await page.waitForTimeout(400);
      // what the embedded documents ran: each child frame's own title, which only its script sets
      const ran = [];
      for (const fr of page.frames()) if (fr !== page.mainFrame()) ran.push(await fr.evaluate(() => document.title).catch(() => '(unreadable)'));
      const info = await page.evaluate(() => ({ title: document.title, color: getComputedStyle(document.querySelector('h1')).color }));
      return { ...info, frames: page.frames().length - 1, ran };
    } finally { await b.close(); }
  }

  it('the copy does not run an embedded document: embed, object and frame are removed, blocked file requests listed as file://', async () => {
    const site = path.join(dir, 'emb');
    await fs.mkdir(site, { recursive: true });
    await fs.writeFile(path.join(site, 'obj.html'), '<script>document.title = "PWNED-OBJ"</script>');
    await fs.writeFile(path.join(site, 'a.html'), '<!doctype html><title>Orig</title><h1>x</h1><embed src="obj.html" type="text/html"><object data="obj.html" type="text/html"></object>');
    // the attack itself works when the original is opened (each embedded document runs its script), so the probe is live
    assert.deepEqual((await openCopy(path.join(site, 'a.html'))).ran, ['PWNED-OBJ', 'PWNED-OBJ']);
    const out = path.join(dir, 'embout');
    const r = await run(['capture', '--url', pathToFileURL(path.join(site, 'a.html')).href, '--out', out], { cwd: dir });
    assert.equal(r.captured, true);
    assert.ok(!r.blocked_origins.includes('null'), String(r.blocked_origins));
    assert.ok(r.blocked_origins.includes('file://'), String(r.blocked_origins));
    const html = await fs.readFile(path.join(out, 'page.html'), 'utf-8');
    assert.ok(!/<(embed|object)\b/i.test(html), html);
    const opened = await openCopy(path.join(out, 'page.html'));
    assert.equal(opened.title, 'Orig');
    assert.equal(opened.frames, 0);
    assert.deepEqual(opened.ran, []);
    const man = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8'));
    const objUrl = pathToFileURL(path.join(site, 'obj.html')).href;
    assert.ok(man.skipped.some((x) => x.url === objUrl && /removed from the static copy/.test(x.reason)), JSON.stringify(man.skipped));
  });

  it('--theme light: a dark-only media= link (pending sheet) and style do not apply when the copy is opened in dark mode; --theme dark the reverse', async () => {
    const site = path.join(dir, 'theme');
    await fs.mkdir(site, { recursive: true });
    await fs.writeFile(path.join(site, 'dark.css'), 'h1{color:rgb(255, 0, 255)}');
    await fs.writeFile(path.join(site, 'a.html'), '<!doctype html><link rel="stylesheet" href="dark.css" media="(prefers-color-scheme: dark)"><style media="(prefers-color-scheme: dark)">h1{background:rgb(0, 0, 9)}</style><h1>t</h1>');
    const out = path.join(dir, 'themeout');
    const r = await run(['capture', '--url', pathToFileURL(path.join(site, 'a.html')).href, '--out', out, '--theme', 'light'], { cwd: dir });
    assert.equal(r.captured, true);
    const html = await fs.readFile(path.join(out, 'page.html'), 'utf-8');
    assert.ok(!html.includes('prefers-color-scheme'), html);
    assert.ok(html.includes('rgb(255, 0, 255)'), 'the sheet is still in the copy');
    assert.equal((await openCopy(path.join(out, 'page.html'), 'dark')).color, 'rgb(0, 0, 0)');
    const outD = path.join(dir, 'themedark');
    await run(['capture', '--url', pathToFileURL(path.join(site, 'a.html')).href, '--out', outD, '--theme', 'dark'], { cwd: dir });
    assert.equal((await openCopy(path.join(outD, 'page.html'), 'light')).color, 'rgb(255, 0, 255)');
  });

  it('failed, blocked, disabled and alternate stylesheet links are dropped from the copy and listed in skipped', async () => {
    const site = path.join(dir, 'links');
    await fs.mkdir(site, { recursive: true });
    await fs.writeFile(path.join(site, 's.css'), 'h1{color:rgb(1, 2, 3)}');
    await fs.writeFile(path.join(site, 'alt.css'), 'h1{color:rgb(9, 9, 9)}');
    await fs.writeFile(path.join(site, 'off.css'), 'h1{color:rgb(8, 8, 8)}');
    await fs.writeFile(path.join(site, 'a.html'), '<!doctype html><link rel="stylesheet" href="s.css"><link rel="stylesheet" href="missing.css">'
      + '<link rel="stylesheet" href="http://blocked.invalid/b.css"><link rel="alternate stylesheet" title="alt" href="alt.css"><link rel="stylesheet" href="off.css" disabled><h1>l</h1>');
    const out = path.join(dir, 'linksout');
    const r = await run(['capture', '--url', pathToFileURL(path.join(site, 'a.html')).href, '--out', out], { cwd: dir });
    assert.equal(r.captured, true);
    const html = await fs.readFile(path.join(out, 'page.html'), 'utf-8');
    assert.ok(!/<link[^>]+stylesheet/i.test(html), html);
    assert.ok(html.includes('rgb(1, 2, 3)'));
    const man = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8'));
    const reason = (u) => (man.skipped.find((x) => x.url === u) || {}).reason;
    const f = (n) => pathToFileURL(path.join(site, n)).href;
    assert.match(reason(f('missing.css')) || '', /did not load.*dropped from the copy/);
    assert.match(reason('http://blocked.invalid/b.css') || '', /did not load.*dropped from the copy/);
    assert.match(reason(f('alt.css')) || '', /disabled or alternate.*dropped from the copy/);
    assert.match(reason(f('off.css')) || '', /disabled or alternate.*dropped from the copy/);
  });
});

// ---------------------------------------------------------------- review r2
const errOf = async (p) => { try { await p; return null; } catch (e) { assert.ok(e instanceof KitExit, String(e)); return e; } };

describe('page-snapshot review r2: exit 4 table and fakes', () => {
  const src = readFileSync(path.join(ROOT, 'src/lib/kit/page-snapshot.js'), 'utf-8');
  const header = src.slice(0, src.indexOf('*/'));
  const flat = header.replace(/\n \*\s*/g, ' ');
  it('the header and usage list every exit-4 cause, the proxy hint, the body timeout and the proxy known limit', () => {
    for (const t of ['playwright not installed', 'browser could not start', 'playwright >= 1.48 required', 'the browser cannot apply the remote address guard']) {
      assert.ok(flat.includes(t), `header: ${t}`);
      assert.ok(ps.usage.includes(t), `usage: ${t}`);
    }
    assert.ok(flat.includes(ps.PROXY_HINT), 'header names the proxy hint');
    assert.ok(ps.usage.includes('without a configured HTTP(S)_PROXY'), 'usage names the proxy behaviour');
    assert.ok(flat.includes('Known limit') && /no flag to use the proxy/.test(flat), 'proxy known limit');
    assert.ok(flat.includes(`"${ps.BODY_LATE}"`) && ps.usage.includes(ps.BODY_LATE), 'body timeout documented');
    assert.match(flat, /4 the browser cannot be used/);
  });
  it('a late body marker is skipped as "body did not finish in time"', () => {
    const b = makeBudget({ lookup: () => ({ late: true }) });
    assert.equal(inlineAsset('https://s.test/live.jpg', b), null);
    assert.equal(b.skipped.get('https://s.test/live.jpg'), ps.BODY_LATE);
  });
  const fakePw = (ctx) => async () => ({ chromium: { launch: async () => ({ newContext: async () => ctx, close: async () => {} }) } });
  it('exit 4 "playwright >= 1.48 required" when the context cannot route WebSockets', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-r2-'));
    try {
      const r = await run(['capture', '--url', 'file:///x.html', '--out', path.join(dir, 'o')], { cwd: dir, resolvePlaywright: fakePw({}) });
      assert.deepEqual(r, { captured: false, reason: 'playwright >= 1.48 required', exit: 4 });
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('exit 4 "the browser cannot apply the remote address guard" when DevTools interception is unavailable', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-r2-'));
    try {
      const page = { on() {}, url: () => 'about:blank' };
      const ctx = { routeWebSocket: async () => {}, route: async () => {}, newPage: async () => page, newCDPSession: async () => { throw new Error('no CDP here'); } };
      const r = await run(['capture', '--url', 'https://example.com/', '--out', path.join(dir, 'o'), '--allow-remote'], { cwd: dir, resolvePlaywright: fakePw(ctx) });
      assert.equal(r.exit, 4);
      assert.equal(r.captured, false);
      assert.match(r.reason, /^the browser cannot apply the remote address guard: no CDP here$/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('page-snapshot review r2: real captures', { skip: browserOk ? false : 'playwright or its browser cannot be resolved here' }, () => {
  let dir; let srv; let port; let rem; let rp; const sockets = new Set();
  const handler = (req, res) => {
    if (req.url === '/live') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>Live</title><img id="ok" src="/ok.png"><img id="r" src="/redir.png"><h1>live</h1>'
        + '<script>addEventListener("load", () => { const i = new Image(); i.src = "/stream.png"; document.body.appendChild(i); });</script>');
    }
    if (req.url === '/stream.png') {
      // an asset whose body never finishes (a camera feed, a stalled chunked response)
      res.writeHead(200, { 'content-type': 'image/png' });
      res.write(PNG.subarray(0, 8));
      const t = setInterval(() => res.write(Buffer.from([0])), 200);
      res.on('close', () => clearInterval(t));
      return;
    }
    if (req.url === '/redir.png') { res.writeHead(302, { location: '/b.png' }); return res.end(); }
    if (req.url === '/ok.png' || req.url === '/b.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
    res.writeHead(404); res.end();
  };
  const listen = async (host) => { const s = http.createServer(handler); s.on('connection', (c) => { sockets.add(c); c.on('close', () => sockets.delete(c)); }); await new Promise((r) => s.listen(0, host, r)); return s; };
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-r2-real-'));
    srv = await listen('127.0.0.1'); port = srv.address().port;
    rem = await listen('127.0.0.2'); rp = rem.address().port;
  });
  after(async () => {
    for (const c of sockets) c.destroy();
    await new Promise((r) => srv.close(r)); await new Promise((r) => rem.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('a body that never finishes is dropped within --timeout-ms; the files are written and the capture exits 0', { timeout: 60000 }, async () => {
    const out = path.join(dir, 'stream');
    const t0 = Date.now();
    const r = await run(['capture', '--url', `http://127.0.0.1:${port}/live`, '--out', out, '--timeout-ms', '3000'], { cwd: dir });
    const took = Date.now() - t0;
    assert.ok(took < 3000 + ps.BODY_GRACE_MS + 6000, `capture took ${took} ms`);
    assert.equal(r.captured, true);
    assert.equal(r.network_idle, false);
    const man = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8'));
    const reason = (u) => (man.skipped.find((x) => x.url === u) || {}).reason;
    assert.equal(reason(`http://127.0.0.1:${port}/stream.png`), ps.BODY_LATE, JSON.stringify(man.skipped));
    assert.ok(man.inlined.some((x) => x.url === `http://127.0.0.1:${port}/ok.png`), 'a finished body is still inlined');
    const html = await fs.readFile(path.join(out, 'page.html'), 'utf-8');
    assert.ok(html.includes(`http://127.0.0.1:${port}/stream.png`), 'the late asset keeps its absolute URL');
    assert.deepEqual((await fs.readdir(out)).sort(), ['manifest.json', 'page.html', 'screenshot.png']);
  });

  it('an image behind a 302 is inlined under the URL the element names (local and remote same-origin)', { timeout: 60000 }, async () => {
    for (const [base, extra] of [[`http://127.0.0.1:${port}`, []], [`http://127.0.0.2:${rp}`, ['--allow-remote']]]) {
      const out = path.join(dir, 'redir' + extra.length);
      const r = await run(['capture', '--url', `${base}/live`, '--out', out, '--timeout-ms', '2000', ...extra], { cwd: dir });
      assert.equal(r.captured, true);
      const man = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf-8'));
      assert.ok(man.inlined.some((x) => x.url === `${base}/redir.png`), `${base}: ${JSON.stringify(man.inlined)}`);
      assert.ok(!man.skipped.some((x) => x.url === `${base}/redir.png`), `${base}: ${JSON.stringify(man.skipped)}`);
      const html = await fs.readFile(path.join(out, 'page.html'), 'utf-8');
      assert.ok(!html.includes(`${base}/redir.png`), 'the redirected image keeps its remote URL');
    }
  });

  it('a remote page that does not load names the bypassed proxy when a proxy variable is set, and only then', { timeout: 60000 }, async () => {
    const s = http.createServer(); await new Promise((r) => s.listen(0, '127.0.0.2', r));
    const dead = s.address().port; await new Promise((r) => s.close(r));
    const url = `http://127.0.0.2:${dead}/`;
    const go = (env) => errOf(run(['capture', '--url', url, '--out', path.join(dir, 'dead'), '--allow-remote', '--timeout-ms', '5000'], { cwd: dir, env }));
    for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'ALL_PROXY']) {
      const e = await go({ [v]: 'http://proxy.test:3128' });
      assert.equal(e && e.code, 1, v);
      assert.match(e.message, /^could not load /);
      assert.ok(e.message.includes(ps.PROXY_HINT) && e.message.includes(`${v} is set`), e.message);
    }
    const plain = await go({});
    assert.equal(plain && plain.code, 1);
    assert.ok(!plain.message.includes(ps.PROXY_HINT), plain.message);
    // a local page never gets the hint: local mode does not involve the proxy question
    const local = await errOf(run(['capture', '--url', `http://127.0.0.1:${dead}/`, '--out', path.join(dir, 'dead2'), '--timeout-ms', '5000'], { cwd: dir, env: { HTTPS_PROXY: 'http://p' } }));
    assert.equal(local && local.code, 1);
    assert.ok(!local.message.includes(ps.PROXY_HINT), local.message);
  });
});
