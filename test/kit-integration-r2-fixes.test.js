import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as ls from '../src/lib/kit/landing-sections.js';
import * as bg from '../src/lib/kit/bg-fill.js';
import * as sc from '../src/lib/kit/sample-content.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = m => pathToFileURL(path.join(root, 'src/lib/kit', m + '.js')).href;
const tmp = () => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'r2fix-'));
const bad = (p, code = 1) => assert.rejects(Promise.resolve().then(p), e => e instanceof KitExit && e.code === code);

describe('r2: --file symlink to /proc/self/fd/0 is refused in all four verbs', () => {
  const cases = [
    ['design-brief', ['assume', '--file', 'link'], '{"kind":"landing","answers":{}}'],
    ['landing-sections', ['check', '--file', 'link'], '# Hero\nhi\n'],
    ['type-scale', ['audit', '--file', 'link'], '.a { font-size: 16px }\n'],
    ['entrance', ['--file', 'link'], '[{"id":"hero","kind":"fade-up"}]'],
  ];
  for (const [m, args, content] of cases) {
    it(m, () => {
      const dir = tmp();
      try {
        fs.writeFileSync(path.join(dir, 'in.txt'), content);
        fs.symlinkSync('/proc/self/fd/0', path.join(dir, 'link'));
        const fd = fs.openSync(path.join(dir, 'in.txt'), 'r');
        const script = `import(${JSON.stringify(mod(m))}).then(async x => { try { await x.run(${JSON.stringify(args)}, { cwd: ${JSON.stringify(dir)}, stdinIsTTY: false, env: {}, stdin: async () => '', stdinBytes: async () => Buffer.alloc(0) }); console.log('OK'); } catch (e) { console.log('REFUSED ' + e.code + ' ' + e.message); } });`;
        const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf-8' });
        fs.closeSync(fd);
        assert.match(r.stdout, /^REFUSED 1 .*not a regular file/, r.stdout + r.stderr);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }
  it('entrance compares bigint dev/ino (no Number precision loss)', () => {
    const src = fs.readFileSync(path.join(root, 'src/lib/kit/entrance.js'), 'utf-8');
    assert.match(src, /fh\.stat\(\{ bigint: true \}\)/);
    assert.doesNotMatch(src, /BigInt\(st\./);
  });
});

describe('r2: landing-sections', () => {
  it('trailing run of # is linear (2 MB)', () => {
    const t0 = Date.now();
    ls.checkText('## Hero ' + '#'.repeat(2 * 1024 * 1024) + 'x', 'md');
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  });
  it('closing hashes are still stripped from a heading', () => {
    assert.ok(ls.checkText('# Hero ##\n\ntext\n', 'md').found.includes('hero'));
  });
  it('a .html file opening with <meta> is read as HTML, by sniff and by --format', async () => {
    const dir = tmp();
    try {
      const html = '<meta charset="utf-8"><title>x</title><section id="hero"><h1>Hi</h1></section><section id="final-cta"><a href="#">Go</a></section>';
      fs.writeFileSync(path.join(dir, 'page.html'), html);
      const io = { cwd: dir, stdinIsTTY: false, env: {}, stdin: async () => html };
      const a = await ls.run(['check', '--file', 'page.html'], io);
      const b = await ls.run(['check'], io);
      assert.ok(a.found.includes('hero') && a.found.includes('final-cta'));
      assert.deepEqual(a, b);
      const forced = await ls.run(['check', '--format', 'md', '--file', 'page.html'], io);
      assert.equal(forced.found.length, 0);
      await bad(() => ls.run(['check', '--format', 'xml'], io));
      await bad(() => ls.run(['check', '--format', 'md', '--format', 'html'], io));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('r2: bg-fill reduced-motion allowance is exact', () => {
  const g = css => bg.guard(css, '.bg');
  const base = '.bg { background: url(a.jpg) fixed; }\n';
  const rule = '{ .bg { background-attachment: scroll; } }';
  it('refuses preludes that also apply without reduced motion', () => {
    for (const q of ['(prefers-reduced-motion: reduce), (max-width: 600px)', 'not all and (prefers-reduced-motion: reduce)', '(prefers-reduced-motion: reduce) or (min-width: 0)'])
      assert.equal(g(base + `@media ${q} ${rule}`).exit, 2, q);
  });
  it('still allows the plain and conjunctive forms', () => {
    for (const q of ['(prefers-reduced-motion: reduce)', 'screen and (prefers-reduced-motion: reduce)', '(prefers-reduced-motion: reduce) and (max-width: 600px)'])
      assert.equal(g(base + `@media ${q} ${rule}`).exit, 0, q);
  });
});

describe('r2: sample-content UTF-16LE parity', () => {
  it('odd-length UTF-16LE is refused like UTF-16BE', async () => {
    const le = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('Lorem ipsum', 'utf16le'), Buffer.from([0x41])]);
    const be = Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from('Lorem ipsum', 'utf16le').swap16(), Buffer.from([0x41])]);
    for (const b of [le, be]) await bad(() => sc.run(['lint'], { stdinBytes: async () => b, stdinIsTTY: false, env: {} }));
  });
});
