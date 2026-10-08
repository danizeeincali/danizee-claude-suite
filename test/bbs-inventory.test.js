/**
 * Contract for src/lib/bbs/inventory.js and the `inventory` verb — stream `inventory` of marathon 2026-10-07-bbs.
 * Helpers read the source and return JSON only; the CLI validates, caps at 12, marks the rest `not_inventoried`.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  POWER_FIELDS, NETWORK, SIZE, validatePower, parseInventory, inventoryBrief, listSourceFiles, writeInventory
} from '../src/lib/bbs/inventory.js';
import { intake } from '../src/lib/bbs/intake.js';
import { readJson } from '../src/lib/bbs/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(path.dirname(__dirname), 'src', 'lib', 'bbs', 'cli.js');
const now = () => new Date('2026-10-07T12:00:00Z');

const power = (over = {}) => ({
  name: 'drift-monitor', what: 'Detects config drift between runs', evidence: 'src/drift.js:12', dependencies: ['node:fs'],
  data_needed: 'none', network: 'none', size: 'small', licence: 'MIT', idea: 'Hash the effective config each run and diff against the last hash.', ...over
});

describe('inventory — schema', () => {
  it('exposes the nine fields and the two enums from the spec', () => {
    assert.deepEqual(POWER_FIELDS, ['name', 'what', 'evidence', 'dependencies', 'data_needed', 'network', 'size', 'licence', 'idea']);
    assert.deepEqual(NETWORK, ['none', 'outbound', 'inbound', 'unknown']);
    assert.deepEqual(SIZE, ['small', 'medium', 'large']);
  });

  it('validatePower returns a normalised copy (trimmed strings, lower-case enums, licence kept as given) and nothing extra', () => {
    const p = validatePower({ ...power({ name: '  Drift Monitor ', network: 'NONE', size: 'Small' }), extra: 'dropped' }, 0);
    assert.equal(p.name, 'Drift Monitor');
    assert.equal(p.network, 'none');
    assert.equal(p.size, 'small');
    assert.equal(p.licence, 'MIT');
    assert.deepEqual(Object.keys(p).sort(), [...POWER_FIELDS].sort());
  });

  it('every missing or empty field is refused with the index and the field name', () => {
    for (const f of POWER_FIELDS) {
      const bad = power(); delete bad[f];
      assert.throws(() => validatePower(bad, 3), new RegExp(`powers\\[3\\]\\.${f}.*(missing|required)`), `missing ${f}`);
      if (f !== 'dependencies') {
        assert.throws(() => validatePower(power({ [f]: '   ' }), 3), new RegExp(`powers\\[3\\]\\.${f}.*empty`), `empty ${f}`);
      }
    }
  });

  it('enums and types are enforced: network/size outside the list, dependencies not an array of strings, name too long', () => {
    assert.throws(() => validatePower(power({ network: 'sometimes' }), 0), /powers\[0\]\.network.*none\|outbound\|inbound\|unknown/);
    assert.throws(() => validatePower(power({ size: 'huge' }), 0), /powers\[0\]\.size.*small\|medium\|large/);
    assert.throws(() => validatePower(power({ dependencies: 'node:fs' }), 0), /powers\[0\]\.dependencies.*array/);
    assert.throws(() => validatePower(power({ dependencies: ['ok', 7] }), 0), /powers\[0\]\.dependencies\[1\].*string/);
    assert.throws(() => validatePower(power({ name: 'x'.repeat(81) }), 0), /powers\[0\]\.name.*80/);
    assert.throws(() => validatePower(power({ what: 42 }), 0), /powers\[0\]\.what.*string/);
    assert.throws(() => validatePower(null, 0), /powers\[0\].*object/);
    assert.throws(() => validatePower({ ...power(), __proto__: { polluted: 1 } }, 0) && false, Error, 'a prototype key is not a field');
  });

  it('idea must be in our words: an idea that is mostly a code block or longer than 1200 chars is refused', () => {
    assert.throws(() => validatePower(power({ idea: '```js\nfunction x(){}\n```' }), 0), /powers\[0\]\.idea.*(code|words)/);
    assert.throws(() => validatePower(power({ idea: 'a'.repeat(1201) }), 0), /powers\[0\]\.idea.*1200/);
    assert.equal(validatePower(power({ idea: 'Use `hash` of the config as the key.' }), 0).idea, 'Use `hash` of the config as the key.', 'inline code is fine');
  });
});

describe('inventory — parseInventory', () => {
  it('accepts a JSON object with powers, a bare array, and JSON wrapped in a ```json fence; returns normalised powers in order', () => {
    const list = [power(), power({ name: 'second' })];
    for (const input of [JSON.stringify({ powers: list }), JSON.stringify(list), '```json\n' + JSON.stringify(list) + '\n```', { powers: list }, list]) {
      const r = parseInventory(input);
      assert.deepEqual(r.powers.map(p => p.name), ['drift-monitor', 'second']);
      assert.deepEqual(r.not_inventoried, []);
      assert.equal(r.total, 2);
    }
  });

  it('refuses prose or broken JSON with "JSON only" and the first 60 characters of what it got', () => {
    assert.throws(() => parseInventory('Here are the powers I found:\n1. a drift monitor'), /JSON only.*Here are the powers I found/);
    assert.throws(() => parseInventory('{ "powers": [ broken'), /JSON only/);
    assert.throws(() => parseInventory(''), /JSON only|empty/);
    assert.throws(() => parseInventory('"just a string"'), /powers/);
    assert.throws(() => parseInventory({ items: [] }), /powers/);
  });

  it('refuses duplicate names (case-insensitive, trimmed) naming the duplicate and both indexes', () => {
    assert.throws(() => parseInventory([power(), power({ name: ' DRIFT-monitor' })]), /duplicate.*drift-monitor.*0.*1/i);
  });

  it('an empty list needs an explicit none_found reason; with it the result has zero powers', () => {
    assert.throws(() => parseInventory([]), /none_found/);
    assert.throws(() => parseInventory({ powers: [] }), /none_found/);
    const r = parseInventory({ powers: [], none_found: 'the page is a product landing page with no reusable capability' });
    assert.equal(r.total, 0);
    assert.equal(r.none_found, 'the page is a product landing page with no reusable capability');
    assert.throws(() => parseInventory({ powers: [], none_found: '' }), /none_found/);
    assert.throws(() => parseInventory({ powers: [power()], none_found: 'x' }), /none_found.*powers/, 'a reason with powers is contradictory');
  });

  it('caps at maxPowers (default 12): the first N are kept, the rest are listed by name as not_inventoried, total is the full count', () => {
    const many = Array.from({ length: 15 }, (_, i) => power({ name: `p${i}` }));
    const r = parseInventory(many);
    assert.equal(r.powers.length, 12);
    assert.deepEqual(r.not_inventoried, ['p12', 'p13', 'p14']);
    assert.equal(r.total, 15);
    const r3 = parseInventory(many, { maxPowers: 3 });
    assert.equal(r3.powers.length, 3);
    assert.equal(r3.not_inventoried.length, 12);
    assert.throws(() => parseInventory(many, { maxPowers: 0 }), /maxPowers/);
  });

  it('validation errors inside the list keep the index of the offending power', () => {
    assert.throws(() => parseInventory([power(), power({ name: 'b', size: 'enormous' })]), /powers\[1\]\.size/);
  });
});

describe('inventory — brief and source files', () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-inv-'));
    await fs.mkdir(path.join(dir, 'tool', 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tool', 'node_modules', 'x'), { recursive: true });
    await fs.mkdir(path.join(dir, 'tool', '.git'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tool', 'LICENSE'), 'MIT License');
    await fs.writeFile(path.join(dir, 'tool', 'README.md'), '# tool\n');
    await fs.writeFile(path.join(dir, 'tool', 'src', 'a.js'), 'export const a = 1;\n');
    await fs.writeFile(path.join(dir, 'tool', 'node_modules', 'x', 'i.js'), '1');
    await fs.writeFile(path.join(dir, 'tool', '.git', 'HEAD'), 'ref');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('listSourceFiles: local dir → relative paths with sizes, sorted, skipping .git and node_modules, capped with a flag', async () => {
    const r = await intake(dir, path.join(dir, 'tool'), { now, isGitRepo: () => false });
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', r.runId);
    const files = await listSourceFiles(runDir, await readJson(path.join(runDir, 'source.json')));
    assert.deepEqual(files.files.map(f => f.path), ['LICENSE', 'README.md', 'src/a.js']);
    assert.equal(files.files[0].size, 11);
    assert.equal(files.root, path.join(dir, 'tool'));
    assert.equal(files.truncated, false);
    assert.equal(files.licence_file, 'LICENSE');
    const capped = await listSourceFiles(runDir, await readJson(path.join(runDir, 'source.json')), { maxFiles: 2 });
    assert.equal(capped.files.length, 2);
    assert.equal(capped.truncated, true);
    assert.equal(capped.total, 3);
  });

  it('listSourceFiles: paste → fetched/paste.txt; url → the fetched file; an unfetched source is an error', async () => {
    const p = await intake(dir, '-', { stdin: 'pasted idea', now, slug: 'lp' });
    const pDir = path.join(dir, '.claude', 'bbs', 'runs', p.runId);
    const pf = await listSourceFiles(pDir, await readJson(path.join(pDir, 'source.json')));
    assert.deepEqual(pf.files.map(f => f.path), ['paste.txt']);
    assert.equal(pf.root, path.join(pDir, 'fetched'));
    assert.equal(pf.licence_file, null);
    const u = await intake(dir, 'https://example.com/x', { now, slug: 'lu' });
    const uDir = path.join(dir, '.claude', 'bbs', 'runs', u.runId);
    await assert.rejects(async () => listSourceFiles(uDir, await readJson(path.join(uDir, 'source.json'))), /fetch/);
  });

  it('inventoryBrief names every field, both enums, the cap, "JSON only", "do not execute", the files to read and the idea rule', async () => {
    const r = await intake(dir, path.join(dir, 'tool'), { now, isGitRepo: () => false, slug: 'br' });
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', r.runId);
    const source = await readJson(path.join(runDir, 'source.json'));
    const files = await listSourceFiles(runDir, source);
    const brief = inventoryBrief({ source, files, maxPowers: 12 });
    for (const f of POWER_FIELDS) assert.match(brief, new RegExp(`\\b${f}\\b`), f);
    for (const e of [...NETWORK, ...SIZE]) assert.match(brief, new RegExp(`\\b${e}\\b`), e);
    assert.match(brief, /JSON only/);
    assert.match(brief, /at most 12/);
    assert.match(brief, /do not (execute|run)/i);
    assert.match(brief, /in our words/i);
    assert.match(brief, /not copy|no source code|never copy/i);
    assert.match(brief, /LICENSE/);
    assert.match(brief, /src\/a\.js/);
    assert.match(brief, /none_found/);
    assert.match(brief, /cli\.js inventory --from/);
    assert.ok(!/undefined|\[object Object\]/.test(brief));
    const truncated = inventoryBrief({ source, files: { ...files, truncated: true, total: 900 }, maxPowers: 12 });
    assert.match(truncated, /900 files/);
  });
});

describe('inventory — writeInventory', () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-winv-'));
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('writes powers.json with provenance and re-renders status; next is map', async () => {
    const r = await intake(dir, '-', { stdin: 'a tool that monitors drift', now, slug: 'w1' });
    const out = await writeInventory(dir, { run: r.runId, input: JSON.stringify([power(), power({ name: 'b' })]), now });
    assert.equal(out.found, 2);
    assert.deepEqual(out.not_inventoried, []);
    assert.equal(out.next, 'map');
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', r.runId);
    const pj = await readJson(path.join(runDir, 'powers.json'));
    assert.equal(pj.powers.length, 2);
    assert.equal(pj.source_identity, r.identity);
    assert.equal(pj.run, r.runId);
    assert.equal(pj.total, 2);
    assert.ok(pj.ts);
    const status = await fs.readFile(path.join(runDir, 'status.md'), 'utf-8');
    assert.match(status, /\| inventory \| done \| 2 powers \(0 not inventoried\) \|/);
    assert.match(status, /- Next: `cli\.js map`/);
  });

  it('refuses when the source is not fetched yet, and never writes a partial powers.json on invalid input', async () => {
    const u = await intake(dir, 'https://example.com/y', { now, slug: 'w2' });
    await assert.rejects(() => writeInventory(dir, { run: u.runId, input: JSON.stringify([power()]), now }), /fetch/);
    const p = await intake(dir, '-', { stdin: 'x', now, slug: 'w3' });
    await assert.rejects(() => writeInventory(dir, { run: p.runId, input: 'not json', now }), /JSON only/);
    await assert.rejects(() => fs.stat(path.join(dir, '.claude', 'bbs', 'runs', p.runId, 'powers.json')));
  });

  it('refuses to overwrite an existing powers.json without force, and with force replaces it atomically', async () => {
    const p = await intake(dir, '-', { stdin: 'x', now, slug: 'w4' });
    await writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now });
    await assert.rejects(() => writeInventory(dir, { run: p.runId, input: JSON.stringify([power({ name: 'z' })]), now }), /powers\.json exists.*--force/);
    const out = await writeInventory(dir, { run: p.runId, input: JSON.stringify([power({ name: 'z' })]), now, force: true });
    assert.equal(out.found, 1);
    const pj = await readJson(path.join(dir, '.claude', 'bbs', 'runs', p.runId, 'powers.json'));
    assert.deepEqual(pj.powers.map(x => x.name), ['z']);
  });

  it('uses cfg.limits.max_powers for the cap', async () => {
    const p = await intake(dir, '-', { stdin: 'x', now, slug: 'w5' });
    const { DEFAULT_CONFIG } = await import('../src/lib/bbs/config.js');
    const cfg = { ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits, max_powers: 1 } };
    const out = await writeInventory(dir, { run: p.runId, input: JSON.stringify([power(), power({ name: 'b' })]), now, cfg });
    assert.equal(out.found, 1);
    assert.deepEqual(out.not_inventoried, ['b']);
  });
});

describe('inventory — cli verb', () => {
  let dir;
  function run(cwd, args, input) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', input });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-invcli-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('usage lists the verb with --brief | --from <file|-> [--force]; exactly one of --brief/--from is required; positionals rejected', () => {
    const u = run(dir, ['nope']);
    assert.match(u.err, /cli\.js inventory \(--brief \| --from <file\|->\) \[--force\] \[--run <id>\] \[--project <dir>\]/);
    run(dir, ['intake', '-', '--slug', 'c1'], 'pasted');
    const none = run(dir, ['inventory']);
    assert.equal(none.code, 1);
    assert.match(none.err, /--brief or --from/);
    const both = run(dir, ['inventory', '--brief', '--from', 'x.json']);
    assert.equal(both.code, 1);
    assert.match(both.err, /--brief or --from/);
    const pos = run(dir, ['inventory', '--brief', 'extra']);
    assert.equal(pos.code, 1);
    assert.match(pos.err, /unexpected argument "extra"/);
  });

  it('--brief prints the plain-text brief (not JSON) for the active run', () => {
    const b = run(dir, ['inventory', '--brief']);
    assert.equal(b.code, 0, b.err);
    assert.equal(b.json, null, 'plain text, not JSON');
    assert.match(b.out, /JSON only/);
    assert.match(b.out, /paste\.txt/);
  });

  it('--from <file> validates and writes; --from - reads stdin; invalid input exits 1 with the field; next is map', async () => {
    const f = path.join(dir, 'inv.json');
    await fs.writeFile(f, JSON.stringify({ powers: [power()] }));
    const r = run(dir, ['inventory', '--from', f]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.found, 1);
    assert.equal(r.json.next, 'map');
    const again = run(dir, ['inventory', '--from', f]);
    assert.equal(again.code, 1);
    assert.match(again.err, /--force/);
    const forced = run(dir, ['inventory', '--from', '-', '--force'], JSON.stringify([power({ name: 'from-stdin' })]));
    assert.equal(forced.code, 0, forced.err);
    assert.equal(forced.json.found, 1);
    const bad = run(dir, ['inventory', '--from', '-', '--force'], JSON.stringify([power({ size: 'vast' })]));
    assert.equal(bad.code, 1);
    assert.match(bad.err, /powers\[0\]\.size/);
    const missing = run(dir, ['inventory', '--from', path.join(dir, 'nope.json'), '--force']);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /nope\.json/);
  });

  it('status --next after inventory is map, and report counts the powers', () => {
    assert.equal(run(dir, ['status', '--next']).out.trim(), 'map');
    assert.equal(run(dir, ['report']).out.trim(), 'found=1 approved=0 skipped=0 buy=0 marathon=none');
  });
});
