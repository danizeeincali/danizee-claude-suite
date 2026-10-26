import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'fs/promises';
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
  const p = { querySelectorAll: sel => (sel === '.wr-w' ? words : []) };
  const timers = [];
  const observers = [];
  class IO {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.observed = []; this.unobserved = []; observers.push(this); }
    observe(t) { this.observed.push(t); }
    unobserve(t) { this.unobserved.push(t); }
    fire(isIntersecting) { this.cb([{ target: p, isIntersecting }]); }
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
  return { words, timers, observers, lit, flush };
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
