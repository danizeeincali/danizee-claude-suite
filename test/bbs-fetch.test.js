/**
 * Contract for src/lib/bbs/fetch.js and the `fetch` verb — stream `fetch` of marathon 2026-10-07-bbs.
 * GET only · no body, no auth · private hosts and private redirects refused · 25 URLs / 20 MB per run ·
 * every request logged · shallow clone with tags and hooks off · foreign code never executed.
 * No network: fetchImpl, lookup and git are injected everywhere.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  EgressRefused, isPrivateAddress, isForbiddenHost, checkHost, hostOfRef,
  fetchUrl, extractLinks, cloneRepo, fetchRun, egressSummary, egressLine
} from '../src/lib/bbs/fetch.js';
import { intake } from '../src/lib/bbs/intake.js';
import { readJson, readJsonl } from '../src/lib/bbs/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(path.dirname(__dirname), 'src', 'lib', 'bbs', 'cli.js');
const sha = (b) => 'sha256:' + createHash('sha256').update(b).digest('hex');
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const now = () => new Date('2026-10-07T12:00:00Z');

/** A fetchImpl built from a table: url → { status, headers, body } (or a function of (url, init)). */
function fakeFetch(table, calls = []) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    const entry = typeof table[String(url)] === 'function' ? table[String(url)](String(url), init) : table[String(url)];
    if (!entry) return new Response('not found', { status: 404 });
    return new Response(entry.body ?? '', { status: entry.status ?? 200, headers: entry.headers ?? { 'content-type': 'text/html' } });
  };
}

describe('fetch — address and host policy', () => {
  it('isPrivateAddress: loopback, RFC1918, link-local, unspecified, ULA, IPv4-mapped IPv6; public addresses pass', () => {
    for (const ip of ['127.0.0.1', '127.9.9.9', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0',
      '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:7f00:1', '::FFFF:192.168.0.1']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '172.15.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
    assert.equal(isPrivateAddress('not-an-ip'), true, 'anything unparsable is treated as private (fail closed)');
  });

  it('isForbiddenHost: localhost names, .local/.internal/.localhost suffixes, literal private IPs; public names pass', () => {
    for (const h of ['localhost', 'LOCALHOST', 'foo.localhost', 'printer.local', 'db.internal', '127.0.0.1', '[::1]', '10.0.0.5', '::ffff:10.0.0.5']) {
      assert.equal(isForbiddenHost(h), true, h);
    }
    for (const h of ['example.com', 'github.com', 'docs.example.internal.example.com', '93.184.216.34']) {
      assert.equal(isForbiddenHost(h), false, h);
    }
    assert.equal(isForbiddenHost(''), true);
  });

  it('checkHost resolves ALL addresses and refuses when any one is private; literal IPs skip DNS', async () => {
    const calls = [];
    const lookup = async (host, opts) => { calls.push([host, opts]); return [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]; };
    await assert.rejects(() => checkHost('evil.example.com', { lookup }), (e) => e instanceof EgressRefused && /private/i.test(e.message) && /10\.0\.0\.1/.test(e.message));
    assert.deepEqual(calls[0][0], 'evil.example.com');
    assert.equal(calls[0][1]?.all, true, 'lookup is asked for all addresses');
    const ok = await checkHost('example.com', { lookup: publicLookup });
    assert.deepEqual(ok, ['93.184.216.34']);
    const noDns = [];
    await assert.rejects(() => checkHost('192.168.0.9', { lookup: async () => { noDns.push(1); return []; } }), EgressRefused);
    assert.equal(noDns.length, 0, 'literal IP never hits DNS');
    await assert.rejects(() => checkHost('example.com', { lookup: async () => [] }), (e) => e instanceof EgressRefused && /resolve/i.test(e.message));
    await assert.rejects(() => checkHost('example.com', { lookup: async () => { throw new Error('ENOTFOUND'); } }), (e) => e instanceof EgressRefused && /ENOTFOUND/.test(e.message));
  });

  it('hostOfRef handles http(s), ssh://, git:// and scp-style refs', () => {
    assert.equal(hostOfRef('https://github.com/a/b.git'), 'github.com');
    assert.equal(hostOfRef('http://Example.COM:8080/x'), 'example.com');
    assert.equal(hostOfRef('ssh://git@gitlab.com/a/b'), 'gitlab.com');
    assert.equal(hostOfRef('git://host.tld/a/b.git'), 'host.tld');
    assert.equal(hostOfRef('git@github.com:a/b.git'), 'github.com');
    assert.equal(hostOfRef('/local/path'), null);
  });
});

describe('fetch — fetchUrl', () => {
  it('sends GET with the suite user agent, no body, no auth/cookie headers, manual redirects; returns the body as a Buffer with the identity', async () => {
    const calls = [];
    const f = fakeFetch({ 'https://example.com/post': { body: '<html>hi</html>' } }, calls);
    const log = [];
    const r = await fetchUrl('https://example.com/post', { fetchImpl: f, lookup: publicLookup, onEgress: (row) => log.push(row), now });
    assert.equal(calls.length, 1);
    const init = calls[0].init;
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, 'manual');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('user-agent'), 'danizee-claude-suite-bbs');
    assert.equal(headers.get('authorization'), null);
    assert.equal(headers.get('cookie'), null);
    assert.ok(Buffer.isBuffer(r.body));
    assert.equal(r.body.toString(), '<html>hi</html>');
    assert.equal(r.status, 200);
    assert.equal(r.finalUrl, 'https://example.com/post');
    assert.equal(r.contentType, 'text/html');
    assert.deepEqual(r.hops, ['https://example.com/post']);
    assert.equal(log.length, 1);
    assert.equal(log[0].kind, 'http');
    assert.equal(log[0].method, 'GET');
    assert.equal(log[0].host, 'example.com');
    assert.equal(log[0].status, 200);
    assert.equal(log[0].bytes_in, Buffer.byteLength('<html>hi</html>'));
    assert.equal(log[0].bytes_out, 0);
    assert.equal(log[0].url, 'https://example.com/post');
  });

  it('refuses a private or forbidden host BEFORE any request, and logs the refusal with bytes_in 0', async () => {
    const calls = [];
    const f = fakeFetch({}, calls);
    const log = [];
    await assert.rejects(() => fetchUrl('http://localhost:3000/x', { fetchImpl: f, lookup: publicLookup, onEgress: (r) => log.push(r) }), EgressRefused);
    await assert.rejects(() => fetchUrl('https://internal.example.com/x', { fetchImpl: f, lookup: async () => [{ address: '10.1.1.1', family: 4 }], onEgress: (r) => log.push(r) }), EgressRefused);
    assert.equal(calls.length, 0, 'no request was sent');
    assert.equal(log.length, 2);
    assert.ok(log.every(r => r.refused && r.bytes_in === 0 && r.status === null));
  });

  it('follows redirects up to the limit, re-checking the host on every hop; a redirect to a private host is refused, not followed', async () => {
    const calls = [];
    const f = fakeFetch({
      'https://a.example.com/1': { status: 302, headers: { location: '/2' } },
      'https://a.example.com/2': { status: 301, headers: { location: 'https://b.example.com/3' } },
      'https://b.example.com/3': { body: 'final' }
    }, calls);
    const log = [];
    const r = await fetchUrl('https://a.example.com/1', { fetchImpl: f, lookup: publicLookup, onEgress: (x) => log.push(x) });
    assert.deepEqual(r.hops, ['https://a.example.com/1', 'https://a.example.com/2', 'https://b.example.com/3']);
    assert.equal(r.finalUrl, 'https://b.example.com/3');
    assert.equal(r.body.toString(), 'final');
    assert.equal(log.length, 3, 'every hop is logged');

    const calls2 = [];
    const f2 = fakeFetch({ 'https://a.example.com/r': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } } }, calls2);
    await assert.rejects(() => fetchUrl('https://a.example.com/r', { fetchImpl: f2, lookup: publicLookup, onEgress: () => {} }), (e) => e instanceof EgressRefused && /redirect/i.test(e.message));
    assert.equal(calls2.length, 1, 'the private target was never requested');

    const loop = {};
    for (let i = 0; i < 10; i++) loop[`https://a.example.com/l${i}`] = { status: 302, headers: { location: `/l${i + 1}` } };
    await assert.rejects(() => fetchUrl('https://a.example.com/l0', { fetchImpl: fakeFetch(loop), lookup: publicLookup, maxRedirects: 5, onEgress: () => {} }), (e) => e instanceof EgressRefused && /redirect/i.test(e.message));
    const noLoc = fakeFetch({ 'https://a.example.com/x': { status: 302 } });
    await assert.rejects(() => fetchUrl('https://a.example.com/x', { fetchImpl: noLoc, lookup: publicLookup, onEgress: () => {} }), /location/i);
  });

  it('refuses a body over maxBytes — by content-length up front, or while streaming — and a non-2xx final status is an error', async () => {
    const big = fakeFetch({ 'https://e.com/big': { body: 'x'.repeat(100), headers: { 'content-length': '100', 'content-type': 'text/plain' } } });
    await assert.rejects(() => fetchUrl('https://e.com/big', { fetchImpl: big, lookup: publicLookup, maxBytes: 50, onEgress: () => {} }), (e) => e instanceof EgressRefused && /size|bytes/i.test(e.message));
    const stream = fakeFetch({ 'https://e.com/stream': { body: 'y'.repeat(100), headers: { 'content-type': 'text/plain' } } });
    const log = [];
    await assert.rejects(() => fetchUrl('https://e.com/stream', { fetchImpl: stream, lookup: publicLookup, maxBytes: 50, onEgress: (r) => log.push(r) }), (e) => e instanceof EgressRefused && /size|bytes/i.test(e.message));
    assert.ok(log[0].bytes_in <= 100 && log[0].refused, 'the partial read is logged as refused');
    const notFound = fakeFetch({ 'https://e.com/404': { status: 404, body: 'nope' } });
    await assert.rejects(() => fetchUrl('https://e.com/404', { fetchImpl: notFound, lookup: publicLookup, onEgress: () => {} }), /404/);
    const ftp = fakeFetch({});
    await assert.rejects(() => fetchUrl('ftp://e.com/x', { fetchImpl: ftp, lookup: publicLookup, onEgress: () => {} }), /scheme/i);
  });

  it('times out: a fetchImpl that never resolves is aborted after timeoutMs and logged as refused', async () => {
    const never = (url, init) => new Promise((_, reject) => { init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
    const log = [];
    await assert.rejects(() => fetchUrl('https://e.com/slow', { fetchImpl: never, lookup: publicLookup, timeoutMs: 20, onEgress: (r) => log.push(r) }), /timeout|abort/i);
    assert.equal(log.length, 1);
    assert.ok(log[0].refused);
  });
});

describe('fetch — extractLinks', () => {
  it('collects absolute http(s) links from href attributes and bare URLs, resolved against the base, unique, in order; never anything else', () => {
    const html = `<a href="/rel">r</a> <a href='https://other.example.com/x?y=1'>o</a> <a href="mailto:a@b">m</a>
      see https://plain.example.com/p and https://other.example.com/x?y=1 again <a href="javascript:alert(1)">j</a> <a href="ftp://f/x">f</a>`;
    assert.deepEqual(extractLinks(html, 'https://base.example.com/dir/page'), [
      'https://base.example.com/rel', 'https://other.example.com/x?y=1', 'https://plain.example.com/p'
    ]);
    assert.deepEqual(extractLinks('no links here', 'https://b.example.com/'), []);
    assert.deepEqual(extractLinks('x'.repeat(10) + ' http://a.example.com/' + 'b'.repeat(5000), 'https://b.example.com/'), ['http://a.example.com/' + 'b'.repeat(5000)]);
  });

  it('caps the recorded list at 200 links', () => {
    const many = Array.from({ length: 250 }, (_, i) => `<a href="https://l.example.com/${i}">x</a>`).join(' ');
    assert.equal(extractLinks(many, 'https://b.example.com/').length, 200);
  });
});

describe('fetch — cloneRepo', () => {
  it('runs a shallow, tagless clone with hooks disabled and prompts off via the injected git runner, after the host check; returns the HEAD sha', async () => {
    const calls = [];
    const git = (args, cwd, env) => {
      calls.push({ args, cwd, env });
      if (args[0] === 'clone') return '';
      if (args[0] === 'rev-parse') return 'abcdef1234567890abcdef1234567890abcdef12\n';
      throw new Error('unexpected ' + args.join(' '));
    };
    const log = [];
    const dest = path.join(os.tmpdir(), `bbs-clone-${Date.now()}`);
    const r = await cloneRepo('https://github.com/a/b.git', dest, { git, lookup: publicLookup, onEgress: (x) => log.push(x) });
    assert.equal(r.sha, 'abcdef1234567890abcdef1234567890abcdef12');
    const clone = calls[0].args;
    assert.equal(clone[0], 'clone');
    assert.ok(clone.includes('--depth') && clone[clone.indexOf('--depth') + 1] === '1');
    assert.ok(clone.includes('--no-tags'));
    const c = clone.indexOf('-c');
    assert.ok(c >= 0 && /^core\.hooksPath=/.test(clone[c + 1]), 'hooks path overridden');
    assert.ok(clone.includes('--'), 'args end before the ref');
    assert.equal(clone[clone.length - 2], 'https://github.com/a/b.git');
    assert.equal(clone[clone.length - 1], dest);
    assert.equal(calls[0].env?.GIT_TERMINAL_PROMPT, '0');
    assert.equal(calls[0].env?.GIT_DIR, undefined);
    assert.deepEqual(calls[1].args, ['rev-parse', 'HEAD']);
    assert.equal(calls[1].cwd, dest);
    assert.equal(log.length, 1);
    assert.equal(log[0].kind, 'git');
    assert.equal(log[0].host, 'github.com');
    assert.equal(log[0].bytes_out, 0);
  });

  it('refuses a private clone host before running git, and never executes anything from the clone', async () => {
    const calls = [];
    const git = (args) => { calls.push(args); return ''; };
    await assert.rejects(() => cloneRepo('git@10.0.0.7:a/b.git', '/tmp/x', { git, lookup: publicLookup, onEgress: () => {} }), EgressRefused);
    await assert.rejects(() => cloneRepo('https://intranet.example.com/a/b', '/tmp/x', { git, lookup: async () => [{ address: '192.168.5.5', family: 4 }], onEgress: () => {} }), EgressRefused);
    assert.equal(calls.length, 0);
    await assert.rejects(() => cloneRepo('ftp://x/y', '/tmp/x', { git, lookup: publicLookup, onEgress: () => {} }), /scheme|ref/i);
  });

  it('a failing clone surfaces git stderr once and leaves no dest directory', async () => {
    const dest = path.join(os.tmpdir(), `bbs-clone-fail-${Date.now()}`);
    const git = () => { const e = new Error('Command failed'); e.stderr = 'fatal: repository not found\n'; throw e; };
    await assert.rejects(() => cloneRepo('https://github.com/a/missing.git', dest, { git, lookup: publicLookup, onEgress: () => {} }), /repository not found/);
    await assert.rejects(() => fs.stat(dest));
  });
});

describe('fetch — egress summary and line', () => {
  it('counts http and git rows only, sums bytes over all rows, keeps hosts unique in first-seen order', () => {
    const rows = [
      { kind: 'none', bytes_in: 0, bytes_out: 0 },
      { kind: 'http', host: 'a.com', bytes_in: 10, bytes_out: 0 },
      { kind: 'http', host: 'b.com', bytes_in: 5, bytes_out: 0, refused: 'private' },
      { kind: 'git', host: 'a.com', bytes_in: 0, bytes_out: 0 }
    ];
    assert.deepEqual(egressSummary(rows), { requests: 3, bytes_in: 15, bodies_sent: 0, hosts: ['a.com', 'b.com'], refused: 1 });
    assert.equal(egressLine(rows), 'requests=3 bytes_in=15 bodies_sent=0 hosts=a.com,b.com');
    assert.equal(egressLine([]), 'requests=0 bytes_in=0 bodies_sent=0 hosts=none');
  });
});

describe('fetch — fetchRun', () => {
  let dir;
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-fetchrun-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('url: fetches, stores fetched/1.html, finalises the identity, records cited links (never fetched), logs egress, marks fetched', async () => {
    const i = await intake(dir, 'https://example.com/post', { now });
    const html = '<html><a href="https://cited.example.com/a">a</a> body</html>';
    const calls = [];
    const r = await fetchRun(dir, { run: i.runId, fetchImpl: fakeFetch({ 'https://example.com/post': { body: html } }, calls), lookup: publicLookup, now });
    assert.equal(calls.length, 1, 'only the named URL is fetched — cited links are not');
    assert.equal(r.identity, sha(html));
    assert.equal(r.identity_pending, false);
    assert.equal(r.known, false);
    assert.equal(r.next, 'inventory');
    assert.equal(r.egress_line, `requests=1 bytes_in=${Buffer.byteLength(html)} bodies_sent=0 hosts=example.com`);
    assert.deepEqual(r.files, ['fetched/1.html']);
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', i.runId);
    assert.equal(await fs.readFile(path.join(runDir, 'fetched', '1.html'), 'utf-8'), html);
    const source = await readJson(path.join(runDir, 'source.json'));
    assert.equal(source.fetched, true);
    assert.equal(source.identity, sha(html));
    assert.deepEqual(source.cited, ['https://cited.example.com/a']);
    assert.equal(source.final_url, 'https://example.com/post');
    const egress = await readJsonl(path.join(runDir, 'egress.jsonl'));
    assert.equal(egress.length, 1);
    assert.equal(egress[0].kind, 'http');
    const status = await fs.readFile(path.join(runDir, 'status.md'), 'utf-8');
    assert.match(status, /- Egress: requests=1 /);
    assert.match(status, /- Next: `cli\.js inventory`/);
  });

  it('url refused (private redirect): source.json unchanged, no fetched/ file, the attempted hops are logged, and the error is an EgressRefused', async () => {
    const i = await intake(dir, 'https://a.example.com/r', { now });
    const f = fakeFetch({ 'https://a.example.com/r': { status: 302, headers: { location: 'http://127.0.0.1/admin' } } });
    await assert.rejects(() => fetchRun(dir, { run: i.runId, fetchImpl: f, lookup: publicLookup, now }), EgressRefused);
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', i.runId);
    const source = await readJson(path.join(runDir, 'source.json'));
    assert.equal(source.fetched, false);
    assert.equal(source.identity, 'pending');
    await assert.rejects(() => fs.readdir(path.join(runDir, 'fetched')));
    const egress = await readJsonl(path.join(runDir, 'egress.jsonl'));
    assert.ok(egress.length >= 1 && egress.some(e => e.refused), 'the refusal is on record');
  });

  it('a fetched url whose identity is already in the registry comes back known with reuse_from', async () => {
    const { appendRegistry } = await import('../src/lib/bbs/store.js');
    const body = 'same content';
    await appendRegistry(dir, { identity: sha(body), type: 'url', ref: 'https://old.example.com/', run: '2026-10-01-old' });
    const i = await intake(dir, 'https://new.example.com/', { now });
    const r = await fetchRun(dir, { run: i.runId, fetchImpl: fakeFetch({ 'https://new.example.com/': { body, headers: { 'content-type': 'text/plain' } } }), lookup: publicLookup, now });
    assert.equal(r.known, true);
    assert.equal(r.reuse_from, '2026-10-01-old');
    assert.deepEqual(r.files, ['fetched/1.txt']);
    const source = await readJson(path.join(dir, '.claude', 'bbs', 'runs', i.runId, 'source.json'));
    assert.equal(source.reuse_from, '2026-10-01-old');
  });

  it('repo: clones into fetched/repo with the injected git, identity git:<sha>, egress kind git', async () => {
    const i = await intake(dir, 'https://github.com/a/b', { now });
    const git = (args, cwd) => args[0] === 'clone' ? '' : 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n';
    const r = await fetchRun(dir, { run: i.runId, git, lookup: publicLookup, now });
    assert.equal(r.identity, 'git:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    assert.equal(r.egress_line, 'requests=1 bytes_in=0 bodies_sent=0 hosts=github.com');
    assert.deepEqual(r.files, ['fetched/repo']);
    const source = await readJson(path.join(dir, '.claude', 'bbs', 'runs', i.runId, 'source.json'));
    assert.equal(source.fetched, true);
    assert.equal(source.identity, 'git:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  });

  it('local and paste: nothing to fetch — a no-op success with requests=0 and next inventory; fetching an already-fetched url again is refused', async () => {
    const p = await intake(dir, '-', { stdin: 'pasted', now, slug: 'np' });
    const r = await fetchRun(dir, { run: p.runId, fetchImpl: fakeFetch({}), lookup: publicLookup, now });
    assert.equal(r.nothing_to_fetch, true);
    assert.equal(r.egress_line, 'requests=0 bytes_in=0 bodies_sent=0 hosts=none');
    assert.equal(r.next, 'inventory');
    const egress = await readJsonl(path.join(dir, '.claude', 'bbs', 'runs', p.runId, 'egress.jsonl'));
    assert.equal(egress.length, 1, 'no second zero row is added');
    const u = await intake(dir, 'https://once.example.com/', { now });
    await fetchRun(dir, { run: u.runId, fetchImpl: fakeFetch({ 'https://once.example.com/': { body: 'a' } }), lookup: publicLookup, now });
    await assert.rejects(() => fetchRun(dir, { run: u.runId, fetchImpl: fakeFetch({ 'https://once.example.com/': { body: 'b' } }), lookup: publicLookup, now }), /already fetched/i);
  });

  it('per-run limits: a run that already logged max_urls requests, or whose bytes would pass max_bytes, is refused before any request', async () => {
    const i = await intake(dir, 'https://lim.example.com/', { now, slug: 'lim' });
    const calls = [];
    const cfg = { ...(await import('../src/lib/bbs/config.js')).DEFAULT_CONFIG, limits: { max_urls: 1, max_bytes: 10, max_powers: 12, max_redirects: 5, timeout_ms: 1000 } };
    await assert.rejects(() => fetchRun(dir, { run: i.runId, cfg, fetchImpl: fakeFetch({ 'https://lim.example.com/': { body: 'x'.repeat(11), headers: { 'content-type': 'text/plain' } } }, calls), lookup: publicLookup, now }), (e) => e instanceof EgressRefused && /bytes|size/i.test(e.message));
    const egress = await readJsonl(path.join(dir, '.claude', 'bbs', 'runs', i.runId, 'egress.jsonl'));
    assert.ok(egress.some(e => e.refused), 'the over-size attempt is on record');
    const j = await intake(dir, 'https://lim2.example.com/', { now, slug: 'lim2' });
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', j.runId);
    const { appendJsonl } = await import('../src/lib/bbs/store.js');
    await appendJsonl(path.join(runDir, 'egress.jsonl'), { kind: 'http', method: 'GET', url: 'https://x/', host: 'x', status: 200, bytes_in: 1, bytes_out: 0 });
    const calls2 = [];
    await assert.rejects(() => fetchRun(dir, { run: j.runId, cfg, fetchImpl: fakeFetch({}, calls2), lookup: publicLookup, now }), (e) => e instanceof EgressRefused && /max_urls|links|requests/i.test(e.message));
    assert.equal(calls2.length, 0);
  });
});

describe('fetch — cli verb', () => {
  let dir;
  function run(cwd, args, input, env = {}) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', input, env: { ...process.env, ...env } });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-fetchcli-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('fetch is listed in usage, takes --run/--project/--max-bytes/--max-links only, and rejects positionals', () => {
    const u = run(dir, ['nope']);
    assert.match(u.err, /cli\.js fetch \[--run <id>\] \[--max-bytes <n>\] \[--max-links <n>\] \[--project <dir>\]/);
    const p = run(dir, ['fetch', 'extra']);
    assert.equal(p.code, 1);
    assert.match(p.err, /unexpected argument "extra"/);
    const b = run(dir, ['fetch', '--max-bytes']);
    assert.equal(b.code, 1);
  });

  it('fetch with no active run → exit 1; a paste run → no-op success with the egress line in the JSON', () => {
    const none = run(dir, ['fetch']);
    assert.equal(none.code, 1);
    assert.match(none.err, /no active run/i);
    const p = run(dir, ['intake', '-', '--slug', 'cp'], 'pasted');
    assert.equal(p.code, 0, p.err);
    const f = run(dir, ['fetch']);
    assert.equal(f.code, 0, f.err);
    assert.equal(f.json.nothing_to_fetch, true);
    assert.equal(f.json.egress_line, 'requests=0 bytes_in=0 bodies_sent=0 hosts=none');
    assert.equal(f.json.next, 'inventory');
  });

  it('BBS_NO_NETWORK=1 makes the real fetch path refuse with exit 2 before any socket is opened (the test suite never touches the network)', async () => {
    const u = run(dir, ['intake', 'https://example.com/never', '--slug', 'nn']);
    assert.equal(u.code, 0, u.err);
    const f = run(dir, ['fetch'], undefined, { BBS_NO_NETWORK: '1' });
    assert.equal(f.code, 2);
    assert.match(f.err, /^bbs: refused: /);
    assert.match(f.err, /BBS_NO_NETWORK/);
    const source = await readJson(path.join(dir, '.claude', 'bbs', 'runs', u.json.runId, 'source.json'));
    assert.equal(source.fetched, false);
    const egress = await readJsonl(path.join(dir, '.claude', 'bbs', 'runs', u.json.runId, 'egress.jsonl'));
    assert.ok(egress.some(e => e.refused && /BBS_NO_NETWORK/.test(e.refused)));
  });

  it('a private-host url is refused with exit 2 without BBS_NO_NETWORK, and leaves the run unfetched', async () => {
    const u = run(dir, ['intake', 'http://localhost:8080/admin', '--slug', 'lh']);
    assert.equal(u.code, 0, u.err);
    const f = run(dir, ['fetch']);
    assert.equal(f.code, 2);
    assert.match(f.err, /^bbs: refused: .*(private|forbidden|localhost)/i);
    const source = await readJson(path.join(dir, '.claude', 'bbs', 'runs', u.json.runId, 'source.json'));
    assert.equal(source.fetched, false);
  });

  it('--max-bytes and --max-links must be positive integers', () => {
    run(dir, ['intake', '-', '--slug', 'mb'], 'x');
    for (const bad of [['--max-bytes', '0'], ['--max-bytes', 'ten'], ['--max-links', '-1'], ['--max-links', '2.5']]) {
      const r = run(dir, ['fetch', ...bad]);
      assert.equal(r.code, 1, bad.join(' '));
      assert.match(r.err, /positive integer/);
    }
  });
});
