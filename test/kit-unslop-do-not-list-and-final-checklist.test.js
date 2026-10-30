import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as rc from '../src/lib/kit/redesign-checklist.js';

const { run, verb, templateTest, compare, GENERIC_WORDS, MAX_GENERIC_RATIO } = rc;
const io = (stdin = '', cwd) => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });
const exit = async (p, code = 1) => assert.rejects(Promise.resolve().then(p), e => e instanceof KitExit && e.code === code);
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'rc-'));

const BEFORE = `<section id="hero"><h1>Acme tracks freight pallets</h1><a href="/signup">Start</a></section>
<section id="benefits"><p>Cut 40% of dock delays.</p><form><input name="email"><input name="dock"></form></section>
<section id="faq"><h2>FAQ</h2></section>`;

describe('list', () => {
  it('lists do-not rules, checklist and the template test', async () => {
    const r = await run(['list'], io());
    assert.equal(verb, 'redesign-checklist');
    assert.ok(r.do_not.length >= 7);
    for (const d of r.do_not) { assert.equal(typeof d.id, 'string'); assert.equal(typeof d.rule, 'string'); }
    assert.ok(r.do_not.some(d => d.id === 'keep-sections'));
    for (const c of r.checklist) assert.ok(c.id && c.item && c.how_to_check);
    assert.equal(new Set(r.checklist.map(c => c.id)).size, r.checklist.length);
    assert.equal(typeof r.template_test.how, 'string');
  });
  it('takes no arguments', async () => { await exit(() => run(['list', 'x'], io())); });
});

describe('template-test', () => {
  it('flags generic sentences and computes the ratio', () => {
    const r = templateTest('<h1>Acme tracks freight pallets.</h1><p>A powerful platform to streamline your workflow.</p><p>Seamless solution for teams!</p><p>Cut 40% of dock delays.</p>', 'Acme');
    assert.equal(r.name_found, true);
    assert.equal(r.sentences, 4);
    assert.equal(r.generic.length, 2);
    assert.equal(r.generic_ratio, 0.5);
    assert.equal(r.pass, false);
    assert.equal(MAX_GENERIC_RATIO, 0.3);
    assert.ok(GENERIC_WORDS.has('streamline'));
  });
  it('passes specific copy and reports lines (markdown)', () => {
    const r = templateTest('# Acme\n\nAcme tracks freight pallets from dock to truck.\n\nSeamless platform.\n\nEach pallet gets a scan and a time stamp.\n\nDock doors show their next arrival.\n\nDrivers get a gate code by text.\n', 'acme');
    assert.equal(r.pass, true);
    assert.deepEqual(r.generic, [{ line: 5, text: 'Seamless platform.' }]);
    assert.ok(r.generic_ratio <= 0.3);
  });
  it('fails when the name never occurs', () => {
    const r = templateTest('Pallets go to docks.', 'Zed');
    assert.equal(r.name_found, false);
    assert.equal(r.pass, false);
    assert.match(r.next, /Zed/);
  });
  it('ignores scripts, styles, comments, markdown code', () => {
    assert.equal(templateTest('<style>.powerful{}</style><!-- seamless platform --><script>var a="seamless platform"</script><p>Acme pallets</p>', 'Acme').sentences, 1);
    assert.equal(templateTest('Acme pallets\n\n```\nseamless platform\n```\n', 'Acme').sentences, 1);
  });
  it('name with regex characters is matched literally', () => {
    const r = templateTest('Try C++ (beta) pallets today.', 'C++ (beta)');
    assert.equal(r.occurrences, 1);
  });
  it('run reads stdin and --file, and enforces flags', async () => {
    const r = await run(['template-test', '--name', 'Acme'], io('Acme pallets.'));
    assert.equal(r.pass, true);
    const d = await tmp();
    await fs.writeFile(path.join(d, 'p.md'), 'Acme pallets.\n');
    assert.deepEqual(await run(['template-test', '--name', 'Acme', '--file', 'p.md'], io('', d)), r);
    await exit(() => run(['template-test'], io('x')));
    await exit(() => run(['template-test', '--name'], io('x')));
    await exit(() => run(['template-test', '--name', ' '], io('x')));
    await exit(() => run(['template-test', '--name', 'A', '--name', 'B'], io('x')));
    await exit(() => run(['template-test', '--name', 'A', '--bogus'], io('x')));
    await exit(() => run(['template-test', '--name', 'A'], io('')));
    await exit(() => run(['template-test', '--name', 'A'], io('a\0b')));
    await exit(() => run(['template-test', '--name', 'A', '--file', 'nope.md'], io('', d)));
    await exit(() => run(['template-test', '--name', 'A', '--file', '/dev/zero'], io('', d)));
    await exit(() => run(['template-test', '--name', 'A', '--file', d], io('', d)));
    await exit(() => run(['template-test', '--name', 'A'], io('é'.repeat(4.5 * 1024 * 1024))));
  });
});

describe('check', () => {
  it('passes an unchanged page', () => {
    const r = compare(BEFORE, BEFORE);
    assert.deepEqual(r.violations, []);
    assert.equal(r.template, null);
    assert.equal(r.pass, true);
  });
  it('flags dropped and reordered sections', () => {
    const dropped = compare(BEFORE, BEFORE.replace(/<section id="faq">.*<\/section>/, ''));
    assert.deepEqual(dropped.violations.map(v => v.rule), ['section-dropped']);
    const lines = BEFORE.split('\n');
    const reordered = compare(BEFORE, [lines[1], lines[0], lines[2]].join('\n'));
    assert.deepEqual(reordered.violations.map(v => v.rule), ['section-reordered']);
    assert.equal(reordered.pass, false);
  });
  it('falls back to heading order in markdown', () => {
    const r = compare('# Intro\n\n## Alpha\n\n## Beta\n', '# Intro\n\n## Beta\n\n## Alpha\n');
    assert.deepEqual(r.violations.map(v => v.rule), ['section-reordered']);
    const d = compare('## Alpha\n\n## Beta\n', '## Alpha\n');
    assert.deepEqual(d.violations.map(v => v.rule), ['section-dropped']);
    assert.equal(d.violations[0].line, 3);
  });
  it('flags removed fields and links', () => {
    const after = BEFORE.replace('<input name="dock">', '').replace('href="/signup"', 'href="/join"');
    const r = compare(BEFORE, after);
    assert.deepEqual(r.violations.map(v => v.rule).sort(), ['field-removed', 'link-removed']);
    assert.equal(r.violations.find(v => v.rule === 'field-removed').line, 2);
    const md = compare('[a](/one) and [b](/two)\n', '[a](/one)\n');
    assert.deepEqual(md.violations.map(v => v.rule), ['link-removed']);
  });
  it('flags invented numbers only', () => {
    const after = BEFORE.replace('Cut 40% of dock delays.', 'Cut 40% of dock delays across 1,200 sites.');
    const r = compare(BEFORE, after);
    assert.deepEqual(r.violations.map(v => v.rule), ['invented-data']);
    assert.match(r.violations[0].detail, /1,200/);
    assert.equal(r.violations[0].line, 2);
    assert.deepEqual(compare('<p>Costs 5%</p><a href="/a1">x</a>', '<p>Costs 5%</p><a href="/a1">x</a>').violations, []);
  });
  it('flags new infinite animations but not ones that existed', () => {
    const css = '<style>\n.a{animation: spin 2s linear infinite}\n</style>';
    assert.deepEqual(compare(BEFORE, BEFORE + css).violations.map(v => v.rule), ['looping-motion']);
    assert.deepEqual(compare(BEFORE + css, BEFORE + css).violations, []);
    assert.deepEqual(compare(BEFORE, BEFORE + '<style>.a{animation-iteration-count: infinite}</style>').violations.map(v => v.rule), ['looping-motion']);
  });
  it('runs the template test on after with --name', () => {
    const r = compare(BEFORE, BEFORE, { name: 'Acme' });
    assert.equal(r.template.name_found, true);
    assert.equal(compare(BEFORE, BEFORE, { name: 'Nope' }).pass, false);
  });
  it('run: advisory exit 0, --strict exits 2 with JSON, errors exit 1', async () => {
    const d = await tmp();
    await fs.writeFile(path.join(d, 'b.html'), BEFORE);
    await fs.writeFile(path.join(d, 'a.html'), BEFORE.replace('<input name="dock">', ''));
    await fs.writeFile(path.join(d, 'same.html'), BEFORE);
    const adv = await run(['check', '--before', 'b.html', '--after', 'a.html'], io('', d));
    assert.equal(adv.pass, false);
    assert.equal(adv.exit, undefined);
    const strict = await run(['check', '--before', 'b.html', '--after', 'a.html', '--strict'], io('', d));
    assert.equal(strict.exit, 2);
    assert.equal(strict.violations.length, 1);
    const ok = await run(['check', '--before', 'b.html', '--after', 'same.html', '--strict'], io('', d));
    assert.equal(ok.exit, undefined);
    assert.equal(ok.pass, true);
    await exit(() => run(['check', '--before', 'b.html'], io('', d)));
    await exit(() => run(['check', '--before', 'b.html', '--after', 'nope.html'], io('', d)));
    await exit(() => run(['check', '--before', 'b.html', '--after', 'a.html', '--after', 'a.html'], io('', d)));
    await exit(() => run(['check', '--before', 'b.html', '--after', 'a.html', '--strict', '--strict'], io('', d)));
    await exit(() => run(['check', '--before', 'b.html', '--after', 'a.html', '--what'], io('', d)));
    await fs.writeFile(path.join(d, 'empty.html'), '  \n');
    await exit(() => run(['check', '--before', 'empty.html', '--after', 'a.html'], io('', d)));
    await fs.writeFile(path.join(d, 'bin.html'), Buffer.from([60, 0, 62]));
    await exit(() => run(['check', '--before', 'bin.html', '--after', 'a.html'], io('', d)));
    await fs.writeFile(path.join(d, 'big.html'), 'é'.repeat(4.5 * 1024 * 1024));
    await exit(() => run(['check', '--before', 'big.html', '--after', 'a.html'], io('', d)));
  });
  it('unknown subcommand exits 1', async () => {
    await exit(() => run([], io()));
    await exit(() => run(['bogus'], io()));
  });
});

describe('review r1 regressions', () => {
  it('product name matches whole words only', () => {
    const r = templateTest('<p>Search everything faster. Streamline your workflow.</p>', 'Arc');
    assert.equal(r.name_found, false);
    assert.equal(r.occurrences, 0);
    const ok = templateTest('<p>Arc, the browser. Try Arc today.</p>', 'Arc');
    assert.equal(ok.occurrences, 2);
    assert.equal(templateTest('<p>Notional value of inbox bloom.</p>', 'Notion').name_found, false);
  });
  it('shares landing-sections sniff and agrees on prologs', async () => {
    const ls = await import('../src/lib/kit/landing-sections.js');
    assert.equal(typeof ls.sniff, 'function');
    const jinja = '{% extends "base.html" %}\n<section id="hero"><a href="/signup">Go</a></section>\n<section id="faq"><h2>FAQ</h2></section>';
    assert.equal(ls.sniff(jinja), 'html');
    const after = jinja.replace('<a href="/signup">Go</a>', '');
    const r = compare(jinja, after);
    assert.deepEqual(r.violations.map(v => v.rule), ['link-removed']);
    const php = '<?php echo 1; ?>\n<p><a href="/x">x</a></p>';
    assert.deepEqual(compare(php, '<?php echo 1; ?>\n<p>x</p>').violations.map(v => v.rule), ['link-removed']);
  });
  it('--format forces the type for template-test and check', async () => {
    const d = await tmp();
    const r1 = '<p align="center"><img src="a.png"></p>\n\n## Install\n\nSee [docs](https://x.y/docs).\n\n## Usage\n\nRun it.\n';
    const r2 = '<p align="center"><img src="a.png"></p>\n\n## Usage\n\nRun it.\n\n## Install\n\nSee docs.\n';
    await fs.writeFile(path.join(d, 'r1.md'), r1);
    await fs.writeFile(path.join(d, 'r2.md'), r2);
    const plain = await run(['check', '--before', 'r1.md', '--after', 'r2.md'], io('', d));
    assert.equal(plain.pass, true);
    for (const flags of [['--format', 'md'], ['--before-format', 'md', '--after-format', 'md']]) {
      const r = await run(['check', '--before', 'r1.md', '--after', 'r2.md', '--strict', ...flags], io('', d));
      assert.equal(r.pass, false);
      assert.equal(r.exit, 2);
      assert.ok(r.violations.some(v => v.rule === 'link-removed'));
      assert.ok(r.violations.some(v => v.rule === 'section-reordered'));
    }
    const t = await run(['template-test', '--name', 'Acme', '--format', 'md'], io('<b>Acme</b> pallets', d));
    assert.equal(t.name_found, true);
    await exit(() => run(['template-test', '--name', 'Acme', '--format', 'xml'], io('Acme', d)));
    await exit(() => run(['check', '--before', 'r1.md', '--after', 'r2.md', '--format', 'rst'], io('', d)));
    await exit(() => run(['check', '--before', 'r1.md', '--after', 'r2.md', '--format', 'md', '--format', 'md'], io('', d)));
  });
  it('ordered-list markers are not invented data', () => {
    const b = '# T\n\n- Open the file\n- Save it\n';
    const a = '# T\n\n1. Open the file\n2) Save it\n';
    assert.deepEqual(compare(b, a).violations, []);
    assert.deepEqual(compare('<ul><li>Open the file</li><li>Save it</li></ul>', '<ol><li>Open the file</li><li>Save it</li></ol>').violations, []);
    assert.equal(compare(b, '# T\n\n- Open 3 files\n').violations[0].rule, 'invented-data');
  });
  it('line lookup is fast on large inputs and still correct', () => {
    const n = 20000;
    const mk = k => Array.from({ length: n }, (_, i) => `<a href="/p${i}">l</a><input name="f${i}">`).join('\n') + (k ? '' : '\n<a href="/last">x</a>');
    const t0 = Date.now();
    const r = compare(mk(0), mk(1));
    assert.ok(Date.now() - t0 < 3000);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].line, n + 1);
  });
});
