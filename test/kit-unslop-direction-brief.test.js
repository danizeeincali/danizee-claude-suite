import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as d from '../src/lib/kit/direction.js';

const { run, template, checkFields, parseText, fromBrief, FIELDS, BANNED, verb } = d;
const io = (stdin, cwd) => ({ cwd, stdin: async () => stdin, stdinIsTTY: false, env: {} });
const exit = async (p, code = 1) => assert.rejects(Promise.resolve().then(p), e => e instanceof KitExit && e.code === code);
const CLI = path.resolve(import.meta.dirname, '../.claude/helpers/kit/cli.js');
const IDS = ['product', 'character', 'world', 'moments', 'signature'];

const GOOD = {
  product: 'A prep-list printer for bakers who start at four in the morning.',
  character: 'Dry-humoured, punctual, stubborn about units',
  world: 'A trade kitchen at dawn: steel shelves, flour-dusted wood, chalk labels',
  moments: 'The total at the bottom; the print button',
  signature: 'Every quantity has a tally-mark underline',
};
const codes = r => r.problems.map(p => `${p.field}:${p.code}`);
const withField = (k, v) => ({ ...GOOD, [k]: v });

describe('moments array count', () => {
  it('counts a JSON array by its length, not by re-splitting elements', async () => {
    const two = await run(['check'], io(JSON.stringify(withField('moments', ['the total and subtotal row', 'the print button']))));
    assert.ok(!codes(two).includes('moments:too_many_moments'));
    const three = await run(['check'], io(JSON.stringify(withField('moments', ['a', 'b', 'c']))));
    assert.ok(codes(three).includes('moments:too_many_moments'));
    const strict = await run(['check', '--strict'], io(JSON.stringify(withField('moments', ['the total and subtotal row', 'the print button']))));
    assert.notEqual(strict.exit, 2);
  });
});

describe('template', () => {
  it('lists the five fields in order with id, label, ask, example', async () => {
    const t = await run(['template'], io(''));
    assert.deepEqual(t, template());
    assert.deepEqual(t.fields.map(f => f.id), IDS);
    for (const f of t.fields) for (const k of ['id', 'label', 'ask', 'example']) assert.equal(typeof f[k], 'string');
    assert.equal(verb, 'direction');
  });
  it('examples themselves pass the check', () => {
    const r = checkFields(Object.fromEntries(FIELDS.map(f => [f.id, f.example])));
    assert.deepEqual(r.problems, []);
  });
  it('rejects extra args and unknown subcommands', async () => {
    await exit(() => run(['template', 'x'], io('')));
    await exit(() => run([], io('')));
    await exit(() => run(['nope'], io('')));
  });
});

describe('check', () => {
  it('passes a concrete direction (JSON)', async () => {
    const r = await run(['check'], io(JSON.stringify(GOOD)));
    assert.equal(r.ok, true);
    assert.deepEqual(r.problems, []);
    assert.equal(r.fields.moments.present, true);
    assert.deepEqual(r.fields.product.problems, []);
    assert.equal(r.exit, undefined);
  });
  it('passes the same direction as markdown, bullets and bold included', async () => {
    const md = `# Direction\n\n- **Product:** ${GOOD.product}\n- **Character**: ${GOOD.character}\n* World: ${GOOD.world}\nMoments: ${GOOD.moments}\nSignature: ${GOOD.signature}\n`;
    const r = await run(['check'], io(md));
    assert.equal(r.ok, true);
    assert.equal(r.fields.product.text, GOOD.product);
    assert.equal(r.fields.character.text, GOOD.character);
  });
  it('flags missing and empty fields', async () => {
    const r = await run(['check'], io(JSON.stringify({ product: 'x thing for y', character: '  ', world: null })));
    assert.deepEqual(codes(r).filter(c => c.endsWith('missing')), ['character:missing', 'world:missing', 'moments:missing', 'signature:missing']);
    assert.equal(r.fields.character.present, false);
    assert.equal(r.ok, false);
    assert.ok(r.problems.every(p => p.message && p.fix));
  });
  it('flags every banned word, whole-word and case-insensitive, in any field', () => {
    for (const w of BANNED) {
      const r = checkFields(withField('product', `A ${w.toUpperCase()} tool for bakers`));
      assert.ok(codes(r).includes('product:banned_word'), w);
    }
    assert.equal(BANNED.length, 15);
    const r = checkFields(withField('world', 'A cleaning cupboard, simplest of rooms, minimalism'));
    assert.ok(!codes(r).includes('world:banned_word'));
    const r2 = checkFields(withField('signature', 'A stunning tally mark under each number'));
    assert.deepEqual(codes(r2), ['signature:banned_word']);
    assert.equal(checkFields(withField('character', 'user-friendly, cutting-edge')).problems.filter(p => p.code === 'banned_word').length, 2);
  });
  it('flags more than two moments', () => {
    assert.ok(codes(checkFields(withField('moments', 'the total, the button and the header'))).includes('moments:too_many_moments'));
    assert.ok(codes(checkFields({ ...GOOD, moments: ['a', 'b', 'c'] })).includes('moments:too_many_moments'));
    assert.ok(!codes(checkFields(withField('moments', 'the total'))).includes('moments:too_many_moments'));
    assert.ok(!codes(checkFields(withField('moments', 'the total and the button'))).includes('moments:too_many_moments'));
  });
  it('flags a field over 200 characters', () => {
    assert.ok(codes(checkFields(withField('world', 'x'.repeat(201)))).includes('world:too_long'));
    assert.ok(!codes(checkFields(withField('world', 'harbour '.repeat(25).trim()))).includes('world:too_long'));
  });
  it('flags a character with fewer than two traits', () => {
    assert.ok(codes(checkFields(withField('character', 'Patient'))).includes('character:too_few_traits'));
    assert.ok(!codes(checkFields(withField('character', 'patient and blunt'))).includes('character:too_few_traits'));
  });
  it('flags a signature that is only a colour or only a font', () => {
    for (const s of ['Orange', 'a deep teal accent colour', '#ff6600', 'Inter', 'A bold serif typeface', 'the amber and the Georgia font']) {
      assert.ok(codes(checkFields(withField('signature', s))).includes('signature:signature_not_concrete'), s);
    }
    assert.ok(!codes(checkFields(withField('signature', 'Orange underline beneath each price'))).includes('signature:signature_not_concrete'));
  });
  it('flags a world that is just a style word', () => {
    for (const s of ['minimal', 'tech', 'a modern tech startup', 'dark, futuristic']) {
      assert.ok(codes(checkFields(withField('world', s))).includes('world:world_is_style_word'), s);
    }
    assert.ok(!codes(checkFields(withField('world', 'a harbour fish market'))).includes('world:world_is_style_word'));
  });
  it('duplicate labels in text are reported and the first wins', async () => {
    const r = await run(['check'], io(`Product: first thing\nProduct: second thing\n`));
    assert.equal(r.fields.product.text, 'first thing');
    assert.ok(codes(r).includes('product:duplicate_field'));
  });
  it('multi-line values continue under a label', () => {
    const v = parseText('Moments:\n- the total\n- the print button\n\nWorld: a kitchen');
    assert.equal(v.moments, 'the total\nthe print button');
    assert.equal(v.world, 'a kitchen');
    assert.equal(checkFields(v).fields.moments.problems.length, 0);
  });
  it('ignores labels inside fenced code', () => {
    const v = parseText('```\nProduct: no\n```\nProduct: yes');
    assert.equal(v.product, 'yes');
  });
  it('text with no labels reports everything missing', async () => {
    const r = await run(['check'], io('just some words'));
    assert.equal(r.ok, false);
    assert.equal(r.problems.length, 5);
  });
  it('exit is 0 without --strict and 2 with it when not ok; JSON still carried', async () => {
    const r = await run(['check'], io(JSON.stringify({})));
    assert.equal(r.ok, false);
    assert.equal(r.exit, undefined);
    const s = await run(['check', '--strict'], io(JSON.stringify({})));
    assert.equal(s.exit, 2);
    assert.equal(s.ok, false);
    const g = await run(['check', '--strict'], io(JSON.stringify(GOOD)));
    assert.equal(g.exit, undefined);
  });
  it('rejects bad input with exit 1', async () => {
    await exit(() => run(['check'], io('')));
    await exit(() => run(['check'], io('   \n')));
    await exit(() => run(['check'], io('Product: a\0b')));
    await exit(() => run(['check'], io('{"product": ')));
    await exit(() => run(['check'], io('{"colour": "x"}')));
    await exit(() => run(['check'], io('{"product": 5}')));
    await exit(() => run(['check'], io('{"product": "a", "Product": "b"}')));
    await exit(() => run(['check'], io('é'.repeat(4.5 * 1024 * 1024))));
    await exit(() => run(['check', '--bogus'], io('x')));
    await exit(() => run(['check', '--file'], io('x')));
    await exit(() => run(['check', '--file', '--strict'], io('x')));
    await exit(() => run(['check', '--file', ''], io('x')));
    await exit(() => run(['check', '--strict', '--strict'], io('x')));
    await exit(() => run(['check', '--file', 'a', '--file', 'b'], io('x')));
  });
  it('reads --file, same as stdin; missing file and directory exit 1', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-'));
    try {
      await fs.writeFile(path.join(dir, 'd.json'), JSON.stringify(GOOD));
      await fs.writeFile(path.join(dir, 'd.md'), Object.entries(GOOD).map(([k, v]) => `${k}: ${v}`).join('\n'));
      const a = await run(['check', '--file', 'd.json'], io('', dir));
      const b = await run(['check', '--file', 'd.md'], io('', dir));
      assert.deepEqual(a, await run(['check'], io(JSON.stringify(GOOD))));
      assert.equal(b.ok, true);
      await exit(() => run(['check', '--file', 'nope.json'], io('', dir)));
      await exit(() => run(['check', '--file', '.'], io('', dir)));
      await exit(() => run(['check', '--file', '/dev/null'], io('', dir)));
      await fs.writeFile(path.join(dir, 'bin'), Buffer.from([80, 0, 1]));
      await exit(() => run(['check', '--file', 'bin'], io('', dir)));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('from-brief', () => {
  const brief = { kind: 'ui', answers: { offer: 'A prep-list printer', audience: 'bakers who start at four' } };
  it('prefills product from offer and audience; other four are todo questions', async () => {
    const r = await run(['from-brief'], io(JSON.stringify(brief)));
    assert.deepEqual(r.fields.map(f => f.id), IDS);
    const p = r.fields[0];
    assert.equal(p.text, 'A prep-list printer, for bakers who start at four.');
    assert.equal(p.todo, false);
    for (const f of r.fields.slice(1)) { assert.equal(f.todo, true); assert.equal(f.text, ''); assert.ok(f.ask); }
    assert.deepEqual(r.prefilled, ['product']);
  });
  it('accepts the assume output shape and partial answers', async () => {
    const r = await run(['from-brief'], io(JSON.stringify({ kind: 'landing', brief: { offer: 'x tool' } })));
    assert.equal(r.fields[0].text, 'x tool.');
    assert.equal(r.fields[0].todo, true);
    const e = await run(['from-brief'], io(JSON.stringify({ kind: 'ui' })));
    assert.equal(e.fields[0].text, '');
    assert.deepEqual(e.prefilled, []);
    assert.equal(fromBrief({ kind: 'ui', answers: { audience: 'cooks' } }).fields[0].text, 'For cooks.');
  });
  it('real design-brief assume output: assumed fields are unknown, product stays todo', async () => {
    const runAssume = answers => JSON.parse(execFileSync(process.execPath, [CLI, 'design-brief', 'assume'], { input: JSON.stringify({ kind: 'ui', answers }), encoding: 'utf-8' }));
    const none = runAssume({});
    assert.ok(none.assumptions.some(a => a.field === 'offer'));
    const r0 = await run(['from-brief'], io(JSON.stringify(none)));
    assert.equal(r0.fields[0].text, '');
    assert.equal(r0.fields[0].todo, true);
    assert.deepEqual(r0.prefilled, []);
    const r1 = await run(['from-brief'], io(JSON.stringify(runAssume({ offer: 'A prep-list printer' }))));
    assert.equal(r1.fields[0].text, 'A prep-list printer.');
    assert.equal(r1.fields[0].todo, true);
    assert.match(r1.fields[0].note, /audience/);
    const r2 = await run(['from-brief'], io(JSON.stringify(runAssume({ offer: 'A prep-list printer', audience: 'bakers' }))));
    assert.equal(r2.fields[0].todo, false);
    assert.equal(r2.fields[0].text, 'A prep-list printer, for bakers.');
  });
  it('exit 1 when not a design-brief shape', async () => {
    await exit(() => run(['from-brief'], io('[1]')));
    await exit(() => run(['from-brief'], io(JSON.stringify(GOOD))));
    await exit(() => run(['from-brief'], io(JSON.stringify({ kind: 'poster' }))));
    await exit(() => run(['from-brief'], io('not json')));
    await exit(() => run(['from-brief'], io('')));
    await exit(() => run(['from-brief', '--strict'], io('{}')));
    await exit(() => run(['from-brief', '--file', 'missing.json'], io('')));
  });
  it('reads --file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-'));
    try {
      await fs.writeFile(path.join(dir, 'b.json'), JSON.stringify(brief));
      assert.equal((await run(['from-brief', '--file', 'b.json'], io('', dir))).fields[0].todo, false);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
