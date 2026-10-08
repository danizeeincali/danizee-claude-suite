/**
 * Contract for src/lib/bbs/fetch.js and the `fetch` verb — stream `fetch` of marathon 2026-10-07-bbs.
 * GET only · no body, no auth · private hosts and private redirects refused · 25 URLs / 20 MB per run ·
 * every request logged · shallow clone with tags and hooks off · foreign code never executed.
 * No network: fetchImpl, lookup and git are injected everywhere.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import fsSync from 'fs';
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
    return new Response(entry.status === 204 ? null : (entry.body ?? ''), { status: entry.status ?? 200, headers: entry.headers ?? { 'content-type': 'text/html' } });
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

  it('r2: checkHost races the lookup against timeoutMs — a lookup that never resolves is refused', async () => {
    await assert.rejects(() => checkHost('slow.example.com', { lookup: () => new Promise(() => {}), timeoutMs: 20 }),
      (e) => e instanceof EgressRefused && /cannot resolve slow\.example\.com: timeout after 20 ms/.test(e.message));
  });

  it('r2: fetchUrl and cloneRepo pass their timeoutMs to the lookup race', async () => {
    const never = () => new Promise(() => {});
    const log = [];
    await assert.rejects(() => fetchUrl('https://hang.example.com/', { fetchImpl: async () => { throw new Error('no'); }, lookup: never, timeoutMs: 20, onEgress: (r) => log.push(r) }), (e) => e instanceof EgressRefused && /timeout after 20 ms/.test(e.message));
    assert.ok(log[0].refused);
    await assert.rejects(() => cloneRepo('https://hang.example.com/a.git', path.join(os.tmpdir(), `bbs-hang-${Date.now()}`), { git: () => { throw new Error('no git'); }, lookup: never, timeoutMs: 20, onEgress: () => {} }), (e) => e instanceof EgressRefused && /timeout after 20 ms/.test(e.message));
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

  it('r3: a transport failure names the real cause from err.cause (code), in both the thrown error and the egress row', async () => {
    const failing = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }) }); };
    const log = [];
    await assert.rejects(() => fetchUrl('https://down.example.com/', { fetchImpl: failing, lookup: publicLookup, onEgress: (r) => log.push(r) }),
      (e) => /request to https:\/\/down\.example\.com\/ failed: fetch failed/.test(e.message) && /ECONNREFUSED/.test(e.message));
    assert.equal(log.length, 1);
    assert.match(log[0].error, /fetch failed/);
    assert.match(log[0].error, /ECONNREFUSED/);
  });

  it('r3: an AggregateError cause lists every inner code', async () => {
    const agg = new AggregateError([
      Object.assign(new Error('connect ECONNREFUSED 93.184.216.34:443'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('connect ENETUNREACH 2606:2800::1:443'), { code: 'ENETUNREACH' })
    ], 'all attempts failed');
    const failing = async () => { throw new TypeError('fetch failed', { cause: agg }); };
    const log = [];
    await assert.rejects(() => fetchUrl('https://down.example.com/', { fetchImpl: failing, lookup: publicLookup, onEgress: (r) => log.push(r) }),
      (e) => /ECONNREFUSED/.test(e.message) && /ENETUNREACH/.test(e.message));
    assert.match(log[0].error, /ECONNREFUSED/);
    assert.match(log[0].error, /ENETUNREACH/);
  });

  it('times out: a fetchImpl that never resolves is aborted after timeoutMs and logged as refused', async () => {
    const never = (url, init) => new Promise((_, reject) => { init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
    const log = [];
    await assert.rejects(() => fetchUrl('https://e.com/slow', { fetchImpl: never, lookup: publicLookup, timeoutMs: 20, onEgress: (r) => log.push(r) }), /timeout|abort/i);
    assert.equal(log.length, 1);
    assert.ok(log[0].refused);
    assert.equal(egressSummary(log).requests, 1, 'a timed-out request was sent, so it counts');
  });

  const chain = (n) => {
    const t = {};
    for (let i = 0; i < n; i++) t[`https://a.example.com/c${i}`] = { status: 302, headers: { location: `/c${i + 1}` } };
    t[`https://a.example.com/c${n}`] = { body: 'end', headers: { 'content-type': 'text/plain' } };
    return t;
  };

  it('redirect boundary: a 5-redirect chain succeeds with exactly 6 requests; a 6-redirect chain is refused with a refused row for the next hop', async () => {
    const calls = [];
    const r = await fetchUrl('https://a.example.com/c0', { fetchImpl: fakeFetch(chain(5), calls), lookup: publicLookup, maxRedirects: 5, onEgress: () => {} });
    assert.equal(r.body.toString(), 'end');
    assert.equal(calls.length, 6);
    const calls2 = [];
    const log = [];
    await assert.rejects(() => fetchUrl('https://a.example.com/c0', { fetchImpl: fakeFetch(chain(6), calls2), lookup: publicLookup, maxRedirects: 5, onEgress: (x) => log.push(x) }),
      (e) => e instanceof EgressRefused && /redirect/i.test(e.message));
    assert.equal(calls2.length, 6, 'the 7th url is never requested');
    const last = log[log.length - 1];
    assert.ok(last.refused && /redirect/i.test(last.refused), 'the refusal is logged');
    assert.equal(last.url, 'https://a.example.com/c6', 'the refused row names the hop that was not followed');
    assert.equal(last.status, null);
    assert.equal(last.bytes_in, 0);
  });

  it('byte boundary: a body of exactly maxBytes succeeds and maxBytes+1 is refused — via content-length and via streaming', async () => {
    const withLen = (n) => fakeFetch({ 'https://e.com/b': { body: 'z'.repeat(n), headers: { 'content-length': String(n), 'content-type': 'text/plain' } } });
    const noLen = (n) => fakeFetch({ 'https://e.com/b': { body: 'z'.repeat(n), headers: { 'content-type': 'text/plain' } } });
    for (const mk of [withLen, noLen]) {
      const ok = await fetchUrl('https://e.com/b', { fetchImpl: mk(50), lookup: publicLookup, maxBytes: 50, onEgress: () => {} });
      assert.equal(ok.body.length, 50);
      await assert.rejects(() => fetchUrl('https://e.com/b', { fetchImpl: mk(51), lookup: publicLookup, maxBytes: 50, onEgress: () => {} }),
        (e) => e instanceof EgressRefused && /bytes/i.test(e.message));
    }
  });

  it('maxRequests caps every hop: with an allowance of 1 and one redirect, exactly 1 request is sent and the next hop is refused (max_urls)', async () => {
    const calls = [];
    const log = [];
    await assert.rejects(() => fetchUrl('https://a.example.com/c0', { fetchImpl: fakeFetch(chain(1), calls), lookup: publicLookup, maxRequests: 1, onEgress: (x) => log.push(x) }),
      (e) => e instanceof EgressRefused && /max_urls/.test(e.message));
    assert.equal(calls.length, 1);
    assert.equal(log.length, 2);
    assert.ok(log[1].refused && /max_urls/.test(log[1].refused));
    assert.equal(log[1].status, null);
    assert.equal(log[1].bytes_in, 0);
    const none = [];
    await assert.rejects(() => fetchUrl('https://a.example.com/c0', { fetchImpl: fakeFetch(chain(0), none), lookup: publicLookup, maxRequests: 0, onEgress: () => {} }), /max_urls/);
    assert.equal(none.length, 0);
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
    // r1 hardening: no redirects, no credential helper, no lfs filters, only https/ssh transports, no submodules
    const configs = clone.filter((_, k) => clone[k - 1] === '-c');
    for (const want of ['http.followRedirects=false', 'credential.helper=', 'filter.lfs.smudge=', 'filter.lfs.process=',
      'filter.lfs.required=false', 'protocol.allow=never', 'protocol.https.allow=always', 'protocol.ssh.allow=always']) {
      assert.ok(configs.includes(want), `clone sets -c ${want}`);
    }
    assert.ok(clone.includes('--no-recurse-submodules'));
    assert.ok(clone.indexOf('--') > clone.lastIndexOf('-c'), 'every option comes before --');
    const env = calls[0].env;
    assert.equal(env.GIT_LFS_SKIP_SMUDGE, '1');
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
    assert.match(env.GIT_SSH_COMMAND, /BatchMode=yes/);
    assert.match(env.GIT_SSH_COMMAND, /StrictHostKeyChecking=accept-new/);
  });

  it('r3: isolates global config on git < 2.32 — HOME and XDG_CONFIG_HOME point at one empty scratch dir that exists during the git calls and is removed after', async () => {
    const seen = [];
    const git = async (args, cwd, env) => {
      const st = await fs.stat(env.HOME);
      seen.push({ args, home: env.HOME, xdg: env.XDG_CONFIG_HOME, isDir: st.isDirectory(), entries: await fs.readdir(env.HOME) });
      if (args[0] === 'clone') return '';
      if (args[0] === 'rev-parse') return 'abcdef1234567890abcdef1234567890abcdef12\n';
      throw new Error('unexpected ' + args.join(' '));
    };
    const dest = path.join(os.tmpdir(), `bbs-clone-home-${Date.now()}`);
    await cloneRepo('https://github.com/a/b.git', dest, { git, lookup: publicLookup, onEgress: () => {} });
    assert.equal(seen.length, 2);
    for (const s of seen) {
      assert.ok(typeof s.home === 'string' && s.home.length > 0, 'HOME is set');
      assert.ok(typeof s.xdg === 'string' && s.xdg.length > 0, 'XDG_CONFIG_HOME is set');
      assert.equal(s.home, s.xdg, 'HOME and XDG_CONFIG_HOME are the same scratch dir');
      assert.notEqual(path.resolve(s.home), path.resolve(os.homedir()), 'HOME is not the real home');
      assert.ok(s.isDir, 'the scratch dir exists during the git call');
      assert.deepEqual(s.entries, [], 'the scratch dir is empty (no gitconfig)');
    }
    assert.equal(seen[0].home, seen[1].home, 'one scratch dir for clone and rev-parse');
    await assert.rejects(() => fs.stat(seen[0].home), { code: 'ENOENT' }, 'the scratch dir is removed after the clone');
    // the r1-r2 env guarantees still hold alongside
    const env = await (async () => { let e; await cloneRepo('https://github.com/a/b.git', dest + '-2', { git: (a, c, en) => { e = en; return a[0] === 'clone' ? '' : 'abcdef1234567890abcdef1234567890abcdef12'; }, lookup: publicLookup, onEgress: () => {} }); return e; })();
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  });

  it('r3: removes the scratch HOME dir when the clone fails too', async () => {
    let home;
    const git = (args, cwd, env) => { home = env.HOME; throw Object.assign(new Error('boom'), { stderr: 'fatal: boom' }); };
    await assert.rejects(() => cloneRepo('https://github.com/a/b.git', path.join(os.tmpdir(), `bbs-clone-fail-${Date.now()}`), { git, lookup: publicLookup, onEgress: () => {} }), /git clone failed: fatal: boom/);
    assert.ok(home && home !== os.homedir());
    await assert.rejects(() => fs.stat(home), { code: 'ENOENT' });
  });

  it('r3: persisted -c values are harmless — core.hooksPath is exactly /dev/null (no temp dir another user could recreate)', async () => {
    let clone;
    const git = (args) => { if (args[0] === 'clone') { clone = args; return ''; } return 'abcdef1234567890abcdef1234567890abcdef12\n'; };
    await cloneRepo('https://github.com/a/b.git', path.join(os.tmpdir(), `bbs-clone-hp-${Date.now()}`), { git, lookup: publicLookup, onEgress: () => {} });
    const configs = clone.filter((_, k) => clone[k - 1] === '-c');
    const hooks = configs.filter(c => c.startsWith('core.hooksPath='));
    assert.deepEqual(hooks, ['core.hooksPath=/dev/null']);
  });

  it('refuses http:// and git:// (and any non https/ssh/scp ref) with a refused git row and no git call', async () => {
    for (const ref of ['http://github.com/a/b.git', 'git://github.com/a/b.git', 'ftp://github.com/a/b']) {
      const calls = [];
      const log = [];
      const git = (args) => { calls.push(args); return ''; };
      await assert.rejects(() => cloneRepo(ref, '/tmp/x', { git, lookup: publicLookup, onEgress: (r) => log.push(r) }),
        (e) => e instanceof EgressRefused && /scheme/i.test(e.message), ref);
      assert.equal(calls.length, 0, `${ref}: git never ran`);
      assert.equal(log.length, 1, `${ref}: one row`);
      assert.equal(log[0].kind, 'git');
      assert.ok(log[0].refused && /scheme/i.test(log[0].refused));
      assert.equal(log[0].status, null);
      assert.equal(log[0].bytes_in, 0);
    }
    for (const ref of ['ssh://git@github.com/a/b.git', 'git@github.com:a/b.git']) {
      const calls = [];
      const git = (args) => { calls.push(args); return args[0] === 'rev-parse' ? 'abcdef1234567890abcdef1234567890abcdef12\n' : ''; };
      const dest = path.join(os.tmpdir(), `bbs-clone-ok-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      await cloneRepo(ref, dest, { git, lookup: publicLookup, onEgress: () => {} });
      assert.equal(calls[0][0], 'clone', `${ref} is accepted`);
    }
  });

  it('passes a timeout (10x timeoutMs) to the git runner for the clone; the default runner turns a timeout into an error naming it', async () => {
    const seen = [];
    const git = (args, cwd, env, opts) => { seen.push({ args, opts }); return args[0] === 'rev-parse' ? 'abcdef1234567890abcdef1234567890abcdef12\n' : ''; };
    const dest = path.join(os.tmpdir(), `bbs-clone-to-${Date.now()}`);
    await cloneRepo('https://github.com/a/b.git', dest, { git, lookup: publicLookup, onEgress: () => {}, timeoutMs: 1234 });
    assert.equal(seen[0].opts?.timeout, 12340);
    assert.equal(seen[1].opts?.timeout, 1234);
    const { runGit } = await import('../src/lib/bbs/fetch.js');
    const execSeen = [];
    const exec = (cmd, args, o) => { execSeen.push(o); const e = new Error('spawnSync git ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; };
    assert.throws(() => runGit(['clone', 'x'], '/tmp', {}, { timeout: 50, exec }), /timeout/i);
    assert.equal(execSeen[0].timeout, 50);
    const execSig = () => { const e = new Error('killed'); e.signal = 'SIGTERM'; throw e; };
    assert.throws(() => runGit(['clone', 'x'], '/tmp', {}, { timeout: 50, exec: execSig }), /timeout/i);
  });

  it('measures the cloned tree (including .git) as bytes_in, and refuses and removes a clone over the remaining byte allowance', async () => {
    const git = (args) => {
      if (args[0] === 'clone') {
        const dest = args[args.length - 1];
        fsSync.mkdirSync(path.join(dest, '.git'), { recursive: true });
        fsSync.writeFileSync(path.join(dest, 'README'), 'x'.repeat(100));
        fsSync.writeFileSync(path.join(dest, '.git', 'pack'), 'y'.repeat(50));
        return '';
      }
      return 'abcdef1234567890abcdef1234567890abcdef12\n';
    };
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-clone-bytes-'));
    try {
      const log = [];
      await cloneRepo('https://github.com/a/b.git', path.join(base, 'ok'), { git, lookup: publicLookup, onEgress: (r) => log.push(r), maxBytes: 150 });
      assert.equal(log.length, 1);
      assert.equal(log[0].bytes_in, 150, 'README + .git/pack');
      assert.ok(!log[0].refused);
      const log2 = [];
      const big = path.join(base, 'big');
      await assert.rejects(() => cloneRepo('https://github.com/a/b.git', big, { git, lookup: publicLookup, onEgress: (r) => log2.push(r), maxBytes: 149 }),
        (e) => e instanceof EgressRefused && /bytes/i.test(e.message));
      await assert.rejects(() => fs.stat(big), 'the over-size clone is removed');
      assert.equal(log2.length, 1);
      assert.equal(log2[0].bytes_in, 150);
      assert.ok(log2[0].refused && /bytes/i.test(log2[0].refused));
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
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

  it('r2: a failed clone that wrote data logs the partial bytes as bytes_in on the error row', async () => {
    const dest = path.join(os.tmpdir(), `bbs-clone-partial-${Date.now()}`);
    const git = (args) => { fsSync.mkdirSync(dest, { recursive: true }); fsSync.writeFileSync(path.join(dest, 'part'), 'z'.repeat(37)); const e = new Error('Command failed'); e.stderr = 'fatal: early EOF\n'; throw e; };
    const log = [];
    await assert.rejects(() => cloneRepo('https://github.com/a/partial.git', dest, { git, lookup: publicLookup, onEgress: (r) => log.push(r) }), /early EOF/);
    await assert.rejects(() => fs.stat(dest));
    const errRow = log.find(r => r.error);
    assert.ok(errRow && errRow.bytes_in === 37, `bytes_in ${errRow?.bytes_in}`);
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

  it('a pre-connect refusal (status null, bytes_in 0) is a refusal, not a request; transport errors and timeouts were sent', () => {
    const rows = [
      { kind: 'http', host: 'a.com', status: 200, bytes_in: 10, bytes_out: 0 },
      { kind: 'http', host: 'evil.com', status: null, bytes_in: 0, bytes_out: 0, refused: 'host evil.com is a private address' },
      { kind: 'git', host: 'g.com', status: null, bytes_in: 0, bytes_out: 0, refused: 'scheme git:// is not cloned' }
    ];
    assert.deepEqual(egressSummary(rows), { requests: 1, bytes_in: 10, bodies_sent: 0, hosts: ['a.com'], refused: 2 });
    assert.equal(egressLine(rows), 'requests=1 bytes_in=10 bodies_sent=0 hosts=a.com');
    const sent = [
      { kind: 'http', host: 'a.com', status: null, bytes_in: 0, bytes_out: 0, error: 'ECONNRESET' },
      { kind: 'http', host: 'b.com', status: null, bytes_in: 0, bytes_out: 0, sent: true, refused: 'timeout after 20 ms fetching https://b.com/' },
      { kind: 'git', host: 'c.com', status: null, bytes_in: 0, bytes_out: 0, error: 'fatal: repository not found' }
    ];
    assert.equal(egressSummary(sent).requests, 3);
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

  it('a url whose credential-like query value intake redacted is refused (EgressRefused, refused row), never fetched', async () => {
    const i = await intake(dir, 'https://docs.example.com/p?key=intro', { now, slug: 'red' });
    const calls = [];
    await assert.rejects(() => fetchRun(dir, { run: i.runId, fetchImpl: fakeFetch({}, calls), lookup: publicLookup, now }),
      (e) => e instanceof EgressRefused && /credential-like query value that intake redacted/.test(e.message) && /re-run cli\.js intake/.test(e.message));
    assert.equal(calls.length, 0);
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', i.runId);
    const egress = await readJsonl(path.join(runDir, 'egress.jsonl'));
    assert.ok(egress.some(e => e.refused && /redacted/.test(e.refused) && e.status === null && e.bytes_in === 0));
    assert.equal((await readJson(path.join(runDir, 'source.json'))).fetched, false);
  });

  it('maxBytes and maxUrls override a larger cfg limit', async () => {
    const big = { ...(await import('../src/lib/bbs/config.js')).DEFAULT_CONFIG, limits: { max_urls: 25, max_bytes: 1000000, max_powers: 12, max_redirects: 5, timeout_ms: 1000 } };
    const i = await intake(dir, 'https://ovb.example.com/', { now, slug: 'ovb' });
    await assert.rejects(() => fetchRun(dir, { run: i.runId, cfg: big, maxBytes: 5, fetchImpl: fakeFetch({ 'https://ovb.example.com/': { body: 'x'.repeat(6), headers: { 'content-type': 'text/plain' } } }), lookup: publicLookup, now }),
      (e) => e instanceof EgressRefused && /bytes/i.test(e.message));
    const j = await intake(dir, 'https://ovu.example.com/', { now, slug: 'ovu' });
    const { appendJsonl } = await import('../src/lib/bbs/store.js');
    await appendJsonl(path.join(dir, '.claude', 'bbs', 'runs', j.runId, 'egress.jsonl'), { kind: 'http', method: 'GET', url: 'https://x/', host: 'x', status: 200, bytes_in: 1, bytes_out: 0 });
    const calls = [];
    await assert.rejects(() => fetchRun(dir, { run: j.runId, cfg: big, maxUrls: 1, fetchImpl: fakeFetch({}, calls), lookup: publicLookup, now }),
      (e) => e instanceof EgressRefused && /max_urls/.test(e.message));
    assert.equal(calls.length, 0);
  });

  it('maxUrls 1 with one redirect: exactly 1 request is sent and the run is refused (max_urls); a pre-connect refusal does not use up the allowance', async () => {
    const i = await intake(dir, 'https://one.example.com/a', { now, slug: 'one' });
    const calls = [];
    const f = fakeFetch({ 'https://one.example.com/a': { status: 302, headers: { location: '/b' } }, 'https://one.example.com/b': { body: 'b' } }, calls);
    await assert.rejects(() => fetchRun(dir, { run: i.runId, maxUrls: 1, fetchImpl: f, lookup: publicLookup, now }), (e) => e instanceof EgressRefused && /max_urls/.test(e.message));
    assert.equal(calls.length, 1);
    const k = await intake(dir, 'https://two.example.com/', { now, slug: 'two' });
    const { appendJsonl } = await import('../src/lib/bbs/store.js');
    await appendJsonl(path.join(dir, '.claude', 'bbs', 'runs', k.runId, 'egress.jsonl'), { kind: 'http', method: 'GET', url: 'https://two.example.com/', host: 'two.example.com', status: null, bytes_in: 0, bytes_out: 0, refused: 'network disabled by BBS_NO_NETWORK' });
    const r = await fetchRun(dir, { run: k.runId, maxUrls: 1, fetchImpl: fakeFetch({ 'https://two.example.com/': { body: 'ok', headers: { 'content-type': 'text/plain' } } }), lookup: publicLookup, now });
    assert.equal(r.identity, sha('ok'));
    assert.match(r.egress_line, /^requests=1 /);
  });

  it('repo: the clone gets the remaining byte allowance and cfg timeout; an over-size clone is refused and fetched/ removed', async () => {
    const i = await intake(dir, 'https://github.com/a/big', { now, slug: 'rbig' });
    const seen = [];
    const git = (args, cwd, env, opts) => {
      seen.push({ args, opts });
      if (args[0] === 'clone') { const d = args[args.length - 1]; fsSync.mkdirSync(d, { recursive: true }); fsSync.writeFileSync(path.join(d, 'f'), 'q'.repeat(20)); return ''; }
      return 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n';
    };
    await assert.rejects(() => fetchRun(dir, { run: i.runId, git, lookup: publicLookup, now, maxBytes: 10 }), (e) => e instanceof EgressRefused && /bytes/i.test(e.message));
    assert.equal(seen[0].opts?.timeout, 300000, 'clone timeout is 10x the 30 s default');
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', i.runId);
    await assert.rejects(() => fs.readdir(path.join(runDir, 'fetched')));
    const egress = await readJsonl(path.join(runDir, 'egress.jsonl'));
    assert.ok(egress.some(e => e.kind === 'git' && e.bytes_in === 20 && e.refused));
  });

  it('r2: a failure AFTER the source.json commit (loadState throws) keeps fetched/ and fetched:true', async () => {
    const i = await intake(dir, 'https://commit.example.com/', { now, slug: 'cmt' });
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', i.runId);
    await fs.writeFile(path.join(runDir, 'powers.json'), '{ not json');
    await assert.rejects(() => fetchRun(dir, { run: i.runId, fetchImpl: fakeFetch({ 'https://commit.example.com/': { body: 'kept', headers: { 'content-type': 'text/plain' } } }), lookup: publicLookup, now }));
    assert.equal(await fs.readFile(path.join(runDir, 'fetched', '1.txt'), 'utf-8'), 'kept');
    assert.equal((await readJson(path.join(runDir, 'source.json'))).fetched, true);
  });

  it('r2: a corrupt egress.jsonl row refuses the fetch (limits cannot be trusted) with exit-2 semantics and no request', async () => {
    const i = await intake(dir, 'https://corrupt.example.com/', { now, slug: 'cor' });
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', i.runId);
    await fs.appendFile(path.join(runDir, 'egress.jsonl'), '{"kind":"http","url":"https://x/","status":2');
    const calls = [];
    await assert.rejects(() => fetchRun(dir, { run: i.runId, fetchImpl: fakeFetch({}, calls), lookup: publicLookup, now }),
      (e) => e instanceof EgressRefused && /egress\.jsonl has 1 corrupt row\(s\)/.test(e.message) && /repair or start a new run/.test(e.message));
    assert.equal(calls.length, 0);
    assert.equal((await readJson(path.join(runDir, 'source.json'))).fetched, false);
    assert.ok((await readJsonl(path.join(runDir, 'egress.jsonl'))).some(e => e.refused && /corrupt/.test(e.refused)));
  });

  it('r2: an empty body (204, or 200 with zero bytes) is a fetch error: row logged, source.json untouched, no fetched/', async () => {
    for (const [slug, entry] of [['e204', { status: 204 }], ['e200', { status: 200, body: '' }]]) {
      const url = `https://${slug}.example.com/`;
      const i = await intake(dir, url, { now, slug });
      const runDir = path.join(dir, '.claude', 'bbs', 'runs', i.runId);
      await assert.rejects(() => fetchRun(dir, { run: i.runId, fetchImpl: fakeFetch({ [url]: entry }), lookup: publicLookup, now }),
        (e) => !(e instanceof EgressRefused) && new RegExp(`empty response body from ${url.replace(/[./]/g, '\\$&')} \\(status ${entry.status}\\)`).test(e.message));
      const source = await readJson(path.join(runDir, 'source.json'));
      assert.equal(source.fetched, false);
      assert.equal(source.identity, 'pending');
      await assert.rejects(() => fs.readdir(path.join(runDir, 'fetched')));
      assert.ok((await readJsonl(path.join(runDir, 'egress.jsonl'))).some(e => e.error && /empty response body/.test(e.error)));
    }
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

  it('--max-bytes 5 against a run that already read 10 bytes refuses with exit 2 before any request', async () => {
    const u = run(dir, ['intake', 'https://mbx.example.com/', '--slug', 'mbx']);
    assert.equal(u.code, 0, u.err);
    const egressFile = path.join(dir, '.claude', 'bbs', 'runs', u.json.runId, 'egress.jsonl');
    const { appendJsonl } = await import('../src/lib/bbs/store.js');
    await appendJsonl(egressFile, { kind: 'http', method: 'GET', url: 'https://mbx.example.com/old', host: 'mbx.example.com', status: 200, bytes_in: 10, bytes_out: 0 });
    const f = run(dir, ['fetch', '--run', u.json.runId, '--max-bytes', '5'], undefined, { BBS_NO_NETWORK: '' });
    assert.equal(f.code, 2, f.err);
    assert.match(f.err, /^bbs: refused: .*bytes/);
    const egress = await readJsonl(egressFile);
    assert.equal(egress.length, 2);
    const last = egress[1];
    assert.ok(last.refused && /max_bytes/.test(last.refused), 'refused on the byte allowance');
    assert.equal(last.status, null, 'pre-connect: nothing was sent');
    assert.equal(last.bytes_in, 0);
    const source = await readJson(path.join(dir, '.claude', 'bbs', 'runs', u.json.runId, 'source.json'));
    assert.equal(source.fetched, false);
  });
});
