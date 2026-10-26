import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { installPackaged } from './helpers/packaged.js';

describe('word-reveal — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('emits a fragment, lints, rejects bad input, zero egress', () => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('word-reveal'));
    fs.writeFileSync(path.join(pkg.dir, 'tag.txt'), 'Build <fast> & ship');
    const e = pkg.kit(['word-reveal', 'emit', '--text-file', 'tag.txt', '--muted', '0.3', '--stagger-ms', '40']);
    assert.equal(e.code, 0);
    assert.match(e.out, /^<p class="wr" data-word-reveal>/);
    assert.ok(e.out.includes('&lt;fast&gt;') && e.out.includes('opacity:0.3') && e.out.includes('STAGGER=40'));
    fs.writeFileSync(path.join(pkg.dir, 'bad.js'), "window.addEventListener('scroll', () => { measure(); });");
    fs.writeFileSync(path.join(pkg.dir, 'good.html'), e.out);
    const bad = pkg.kit(['word-reveal', 'lint', '--file', 'bad.js']);
    assert.equal(bad.code, 0);
    assert.equal(bad.json.findings.length, 1);
    assert.equal(pkg.kit(['word-reveal', 'lint', '--file', 'good.html']).json.findings.length, 0);
    assert.equal(pkg.kit(['word-reveal', 'emit', '--text-file', 'tag.txt', '--muted', '2']).code, 1);
    assert.equal(pkg.kit(['word-reveal', 'emit', '--text-file', 'tag.txt', '--easing', 'a;b']).code, 1);
    assert.equal(pkg.kit(['word-reveal', 'emit']).code, 1);
    for (const e of ['ease"', 'ease /*', 'cubic-bezier(0.2', 'ease\\']) assert.equal(pkg.kit(['word-reveal', 'emit', '--text-file', 'tag.txt', '--easing', e]).code, 1, e);
    assert.equal(pkg.kit(['word-reveal', 'emit', '--text-file', 'tag.txt', '--stagger-ms', '1e9']).code, 1);
    fs.writeFileSync(path.join(pkg.dir, 'min.html'), "<p>Don't</p><script>addEventListener('scroll',()=>requestAnimationFrame(f))</script>");
    assert.equal(pkg.kit(['word-reveal', 'lint', '--file', 'min.html']).json.findings.length, 0);
    assert.deepEqual(pkg.egress(), []);
  });

  it('reads the same input from stdin and --text-file / --file, and caps stdin in bytes', () => {
    fs.writeFileSync(path.join(pkg.dir, 'same.txt'), 'Ship <it> now');
    const viaFile = pkg.kit(['word-reveal', 'emit', '--text-file', 'same.txt']);
    const viaStdin = pkg.kit(['word-reveal', 'emit'], 'Ship <it> now');
    assert.equal(viaStdin.code, 0);
    assert.equal(viaStdin.out, viaFile.out);
    assert.ok(viaStdin.out.includes('<span class="wr-sr">Ship &lt;it&gt; now</span><span aria-hidden="true">'));
    fs.writeFileSync(path.join(pkg.dir, 'sc.js'), "addEventListener('scroll', f);");
    const lf = pkg.kit(['word-reveal', 'lint', '--file', 'sc.js']);
    const ls = pkg.kit(['word-reveal', 'lint'], "addEventListener('scroll', f);");
    assert.equal(lf.json.findings.length, 1);
    assert.deepEqual(ls.json, lf.json);
    const over = pkg.kit(['word-reveal', 'emit'], '€'.repeat(Math.floor(8 * 1024 * 1024 / 3) + 1));
    assert.equal(over.code, 1);
    assert.equal(pkg.kit(['word-reveal', 'emit', '--text-file', 'same.txt', '--text-file', 'same.txt']).code, 1);
    assert.equal(pkg.kit(['word-reveal', 'emit', '--text-file', '']).code, 1);
  });
});
