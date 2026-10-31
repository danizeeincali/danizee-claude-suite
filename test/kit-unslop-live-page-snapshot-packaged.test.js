import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { installPackaged } from './helpers/packaged.js';
import { resolvePlaywright } from '../src/lib/kit/frame-capture.js';

const pw = await resolvePlaywright(process.cwd());
let browserOk = false;
if (pw) { try { const b = await pw.chromium.launch({ headless: true }); await b.close(); browserOk = true; } catch { /* no browser */ } }

describe('page-snapshot — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('lists the verb, plans, refuses remote URLs and bad input, zero egress', async () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('page-snapshot'));
    const p = pkg.kit(['page-snapshot', 'plan', '--url', 'https://example.com/']);
    assert.equal(p.code, 0);
    assert.equal(p.json.needs_consent, true);
    assert.equal(p.json.local, false);
    assert.deepEqual(p.json.out_files, ['page.html', 'screenshot.png', 'manifest.json']);
    const l = pkg.kit(['page-snapshot', 'plan', '--url', 'http://localhost:3000/', '--out', 'snap']);
    assert.equal(l.json.needs_consent, false);
    assert.equal(l.json.out_files[0], 'snap/page.html');
    const refused = pkg.kit(['page-snapshot', 'capture', '--url', 'https://example.com/', '--out', 'o']);
    assert.equal(refused.code, 2);
    assert.equal(refused.out, '');
    assert.match(refused.err, /refused/);
    assert.equal(pkg.kit(['page-snapshot', 'capture', '--url', 'ftp://example.com/', '--out', 'o', '--allow-remote']).code, 2);
    assert.equal(pkg.kit(['page-snapshot', 'plan']).code, 1);
    assert.equal(pkg.kit(['page-snapshot', 'plan', '--url', 'nope']).code, 1);
    assert.equal(pkg.kit(['page-snapshot', 'capture', '--url', 'file:///x.html']).code, 1);
    assert.equal(pkg.kit(['page-snapshot', 'capture', '--url', 'file:///x.html', '--out', 'o', '--width', 'x']).code, 1);
    assert.equal(pkg.kit(['page-snapshot', 'nope']).code, 1);
    await assert.rejects(fs.stat(path.join(pkg.dir, 'o')));
    assert.deepEqual(pkg.egress(), []);
  });

  it('captures a file:// page with the installed verb under the egress preload; the remote reference is blocked at the browser', { skip: browserOk ? false : 'playwright cannot be resolved here' }, async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await fs.mkdir(path.join(pkg.dir, 'site'), { recursive: true });
    await fs.writeFile(path.join(pkg.dir, 'site', 'a.html'), '<!doctype html><title>A</title><link rel="stylesheet" href="s.css"><h1>Hi</h1><img src="i.png"><img src="http://blocked.invalid/x.png"><script>1</script>');
    await fs.writeFile(path.join(pkg.dir, 'site', 's.css'), 'h1{color:rgb(1, 2, 3)}');
    await fs.writeFile(path.join(pkg.dir, 'site', 'i.png'), png);
    const url = pathToFileURL(path.join(pkg.dir, 'site', 'a.html')).href;
    // The egress preload stays on (Node side: no socket, DNS or other child process); it lets through only the Playwright
    // browsers folder, so the launch, the route handler, response capture and file writing all run guarded.
    const browsers = path.resolve(pw.chromium.executablePath(), '..', '..', '..');
    const before = pkg.egress().length;
    const r = pkg.kit(['page-snapshot', 'capture', '--url', url, '--out', 'snap'], undefined, { extraEnv: { KIT_EGRESS_ALLOW_EXEC: browsers } });
    assert.equal(r.code, 0, r.err);
    assert.ok(r.json, r.out);
    assert.equal(r.json.captured, true);
    // the browser blocker took effect on the remote reference, and nothing on the Node side tried to leave the machine
    assert.deepEqual(r.json.blocked_origins, ['http://blocked.invalid']);
    assert.equal(pkg.egress().length, before);
    assert.deepEqual(pkg.egress(), []);
    assert.equal(r.json.inlined_count, 1);
    const html = await fs.readFile(path.join(pkg.dir, 'snap', 'page.html'), 'utf-8');
    assert.ok(!/<script/.test(html));
    assert.ok(html.includes('data:image/png;base64,'));
    assert.ok(html.includes('rgb(1, 2, 3)'));
    assert.deepEqual((await fs.readdir(path.join(pkg.dir, 'snap'))).sort(), ['manifest.json', 'page.html', 'screenshot.png']);
  });

  it('the preload is on for a capture past the URL policy: with no browser allowed the launch is refused and logged', { skip: browserOk ? false : 'playwright cannot be resolved here' }, async () => {
    // a separate log, so the suite's own egress log keeps its zero; this run shows the guard is live, not bypassed
    const probeLog = path.join(pkg.dir, 'probe-egress.jsonl');
    const c = pkg.kit(['page-snapshot', 'capture', '--url', pathToFileURL(path.join(pkg.dir, 'site', 'a.html')).href, '--out', 'snap3'], undefined, { extraEnv: { KIT_EGRESS_LOG: probeLog } });
    assert.equal(c.code, 4, c.err);
    assert.match(c.json.reason, /browser could not start/);
    const rows = (await fs.readFile(probeLog, 'utf-8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(rows.length >= 1, 'the preload logged nothing');
    // only the refused browser launch: no socket, DNS lookup or fetch from the Node side
    assert.deepEqual(rows.filter((x) => !/^child_process\./.test(x.kind)), []);
  });

  it('ends with zero egress after a final guarded run (plan on a local URL, past the refusal path)', () => {
    const l = pkg.kit(['page-snapshot', 'plan', '--url', pathToFileURL(path.join(pkg.dir, 'site', 'a.html')).href, '--out', 'snap2']);
    assert.equal(l.code, 0, l.err);
    assert.equal(l.json.local, true);
    assert.equal(l.json.needs_consent, false);
    assert.deepEqual(pkg.egress(), []);
  });
});
