import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as wr from '../src/lib/kit/word-reveal.js';

const { emitFragment, lintScroll, normalizeOptions, run } = wr;
const exit = (fn, code = 1) => assert.throws(fn, e => e instanceof KitExit && e.code === code);

/** Run the fragment's <script> in a vm context with a tiny fake DOM. */
function harness(fragment, { reduce = false, noObserver = false } = {}) {
  const script = /<script>\n([\s\S]*?)\n<\/script>/.exec(fragment)[1];
  const words = [...fragment.matchAll(/<span class="wr-w">/g)].map((_, i) => {
    const set = new Set();
    return { i, classList: { add: c => set.add(c), contains: c => set.has(c) }, style: {} };
  });
  const pset = new Set();
  const p = { classList: { add: c => pset.add(c), contains: c => pset.has(c) }, querySelectorAll: sel => (sel === '.wr-w' ? words : []) };
  const timers = [];
  const observers = [];
  class IO {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.observed = []; this.unobserved = []; observers.push(this); }
    observe(t) { this.observed.push(t); }
    unobserve(t) { this.unobserved.push(t); }
    fire(isIntersecting, extra = {}) { this.cb([{ target: p, isIntersecting, ...extra }]); }
  }
  const ctx = {
    document: { querySelectorAll: sel => (sel === '[data-word-reveal]' ? [p] : []) },
    matchMedia: q => ({ matches: reduce && /prefers-reduced-motion/.test(q) }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  if (!noObserver) ctx.IntersectionObserver = IO;
  vm.runInNewContext(script, ctx);
  const lit = () => words.map(w => w.classList.contains('wr-on'));
  const flush = () => { [...timers].sort((a, b) => a.ms - b.ms).forEach(t => t.fn()); };
  return { words, timers, observers, lit, flush, p };
}

describe('emit — markup', () => {
  it('has a <p>, one span per word, a style and a script, and no scroll listener', () => {
    const f = emitFragment('Ship the thing people asked for');
    assert.match(f, /^<p class="wr" data-word-reveal>/);
    assert.equal((f.match(/<span class="wr-w">/g) || []).length, 6);
    assert.match(f, /<style>/);
    assert.match(f, /<script>/);
    assert.ok(!/addEventListener|onscroll/.test(f));
    assert.ok(f.includes('IntersectionObserver'));
    assert.ok(f.includes('prefers-reduced-motion'));
    assert.ok(f.includes('opacity:0.25'));
  });
  it('escapes HTML in the tagline', () => {
    const f = emitFragment('<script>alert(1)</script> & "quoted" it\'s');
    const p = f.slice(0, f.indexOf('</p>'));
    assert.ok(!p.includes('<script>'));
    assert.ok(p.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(p.includes('&amp;') && p.includes('&quot;quoted&quot;') && p.includes('it&#39;s'));
    assert.equal((f.match(/<script>/g) || []).length, 1);
  });
  it('uses the given options', () => {
    const f = emitFragment('a b', { muted: 0.5, staggerMs: 90, trigger: 0.75, easing: 'ease-in-out' });
    assert.ok(f.includes('opacity:0.5'));
    assert.ok(f.includes('ease-in-out'));
    assert.ok(f.includes('STAGGER=90'));
    assert.ok(f.includes('-25%'));
  });
});

describe('emit — behaviour in a fake DOM', () => {
  it('starts muted, observes the block with the trigger line as root margin, and does nothing before it crosses', () => {
    const h = harness(emitFragment('one two three', { trigger: 0.6 }));
    assert.equal(h.observers.length, 1);
    assert.equal(h.observers[0].opts.rootMargin, '0px 0px -40% 0px');
    assert.deepEqual(h.lit(), [false, false, false]);
    h.observers[0].fire(false);
    assert.deepEqual(h.lit(), [false, false, false]);
    assert.equal(h.timers.length, 0);
  });
  it('brightens words in reading order with the stagger once the block crosses', () => {
    const h = harness(emitFragment('one two three four', { staggerMs: 60 }));
    h.observers[0].fire(true);
    assert.deepEqual(h.timers.map(t => t.ms), [60, 120, 180]); // first word is immediate
    assert.deepEqual(h.lit(), [true, false, false, false]);
    const order = [];
    h.words.forEach((w, i) => { const add = w.classList.add; w.classList.add = c => { order.push(i); add(c); }; });
    h.flush();
    assert.deepEqual(order, [1, 2, 3]);
    assert.deepEqual(h.lit(), [true, true, true, true]);
    assert.equal(h.observers[0].unobserved.length, 1);
  });
  it('with zero stagger every word brightens immediately', () => {
    const h = harness(emitFragment('a b c', { staggerMs: 0 }));
    h.observers[0].fire(true);
    assert.deepEqual(h.lit(), [true, true, true]);
    assert.equal(h.timers.length, 0);
  });
  it('under reduced motion shows all words at once and never observes', () => {
    const h = harness(emitFragment('a b c'), { reduce: true });
    assert.deepEqual(h.lit(), [true, true, true]);
    assert.equal(h.observers.length, 0);
    assert.equal(h.timers.length, 0);
  });
  it('without IntersectionObserver shows all words', () => {
    const h = harness(emitFragment('a b'), { noObserver: true });
    assert.deepEqual(h.lit(), [true, true]);
  });
});

describe('option validation', () => {
  it('rejects out-of-range or malformed options with exit 1', () => {
    exit(() => normalizeOptions({ muted: -0.1 }));
    exit(() => normalizeOptions({ muted: 1.1 }));
    exit(() => normalizeOptions({ muted: 'abc' }));
    exit(() => normalizeOptions({ staggerMs: -1 }));
    exit(() => normalizeOptions({ staggerMs: 'x' }));
    exit(() => normalizeOptions({ trigger: -0.01 }));
    exit(() => normalizeOptions({ trigger: 1.01 }));
    for (const e of ['ease;', 'ease{', 'ease}', '<ease', 'ease>', '', '  ']) exit(() => normalizeOptions({ easing: e }));
    exit(() => emitFragment('', {}));
    exit(() => emitFragment('   \n '));
  });
  it('accepts the boundaries and string numbers from the command line', () => {
    assert.deepEqual(normalizeOptions({ muted: '0', staggerMs: '0', trigger: '1' }), { muted: 0, staggerMs: 0, trigger: 1, easing: wr.DEFAULTS.easing });
    assert.equal(normalizeOptions({ muted: 1, trigger: 0 }).muted, 1);
  });
});

describe('lint', () => {
  it('flags an unthrottled scroll listener', () => {
    const r = lintScroll("window.addEventListener('scroll', () => {\n  el.style.opacity = window.scrollY / 100;\n});");
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].line, 1);
    assert.equal(r.findings[0].rule, 'unthrottled-scroll-listener');
    assert.equal(r.counts.findings, 1);
  });
  it('flags a named unthrottled handler', () => {
    const r = lintScroll("function onScroll() { update(); }\nwindow.addEventListener('scroll', onScroll);");
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0].line, 2);
  });
  it('passes a requestAnimationFrame-throttled handler, inline or named', () => {
    assert.deepEqual(lintScroll("addEventListener('scroll', () => { if (!t) { t = true; requestAnimationFrame(() => { go(); t = false; }); } }, { passive: true });").findings, []);
    assert.deepEqual(lintScroll("const onScroll = () => { requestAnimationFrame(go); };\nwindow.addEventListener(\"scroll\", onScroll);").findings, []);
    assert.deepEqual(lintScroll("window.addEventListener('scroll', throttle(go, 100));").findings, []);
  });
  it('reports each bad listener in an HTML page and ignores other events', () => {
    const html = "<script>\naddEventListener('resize', f);\naddEventListener('scroll', a);\naddEventListener('scroll', () => { requestAnimationFrame(b); });\naddEventListener('scroll', c);\n</script>";
    assert.deepEqual(lintScroll(html).findings.map(f => f.line), [3, 5]);
  });
  it('finds nothing in the emitted fragment', () => {
    assert.deepEqual(lintScroll(emitFragment('x y z')).findings, []);
  });
});

describe('run', () => {
  const io = cwd => ({ cwd, stdin: async () => '', env: {} });
  it('emit reads the text file; lint reads the file; bad use exits 1', async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-'));
    try {
      await fs.writeFile(path.join(d, 't.txt'), 'Make it <b>count</b>\n');
      await fs.writeFile(path.join(d, 's.js'), "window.addEventListener('scroll', f);");
      const r = await run(['emit', '--text-file', 't.txt', '--muted', '0.4'], io(d));
      assert.equal(typeof r.raw, 'string');
      assert.ok(r.raw.includes('&lt;b&gt;count&lt;/b&gt;') && r.raw.includes('opacity:0.4'));
      assert.equal((await run(['lint', '--file', 's.js'], io(d))).findings.length, 1);
      for (const a of [[], ['bogus'], ['emit'], ['emit', '--text-file', 'nope.txt'], ['emit', '--text-file', 't.txt', '--muted', '2'],
        ['emit', '--text-file', 't.txt', '--easing', 'a;b'], ['emit', '--text-file', 't.txt', '--wat', '1'], ['emit', '--text-file', 't.txt', '--trigger'], ['lint'], ['lint', '--file', 'nope.js']]) {
        await assert.rejects(run(a, io(d)), e => e instanceof KitExit && e.code === 1, a.join(' '));
      }
    } finally { await fs.rm(d, { recursive: true, force: true }); }
  });
});

describe('accessibility', () => {
  it('gives the whole escaped sentence once in a visually hidden span and hides the word spans', () => {
    const f = emitFragment('Build <fast> & ship');
    const p = f.slice(0, f.indexOf('</p>'));
    assert.equal((p.match(/<span class="wr-sr">/g) || []).length, 1);
    assert.ok(p.includes('<span class="wr-sr">Build &lt;fast&gt; &amp; ship</span>'));
    const hidden = /<span aria-hidden="true">([\s\S]*)<\/span>$/.exec(p);
    assert.ok(hidden, 'word spans wrapped in aria-hidden');
    assert.equal((hidden[1].match(/<span class="wr-w">/g) || []).length, 4);
    assert.ok(!p.slice(0, p.indexOf('<span aria-hidden')).includes('wr-w'));
    assert.match(f, /\.wr-sr\{position:absolute;[^}]*clip:rect\(0,0,0,0\)/);
  });
  it('applies the muted opacity only under the class the script adds', () => {
    const f = emitFragment('a b', { muted: 0.3 });
    const css = /<style>\n([\s\S]*?)\n<\/style>/.exec(f)[1];
    assert.ok(css.includes('.wr-js .wr-w{opacity:0.3'));
    assert.ok(!/(^|\n|\})\.wr-w\{[^}]*opacity/.test(css), 'no unconditional muted rule');
    assert.ok(!/(^|\n|\})\.wr-w\.wr-on/.test(css));
    const h = harness(f);
    assert.ok(h.p.classList.contains('wr-js'));
    const r = harness(f, { reduce: true });
    assert.ok(!r.p.classList.contains('wr-js'));
    assert.ok(!harness(f, { noObserver: true }).p.classList.contains('wr-js'));
  });
  it('reveals a block already scrolled past, not one still below', () => {
    const below = harness(emitFragment('a b c'));
    below.observers[0].fire(false, { boundingClientRect: { top: 900 }, rootBounds: { top: 0 } });
    assert.deepEqual(below.lit(), [false, false, false]);
    const past = harness(emitFragment('a b c'), {});
    past.observers[0].fire(false, { boundingClientRect: { top: -300 }, rootBounds: { top: 0 } });
    assert.equal(past.lit()[0], true);
    past.flush();
    assert.deepEqual(past.lit(), [true, true, true]);
    assert.equal(past.observers[0].unobserved.length, 1);
  });
  it('keeps a non-breaking space inside its word', () => {
    assert.deepEqual(wr.splitWords('10 km is\tfar away'), ['10 km', 'is', 'far away']);
    assert.ok(emitFragment('Mr. Smith left').includes('<span class="wr-w">Mr. Smith</span>'));
  });
});

describe('lint — comments, strings and linear time', () => {
  it('is not fooled by throttle words in comments, strings or unrelated names', () => {
    assert.equal(lintScroll("window.addEventListener('scroll', () => {\n  // TODO throttle this\n  measure();\n});").findings.length, 1);
    assert.equal(lintScroll("addEventListener('scroll', () => { /* requestAnimationFrame later */ measure(); });").findings.length, 1);
    assert.equal(lintScroll("addEventListener('scroll', () => { debounceLog(x); log('throttle(1)'); });").findings.length, 1);
    assert.equal(lintScroll("function onScroll() { // rAF(\n update(); }\naddEventListener('scroll', onScroll);").findings.length, 1);
    assert.equal(lintScroll("addEventListener('scroll', () => { debounce(go, 5); });").findings.length, 0);
    assert.equal(lintScroll("// addEventListener('scroll', f);\nx();").findings.length, 0);
  });
  it('reports the right line and text for later hits', () => {
    const r = lintScroll("a();\n\naddEventListener('scroll', f);\nb();\naddEventListener('scroll', g);");
    assert.deepEqual(r.findings.map(f => [f.line, f.text]), [[3, "addEventListener('scroll', f);"], [5, "addEventListener('scroll', g);"]]);
  });
  const fast = (name, src) => it(`finishes about 2 MB of adversarial input in under 2 s: ${name}`, () => {
    const t = Date.now();
    lintScroll(src);
    assert.ok(Date.now() - t < 2000, `${name} took ${Date.now() - t} ms`);
  });
  const MB2 = 2 * 1024 * 1024;
  fast('unclosed listeners', "addEventListener('scroll', (".repeat(Math.ceil(MB2 / 27)));
  fast('many named handlers', Array.from({ length: 60000 }, (_, i) => `addEventListener('scroll', h${i});`).join('\n'));
  fast('many bad listeners', "addEventListener('scroll', f);\n".repeat(Math.ceil(MB2 / 29)));
  fast('unclosed comments', '/* '.repeat(MB2 / 3));
  fast('unclosed definitions', 'const a = '.repeat(MB2 / 10) + "addEventListener('scroll', a);");
  fast('unclosed function heads', 'function f('.repeat(MB2 / 11) + "addEventListener('scroll', f);");
});

describe('run — input reading', () => {
  const MAXB = 8 * 1024 * 1024;
  const withDir = async fn => { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-')); try { await fn(d); } finally { await fs.rm(d, { recursive: true, force: true }); } };
  const stdinIo = (buf, extra = {}) => { const calls = []; return { calls, cwd: os.tmpdir(), stdinIsTTY: false, stdinBytes: async o => { calls.push(o); return buf; }, ...extra }; };
  const refused = (p, re) => assert.rejects(p, e => e instanceof KitExit && e.code === 1 && (!re || re.test(e.message)));

  it('emit reads stdin through stdinBytes with a byte cap of MAX + 1', async () => {
    const io = stdinIo(Buffer.from('héllo <wörld>\n'));
    const r = await run(['emit'], io);
    assert.ok(r.raw.includes('héllo') && r.raw.includes('&lt;wörld&gt;'));
    assert.deepEqual(io.calls, [{ maxBytes: MAXB + 1 }]);
    const l = await run(['lint'], stdinIo(Buffer.from("addEventListener('scroll', f);")));
    assert.equal(l.findings.length, 1);
  });
  it('refuses stdin over 8 MiB counted in bytes, even when text.length is under the cap', async () => {
    const text = '€'.repeat(Math.floor(MAXB / 3) + 1); // 2.8 M characters, 8 MiB + 2 bytes
    assert.ok(text.length < MAXB);
    const buf = Buffer.from(text);
    assert.ok(buf.length > MAXB);
    await refused(run(['emit'], stdinIo(buf)), /8 MiB/);
    await refused(run(['lint'], stdinIo(buf)), /8 MiB/);
    await run(['emit'], stdinIo(Buffer.from('€'.repeat(100)))); // under the cap is fine
  });
  it('refuses a TTY or missing stdin and an empty stdin', async () => {
    await refused(run(['emit'], { cwd: os.tmpdir(), stdinIsTTY: true, stdinBytes: async () => Buffer.alloc(0) }));
    await refused(run(['emit'], { cwd: os.tmpdir() }));
    await refused(run(['emit'], stdinIo(Buffer.alloc(0))));
  });
  it('reads a file with a bound even when stat reports a small size', async () => {
    await withDir(async d => {
      const big = path.join(d, 'big.txt');
      const h = await fs.open(big, 'w'); await h.truncate(MAXB + 1); await h.close();
      await refused(run(['emit', '--text-file', 'big.txt'], { cwd: d }), /8 MiB/);
      await refused(run(['lint', '--file', 'big.txt'], { cwd: d }), /8 MiB/);
      const realStat = fs.stat;
      fs.stat = async (...a) => { const s = await realStat(...a); return Object.create(s, { size: { value: 0 } }); };
      try {
        await refused(run(['emit', '--text-file', 'big.txt'], { cwd: d }), /8 MiB/);
        await refused(run(['lint', '--file', 'big.txt'], { cwd: d }), /8 MiB/);
      } finally { fs.stat = realStat; }
      await fs.writeFile(path.join(d, 'ok.txt'), 'fine words');
      assert.ok((await run(['emit', '--text-file', 'ok.txt'], { cwd: d })).raw.includes('fine'));
    });
  });
  it('refuses a directory and a FIFO', async () => {
    await withDir(async d => {
      await refused(run(['emit', '--text-file', '.'], { cwd: d }), /regular file/);
      await refused(run(['emit', '--text-file', '/dev/null'], { cwd: d }), /regular file/);
    });
  });
  it('refuses a repeated flag, an empty value and a flag-looking value', async () => {
    await withDir(async d => {
      await fs.writeFile(path.join(d, 'a.txt'), 'one'); await fs.writeFile(path.join(d, 'b.txt'), 'two');
      const io = { cwd: d };
      await refused(run(['emit', '--text-file', 'a.txt', '--text-file', 'b.txt'], io), /--text-file given twice/);
      await refused(run(['emit', '--text-file', 'a.txt', '--muted', '0.3', '--muted', '0.9'], io), /--muted given twice/);
      await refused(run(['lint', '--file', 'a.txt', '--file', 'b.txt'], io), /--file given twice/);
      await refused(run(['emit', '--text-file', ''], io), /--text-file.*empty/);
      await refused(run(['emit', '--text-file', 'a.txt', '--easing', ''], io), /--easing.*empty/);
      await refused(run(['emit', '--text-file', '--muted', '0.3'], io), /--text-file/);
      await refused(run(['emit', '--text-file', 'a.txt', '--easing', '--muted'], io), /--easing/);
    });
  });
});
