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
  POWER_FIELDS, NETWORK, SIZE, validatePower, parseInventory, inventoryBrief, listSourceFiles, writeInventory, SKIP_DIRS
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

describe('inventory — review r1 regressions', () => {
  let dir;
  function run(cwd, args, input) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', input });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-invr1-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  // fence
  it('fenced JSON: CRLF, ```JSON, a trailing space after the tag, and ``` inside a value all parse', () => {
    const list = [power(), power({ name: 'second', evidence: 'see the ```example``` block in README' })];
    const body = JSON.stringify(list);
    for (const input of [
      '```json\r\n' + body + '\r\n```',
      '```JSON\n' + body + '\n```',
      '```json  \n' + body + '\n```\n',
      '```\n' + body + '\n```',
      '  ```json\n' + JSON.stringify(list, null, 2) + '\n```  '
    ]) {
      const r = parseInventory(input);
      assert.deepEqual(r.powers.map(p => p.name), ['drift-monitor', 'second'], JSON.stringify(input.slice(0, 12)));
      assert.equal(r.powers[1].evidence, 'see the ```example``` block in README');
    }
  });

  it('fenced JSON: an idea containing ``` reaches the idea rule instead of breaking the parse', () => {
    const body = JSON.stringify([power({ idea: 'It wraps ``` fences around output.' })]);
    assert.throws(() => parseInventory('```json\n' + body + '\n```'), /powers\[0\]\.idea must be in our words, not code/);
  });

  // in our words
  it('idea: one-line lowercase prose is accepted whatever its first word', () => {
    for (const idea of ['this module caches responses by url', 'for each file it computes a content hash', 'return the cached value when the hash matches', 'new runs reuse the old manifest']) {
      assert.equal(validatePower(power({ idea }), 0).idea, idea);
    }
  });

  it('idea: a Python def/return three-liner and prose followed by a fenced block are refused', () => {
    assert.throws(() => validatePower(power({ idea: 'def add(a, b):\n    total = a + b\n    return total' }), 0), /powers\[0\]\.idea must be in our words, not code/);
    assert.throws(() => validatePower(power({ idea: 'It hashes the config.\n```\nconst a = 1;\n```' }), 0), /powers\[0\]\.idea must be in our words, not code/);
    assert.throws(() => validatePower(power({ idea: 'int main() {\n  run();\n}' }), 0), /powers\[0\]\.idea must be in our words, not code/);
  });

  it('idea: three prose lines are accepted (the code-line heuristic needs more than half code)', () => {
    const idea = 'It hashes the effective config.\nIt compares the hash with the last run.\nfunctions are not copied;';
    assert.equal(validatePower(power({ idea }), 0).idea, idea);
  });

  // name
  it('name: newlines, pipes, slashes, backslashes, control chars, a leading dot and prototype names are refused with the rule', () => {
    const cases = [
      ['a|b\n# x', /powers\[2\]\.name.*one line/],
      ['line\tbreak', /powers\[2\]\.name.*control/],
      ['bell\u0007', /powers\[2\]\.name.*control/],
      ['a|b', /powers\[2\]\.name.*\|/],
      ['../../etc/passwd', /powers\[2\]\.name.*(\/|start)/],
      ['etc/passwd', /powers\[2\]\.name.*\//],
      ['a\\b', /powers\[2\]\.name.*\\/],
      ['.hidden', /powers\[2\]\.name.*start with "\."/],
      ['__proto__', /powers\[2\]\.name.*reserved/],
      ['Constructor', /powers\[2\]\.name.*reserved/],
      ['PROTOTYPE', /powers\[2\]\.name.*reserved/],
      ['drift*monitor', /powers\[2\]\.name.*letters, digits/],
      ['-dash-first', /powers\[2\]\.name.*letters, digits/]
    ];
    for (const [name, re] of cases) assert.throws(() => validatePower(power({ name }), 2), re, JSON.stringify(name));
  });

  it('name: unicode letters, dots, underscores and dashes are fine; 80 characters pass and 81 do not; stored NFC and collapsed', () => {
    assert.equal(validatePower(power({ name: 'Café_cache.v2-fast' }), 0).name, 'Café_cache.v2-fast');
    assert.equal(validatePower(power({ name: 'x'.repeat(80) }), 0).name, 'x'.repeat(80));
    assert.throws(() => validatePower(power({ name: 'x'.repeat(81) }), 0), /powers\[0\]\.name.*80/);
    assert.equal(validatePower(power({ name: 'Drift   Monitor' }), 0).name, 'Drift Monitor');
    const nfd = 'Café cache';
    assert.equal(validatePower(power({ name: nfd }), 0).name, 'Café cache');
  });

  // duplicates
  it('duplicate names are compared after NFC normalisation and whitespace collapse', () => {
    assert.throws(() => parseInventory([power({ name: 'Café cache' }), power({ name: 'café cache' })]), /duplicate.*café cache.*0.*1/i);
    assert.throws(() => parseInventory([power({ name: 'drift monitor' }), power({ name: 'Drift  Monitor' })]), /duplicate.*drift monitor.*0.*1/i);
  });

  // none_found
  it('none_found: present but not a string is refused; a string is stored trimmed', () => {
    assert.throws(() => parseInventory({ powers: [power()], none_found: 5 }), /none_found must be a string/);
    assert.throws(() => parseInventory({ powers: [], none_found: true }), /none_found must be a string/);
    assert.throws(() => parseInventory({ powers: [power()], none_found: null }), /none_found must be a string/);
    assert.equal(parseInventory({ powers: [], none_found: '  only a landing page  ' }).none_found, 'only a landing page');
  });

  // source files
  async function localRun(name, build) {
    const src = path.join(dir, name);
    await fs.mkdir(src, { recursive: true });
    await build(src);
    const r = await intake(dir, src, { now, isGitRepo: () => false, slug: name });
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', r.runId);
    return { src, runDir, source: await readJson(path.join(runDir, 'source.json')) };
  }

  it('licence: the root LICENSE wins over a nested one regardless of walk order; LICENSE-MIT alone is found', async () => {
    const a = await localRun('lic1', async (src) => {
      await fs.mkdir(path.join(src, 'A'));
      await fs.writeFile(path.join(src, 'A', 'LICENSE'), 'nested');
      await fs.mkdir(path.join(src, '0'));
      await fs.writeFile(path.join(src, '0', 'COPYING'), 'nested');
      await fs.writeFile(path.join(src, 'LICENSE'), 'root');
    });
    assert.equal((await listSourceFiles(a.runDir, a.source)).licence_file, 'LICENSE');
    const b = await localRun('lic2', async (src) => {
      await fs.writeFile(path.join(src, 'LICENSE-MIT'), 'mit');
      await fs.writeFile(path.join(src, 'index.js'), '1');
    });
    assert.equal((await listSourceFiles(b.runDir, b.source)).licence_file, 'LICENSE-MIT');
    const c = await localRun('lic3', async (src) => {
      await fs.writeFile(path.join(src, 'LICENSE-MIT'), 'mit');
      await fs.writeFile(path.join(src, 'LICENSE-APACHE'), 'apache');
    });
    assert.equal((await listSourceFiles(c.runDir, c.source)).licence_file, 'LICENSE-APACHE', 'same depth → alphabetical');
    const d = await localRun('lic4', async (src) => {
      await fs.writeFile(path.join(src, 'LICENSED_TO.txt'), 'not a licence');
    });
    assert.equal((await listSourceFiles(d.runDir, d.source)).licence_file, null);
  });

  it('a local source removed after intake fails loudly naming the path', async () => {
    const g = await localRun('gone', async (src) => { await fs.writeFile(path.join(src, 'a.js'), '1'); });
    await fs.rm(g.src, { recursive: true, force: true });
    await assert.rejects(() => listSourceFiles(g.runDir, g.source), (err) => {
      assert.match(err.message, /source root .* is missing or not a directory — re-run intake/);
      assert.ok(err.message.includes(g.src), err.message);
      return true;
    });
    const f = await localRun('afile', async (src) => { await fs.writeFile(path.join(src, 'a.js'), '1'); });
    await fs.rm(f.src, { recursive: true, force: true });
    await fs.writeFile(f.src, 'now a file');
    await assert.rejects(() => listSourceFiles(f.runDir, f.source), /missing or not a directory/);
  });

  it('an unreadable subdirectory is reported in errors and in the brief under "Could not read"', { skip: process.getuid?.() === 0 && 'root can read 000 dirs' }, async () => {
    const u = await localRun('unread', async (src) => {
      await fs.writeFile(path.join(src, 'a.js'), '1');
      await fs.mkdir(path.join(src, 'locked'));
      await fs.writeFile(path.join(src, 'locked', 'b.js'), '1');
    });
    await fs.chmod(path.join(u.src, 'locked'), 0o000);
    try {
      const files = await listSourceFiles(u.runDir, u.source);
      assert.deepEqual(files.files.map(f => f.path), ['a.js']);
      assert.deepEqual(files.errors, [{ path: 'locked', code: 'EACCES' }]);
      const brief = inventoryBrief({ source: u.source, files, maxPowers: 12 });
      assert.match(brief, /Could not read/);
      assert.match(brief, /locked \(EACCES\)/);
    } finally {
      await fs.chmod(path.join(u.src, 'locked'), 0o755);
    }
    const ok = await listSourceFiles(u.runDir, u.source);
    assert.deepEqual(ok.errors, []);
    assert.doesNotMatch(inventoryBrief({ source: u.source, files: ok, maxPowers: 12 }), /Could not read/);
  });

  it('a symlink pointing outside the root is not listed', async () => {
    const outside = path.join(dir, 'outside');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'secret.txt'), 'outside');
    const s = await localRun('linked', async (src) => {
      await fs.writeFile(path.join(src, 'a.js'), '1');
      await fs.symlink('../outside', path.join(src, 'out'));
      await fs.symlink('../outside/secret.txt', path.join(src, 'secret-link.txt'));
    });
    const files = await listSourceFiles(s.runDir, s.source);
    assert.deepEqual(files.files.map(f => f.path), ['a.js']);
    assert.equal(files.total, 1);
  });

  it('a repo-type source lists paths relative to fetched/ (repo/…) and skips .git', async () => {
    const r = await intake(dir, 'https://github.com/acme/tool', { now, slug: 'repo1' });
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', r.runId);
    const source = await readJson(path.join(runDir, 'source.json'));
    assert.equal(source.type, 'repo');
    const repo = path.join(runDir, 'fetched', 'repo');
    await fs.mkdir(path.join(repo, '.git', 'objects'), { recursive: true });
    await fs.writeFile(path.join(repo, '.git', 'HEAD'), 'ref');
    await fs.mkdir(path.join(repo, 'src'), { recursive: true });
    await fs.writeFile(path.join(repo, 'src', 'x.js'), 'x');
    await fs.writeFile(path.join(repo, 'LICENSE'), 'MIT');
    const fetched = { ...source, fetched: true, identity: 'git:0123456789abcdef0123456789abcdef01234567' };
    const files = await listSourceFiles(runDir, fetched);
    assert.equal(files.root, path.join(runDir, 'fetched'));
    assert.deepEqual(files.files.map(f => f.path), ['repo/LICENSE', 'repo/src/x.js']);
    assert.equal(files.licence_file, 'repo/LICENSE');
  });

  it('secret-like files are omitted and counted; .env and id_rsa give omitted_secret 2', async () => {
    const s = await localRun('secrets', async (src) => {
      await fs.writeFile(path.join(src, '.env'), 'TOKEN=abc');
      await fs.writeFile(path.join(src, 'id_rsa'), 'key');
      await fs.writeFile(path.join(src, 'index.js'), '1');
    });
    const files = await listSourceFiles(s.runDir, s.source);
    assert.deepEqual(files.files.map(f => f.path), ['index.js']);
    assert.equal(files.omitted_secret, 2);
    const brief = inventoryBrief({ source: s.source, files, maxPowers: 12 });
    assert.doesNotMatch(brief, /\.env|id_rsa/);
    assert.match(brief, /Never copy values from configuration or secret files into evidence or idea; 2 secret-like file\(s\) were omitted from this list\./);
  });

  it('every secret-like name in the list is omitted; look-alikes are kept', async () => {
    const secret = ['.env', '.env.local', '.ENV.production', 'server.pem', 'tls.key', 'id_rsa', 'id_ed25519.pub', 'id_ecdsa', 'id_dsa',
      '.npmrc', '.netrc', 'credentials', 'Credentials.json', 'cert.p12', 'cert.pfx', 'store.jks', '.git-credentials'];
    const kept = ['.envrc', 'env.js', 'keys.js', 'id_rsa.md', 'my-credentials.md', 'pem.txt'];
    const s = await localRun('secrets2', async (src) => {
      await fs.mkdir(path.join(src, 'nested'));
      for (const n of secret) await fs.writeFile(path.join(src, 'nested', n), 's');
      for (const n of kept) await fs.writeFile(path.join(src, n), 'k');
    });
    const files = await listSourceFiles(s.runDir, s.source);
    assert.deepEqual(files.files.map(f => f.path), [...kept].sort((a, b) => a.localeCompare(b)));
    assert.equal(files.omitted_secret, secret.length);
    assert.equal(files.total, kept.length);
    const clean = await localRun('nosecrets', async (src) => { await fs.writeFile(path.join(src, 'a.js'), '1'); });
    const cf = await listSourceFiles(clean.runDir, clean.source);
    assert.equal(cf.omitted_secret, 0);
    assert.doesNotMatch(inventoryBrief({ source: clean.source, files: cf, maxPowers: 12 }), /secret-like/);
  });

  it('the cap takes root files and each top-level directory in turn, listed in sorted order; total is the full count', async () => {
    const s = await localRun('sorted', async (src) => {
      await fs.writeFile(path.join(src, 'z.js'), '1');
      await fs.mkdir(path.join(src, 'b'));
      await fs.writeFile(path.join(src, 'b', 'a.js'), '1');
      await fs.writeFile(path.join(src, 'a.js'), '1');
      await fs.writeFile(path.join(src, 'c.js'), '1');
    });
    const capped = await listSourceFiles(s.runDir, s.source, { maxFiles: 2 });
    assert.deepEqual(capped.files.map(f => f.path), ['a.js', 'b/a.js']);
    assert.equal(capped.total, 4);
    assert.equal(capped.truncated, true);
    const exact = await listSourceFiles(s.runDir, s.source, { maxFiles: 4 });
    assert.equal(exact.files.length, 4);
    assert.equal(exact.truncated, false);
  });

  it('a bulky directory cannot crowd out the rest: the cap is spread across top-level dirs, shallowest first, and the brief counts each dir', async () => {
    const s = await localRun('spread', async (src) => {
      await fs.writeFile(path.join(src, 'README.md'), '1');
      await fs.mkdir(path.join(src, 'bench'));
      for (let i = 0; i < 10; i++) await fs.writeFile(path.join(src, 'bench', `r${i}.json`), '1');
      await fs.mkdir(path.join(src, 'pkg', 'deep'), { recursive: true });
      await fs.writeFile(path.join(src, 'pkg', 'deep', 'a.js'), '1');
      await fs.writeFile(path.join(src, 'pkg', 'z.js'), '1');
    });
    const files = await listSourceFiles(s.runDir, s.source, { maxFiles: 5 });
    assert.deepEqual(files.files.map(f => f.path), ['bench/r0.json', 'bench/r1.json', 'pkg/deep/a.js', 'pkg/z.js', 'README.md']);
    assert.equal(files.total, 13);
    assert.deepEqual(files.dirs, [{ dir: 'bench', files: 10, listed: 2 }, { dir: 'pkg', files: 2, listed: 2 }]);
    const brief = inventoryBrief({ source: s.source, files, maxPowers: 12 });
    assert.match(brief, /- bench\/ — 2 \/ 10/);
    assert.match(brief, /- pkg\/ — 2 \/ 2/);
    const shallow = await listSourceFiles(s.runDir, s.source, { maxFiles: 4 });
    assert.ok(shallow.files.some(f => f.path === 'pkg/z.js') && !shallow.files.some(f => f.path === 'pkg/deep/a.js'), 'shallower path first within a dir');
  });

  it('a clone wrapped in one directory (fetched/repo/...) is spread across the directories below the wrapper', async () => {
    const s = await localRun('wrapped', async (src) => {
      await fs.mkdir(path.join(src, 'repo', 'bench'), { recursive: true });
      await fs.mkdir(path.join(src, 'repo', 'pkg'), { recursive: true });
      for (let i = 0; i < 5; i++) await fs.writeFile(path.join(src, 'repo', 'bench', `r${i}.json`), '1');
      await fs.writeFile(path.join(src, 'repo', 'pkg', 'a.js'), '1');
      await fs.writeFile(path.join(src, 'repo', 'README.md'), '1');
    });
    const files = await listSourceFiles(s.runDir, s.source, { maxFiles: 3 });
    assert.deepEqual(files.files.map(f => f.path), ['repo/bench/r0.json', 'repo/pkg/a.js', 'repo/README.md']);
    assert.deepEqual(files.dirs, [{ dir: 'repo/bench', files: 5, listed: 1 }, { dir: 'repo/pkg', files: 1, listed: 1 }]);
  });

  // brief
  it('a truncated brief gives an actionable instruction instead of "ask for a narrower slice"', async () => {
    const s = await localRun('trunc', async (src) => {
      for (const n of ['a.js', 'b.js', 'c.js']) await fs.writeFile(path.join(src, n), '1');
    });
    const files = await listSourceFiles(s.runDir, s.source, { maxFiles: 2 });
    const brief = inventoryBrief({ source: s.source, files, maxPowers: 12 });
    assert.match(brief, /3 files in total\*\* — only 2 are listed, spread across the top-level directories/);
    assert.match(brief, /Inventory only the files listed here; name any unlisted top-level directory in evidence instead of reading it\./);
    assert.doesNotMatch(brief, /narrower slice/);
    const full = inventoryBrief({ source: s.source, files: await listSourceFiles(s.runDir, s.source), maxPowers: 12 });
    assert.doesNotMatch(full, /Inventory only the files listed here/);
  });

  // claim
  it('two concurrent writeInventory calls without --force: exactly one succeeds, the other names --force', async () => {
    const p = await intake(dir, '-', { stdin: 'race', now, slug: 'race' });
    const results = await Promise.allSettled([
      writeInventory(dir, { run: p.runId, input: JSON.stringify([power({ name: 'one' })]), now }),
      writeInventory(dir, { run: p.runId, input: JSON.stringify([power({ name: 'two' })]), now })
    ]);
    const ok = results.filter(r => r.status === 'fulfilled');
    const bad = results.filter(r => r.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(bad.length, 1);
    assert.match(bad[0].reason.message, /powers\.json exists — pass --force to replace it/);
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', p.runId);
    const winner = results[0].status === 'fulfilled' ? 'one' : 'two';
    assert.deepEqual((await readJson(path.join(runDir, 'powers.json'))).powers.map(x => x.name), [winner]);
    const leftovers = (await fs.readdir(runDir)).filter(n => n.endsWith('.tmp'));
    assert.deepEqual(leftovers, [], 'no tmp files left behind');
  });

  // --force staleness
  it('--force moves map.json, verdicts.json and handoff.json aside as *.stale-<ts>.json and reports them; next is map', async () => {
    const p = await intake(dir, '-', { stdin: 'stale', now, slug: 'stale' });
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', p.runId);
    await writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now });
    await fs.writeFile(path.join(runDir, 'map.json'), JSON.stringify({ judgments: { 'drift-monitor': { rebuild: 'easy' } } }));
    await fs.writeFile(path.join(runDir, 'verdicts.json'), JSON.stringify({ decisions: { 'drift-monitor': 'use' } }));
    const out = await writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now, force: true });
    assert.deepEqual(out.stale_moved, ['map.json', 'verdicts.json']);
    assert.equal(out.next, 'map');
    const names = await fs.readdir(runDir);
    assert.ok(!names.includes('map.json'));
    assert.ok(!names.includes('verdicts.json'));
    assert.ok(names.includes('map.json.stale-2026-10-07T12-00-00.000Z.json'), names.join(','));
    assert.ok(names.includes('verdicts.json.stale-2026-10-07T12-00-00.000Z.json'), names.join(','));
    const first = await writeInventory(dir, { run: (await intake(dir, '-', { stdin: 'fresh', now, slug: 'fresh' })).runId, input: JSON.stringify([power()]), now });
    assert.deepEqual(first.stale_moved, [], 'nothing to move on a first inventory');
  });

  it('cli: inventory --force prints stale_moved, and status --next is map afterwards', async () => {
    const cdir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-invr1cli-'));
    try {
      assert.equal(run(cdir, ['intake', '-', '--slug', 's1'], 'pasted').code, 0);
      const first = run(cdir, ['inventory', '--from', '-'], JSON.stringify([power()]));
      assert.equal(first.code, 0, first.err);
      const runs = await fs.readdir(path.join(cdir, '.claude', 'bbs', 'runs'));
      const runDir = path.join(cdir, '.claude', 'bbs', 'runs', runs[0]);
      await fs.writeFile(path.join(runDir, 'map.json'), JSON.stringify({ judgments: { 'drift-monitor': { rebuild: 'easy' } } }));
      await fs.writeFile(path.join(runDir, 'verdicts.json'), JSON.stringify({ decisions: { 'drift-monitor': 'use' } }));
      await fs.writeFile(path.join(runDir, 'handoff.json'), JSON.stringify({ marathonRun: 'x' }));
      assert.equal(run(cdir, ['status', '--next']).out.trim(), 'done');
      const forced = run(cdir, ['inventory', '--from', '-', '--force'], JSON.stringify([power()]));
      assert.equal(forced.code, 0, forced.err);
      assert.deepEqual(forced.json.stale_moved, ['map.json', 'verdicts.json', 'handoff.json']);
      const names = await fs.readdir(runDir);
      assert.ok(!names.includes('map.json'));
      assert.ok(names.some(n => /^map\.json\.stale-.*\.json$/.test(n)), names.join(','));
      assert.equal(run(cdir, ['status', '--next']).out.trim(), 'map');
    } finally {
      await fs.rm(cdir, { recursive: true, force: true });
    }
  });
});

describe('inventory — review r2 regressions', () => {
  let dir;
  function run(cwd, args, input) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', input });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-invr2-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const runDirOf = (p) => path.join(dir, '.claude', 'bbs', 'runs', p.runId);

  it('commit-then-fail: a corrupt map.json after powers.json is written gives a success result with a warning, not an error', async () => {
    const p = await intake(dir, '-', { stdin: 'cf', now, slug: 'cf' });
    await fs.writeFile(path.join(runDirOf(p), 'map.json'), '{ not json');
    const out = await writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now });
    assert.equal(out.found, 1);
    assert.equal(out.next, null);
    assert.match(out.warning, /powers\.json written but .* could not be read/);
    assert.ok((await readJson(path.join(runDirOf(p), 'powers.json'))).powers.length === 1);
  });

  it('cli: the same case exits 0, prints the JSON and a "bbs: warning:" line on stderr', async () => {
    const cdir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-invr2cf-'));
    try {
      assert.equal(run(cdir, ['intake', '-', '--slug', 'cf'], 'pasted').code, 0);
      const runs = await fs.readdir(path.join(cdir, '.claude', 'bbs', 'runs'));
      await fs.writeFile(path.join(cdir, '.claude', 'bbs', 'runs', runs[0], 'map.json'), '{ not json');
      const r = run(cdir, ['inventory', '--from', '-'], JSON.stringify([power()]));
      assert.equal(r.code, 0, r.err);
      assert.equal(r.json.next, null);
      assert.match(r.json.warning, /powers\.json written but/);
      assert.match(r.err, /bbs: warning: powers\.json written but/);
    } finally { await fs.rm(cdir, { recursive: true, force: true }); }
  });

  it('no hard links: an injected link that throws EPERM falls back to an exclusive create; the second call still gets the --force error', async () => {
    const p = await intake(dir, '-', { stdin: 'nl', now, slug: 'nl' });
    const link = async () => { const e = new Error('operation not permitted'); e.code = 'EPERM'; throw e; };
    const out = await writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now, link });
    assert.equal(out.found, 1);
    assert.equal((await readJson(path.join(runDirOf(p), 'powers.json'))).powers.length, 1);
    await assert.rejects(() => writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now, link }), /powers\.json exists — pass --force to replace it/);
    assert.deepEqual((await fs.readdir(runDirOf(p))).filter(n => n.endsWith('.tmp')), []);
  });

  it('--force failing partway: files already moved are put back and the error lists stale_moved and restored', async () => {
    const p = await intake(dir, '-', { stdin: 'pf', now, slug: 'pf' });
    const rd = runDirOf(p);
    await writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now });
    await fs.writeFile(path.join(rd, 'map.json'), '{"a":1}');
    await fs.writeFile(path.join(rd, 'verdicts.json'), '{"b":2}');
    const rename = async (from, to) => {
      if (path.basename(from) === 'verdicts.json') { const e = new Error('disk on fire'); e.code = 'EIO'; throw e; }
      return fs.rename(from, to);
    };
    await assert.rejects(
      () => writeInventory(dir, { run: p.runId, input: JSON.stringify([power({ name: 'new' })]), now, force: true, rename }),
      (err) => /stale_moved so far: \[.*map\.json.*\]/.test(err.message) && /restored: \[.*map\.json.*\]/.test(err.message)
    );
    const names = await fs.readdir(rd);
    assert.ok(names.includes('map.json'), 'map.json is back');
    assert.equal(await fs.readFile(path.join(rd, 'map.json'), 'utf-8'), '{"a":1}');
    assert.deepEqual(names.filter(n => n.includes('.stale-')), []);
    assert.equal((await readJson(path.join(rd, 'powers.json'))).powers[0].name, 'drift-monitor', 'old powers.json untouched');
  });

  it('--force never overwrites an existing stale name from the same timestamp', async () => {
    const p = await intake(dir, '-', { stdin: 'sn', now, slug: 'sn' });
    const rd = runDirOf(p);
    await writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now });
    const taken = path.join(rd, 'map.json.stale-2026-10-07T12-00-00.000Z.json');
    await fs.writeFile(taken, 'older');
    await fs.writeFile(path.join(rd, 'map.json'), 'newer');
    await writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now, force: true });
    assert.equal(await fs.readFile(taken, 'utf-8'), 'older');
    const others = (await fs.readdir(rd)).filter(n => /^map\.json\.stale-.*-[0-9a-f]{6}\.json$/.test(n));
    assert.equal(others.length, 1);
    assert.equal(await fs.readFile(path.join(rd, others[0]), 'utf-8'), 'newer');
  });

  it('an empty source root is an error naming the root (listSourceFiles and --brief)', async () => {
    const p = await intake(dir, '-', { stdin: 'em', now, slug: 'em' });
    const rd = runDirOf(p);
    await fs.rm(path.join(rd, 'fetched'), { recursive: true, force: true });
    await fs.mkdir(path.join(rd, 'fetched'));
    const src = await readJson(path.join(rd, 'source.json'));
    await assert.rejects(() => listSourceFiles(rd, src), /has no files — re-run fetch or intake/);
    await fs.writeFile(path.join(rd, 'fetched', '.env'), 'SECRET=1');
    await assert.rejects(() => listSourceFiles(rd, src), /only files were secret-like/);
    const cdir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-invr2em-'));
    try {
      assert.equal(run(cdir, ['intake', '-', '--slug', 'em'], 'pasted').code, 0);
      const runs = await fs.readdir(path.join(cdir, '.claude', 'bbs', 'runs'));
      const f = path.join(cdir, '.claude', 'bbs', 'runs', runs[0], 'fetched');
      await fs.rm(f, { recursive: true, force: true });
      await fs.mkdir(f);
      const b = run(cdir, ['inventory', '--brief']);
      assert.equal(b.code, 1);
      assert.match(b.err, /has no files — re-run fetch or intake/);
      assert.equal(b.out, '');
    } finally { await fs.rm(cdir, { recursive: true, force: true }); }
  });

  it('the walk skips build and vendor directories and does not count them', async () => {
    const root = path.join(dir, 'skiptool');
    for (const d of ['src', 'dist', 'vendor', 'target', '.venv', '__pycache__']) await fs.mkdir(path.join(root, d), { recursive: true });
    for (const f of ['src/a.js', 'dist/b.js', 'vendor/c.js', 'target/d.rs', '.venv/e.py', '__pycache__/f.pyc']) await fs.writeFile(path.join(root, f), 'x');
    const r = await intake(dir, root, { now, isGitRepo: () => false });
    const rd = path.join(dir, '.claude', 'bbs', 'runs', r.runId);
    const files = await listSourceFiles(rd, await readJson(path.join(rd, 'source.json')));
    assert.deepEqual(files.files.map(f => f.path), ['src/a.js']);
    assert.equal(files.total, 1);
    assert.ok(SKIP_DIRS.has('dist') && SKIP_DIRS.has('vendor') && SKIP_DIRS.has('.git'));
  });

  it('the walk keeps counting past maxFiles but stops collecting: total is full, files is capped and sorted', async () => {
    const root = path.join(dir, 'bigtool');
    await fs.mkdir(root, { recursive: true });
    for (let i = 0; i < 12; i++) await fs.writeFile(path.join(root, `f${String(i).padStart(2, '0')}.txt`), 'x');
    const r = await intake(dir, root, { now, isGitRepo: () => false });
    const rd = path.join(dir, '.claude', 'bbs', 'runs', r.runId);
    const files = await listSourceFiles(rd, await readJson(path.join(rd, 'source.json')), { maxFiles: 5 });
    assert.equal(files.total, 12);
    assert.equal(files.files.length, 5);
    assert.equal(files.truncated, true);
    const paths = files.files.map(f => f.path);
    assert.deepEqual(paths, [...paths].sort());
  });

  it('parseInventory names the input in the JSON-only error and escapes control characters', () => {
    assert.throws(() => parseInventory('Here are\u0007 the powers', { label: '--from x.json' }),
      (e) => /JSON only — --from x\.json is not JSON; got: "Here are\\u0007 the powers"/.test(e.message));
    assert.throws(() => parseInventory('prose'), /JSON only — input is not JSON; got: "prose"/);
  });

  it('cli: the JSON-only error says which input it came from', async () => {
    const cdir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-invr2js-'));
    try {
      assert.equal(run(cdir, ['intake', '-', '--slug', 'js'], 'pasted').code, 0);
      const f = path.join(cdir, 'bad.txt');
      await fs.writeFile(f, 'Here are the powers');
      const a = run(cdir, ['inventory', '--from', f]);
      assert.equal(a.code, 1);
      assert.ok(a.err.includes(`--from ${f} is not JSON`), a.err);
      const b = run(cdir, ['inventory', '--from', '-'], 'Here are the powers');
      assert.equal(b.code, 1);
      assert.match(b.err, /--from - \(stdin\) is not JSON/);
    } finally { await fs.rm(cdir, { recursive: true, force: true }); }
  });
});

describe('inventory — review r3 regressions', () => {
  let dir;
  function run(cwd, args, input) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf-8', input });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }
  before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-invr3-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const runDirOf = (p) => path.join(dir, '.claude', 'bbs', 'runs', p.runId);
  async function localRun(name, build) {
    const src = path.join(dir, name);
    await fs.mkdir(src, { recursive: true });
    await build(src);
    const r = await intake(dir, src, { now, isGitRepo: () => false, slug: name });
    const runDir = path.join(dir, '.claude', 'bbs', 'runs', r.runId);
    return { src, runDir, source: await readJson(path.join(runDir, 'source.json')) };
  }

  it('a non-UTF-8 file name is listed under errors as EILSEQ, counted in unlisted, never ENOENT, and left out of total', async () => {
    const s = await localRun('badname', async (src) => {
      await fs.writeFile(path.join(src, 'a.txt'), 'a');
      await fs.writeFile(path.join(src, 'b.txt'), 'bb');
    });
    const bad = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x2e, 0x74, 0x78, 0x74]); // caf\xe9.txt in latin1
    const lstatted = [];
    const readdir = async (d, o) => {
      const real = await fs.readdir(d, o);
      if (Buffer.from(d).toString() !== s.src) return real;
      return [...real, { name: bad, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true }];
    };
    const lstat = async (p) => { lstatted.push(p); return fs.lstat(p); };
    const files = await listSourceFiles(s.runDir, s.source, { readdir, lstat });
    assert.deepEqual(files.files.map(f => f.path), ['a.txt', 'b.txt']);
    assert.equal(files.total, 2);
    assert.equal(files.unlisted, 1);
    assert.equal(files.errors.length, 1);
    assert.equal(files.errors[0].code, 'EILSEQ');
    assert.match(files.errors[0].path, /caf\\xe9\.txt/);
    assert.match(files.errors[0].note, /non-UTF-8 file name/);
    assert.ok(!files.errors.some(e => e.code === 'ENOENT'));
    const brief = inventoryBrief({ source: s.source, files, maxPowers: 12 });
    assert.match(brief, /Could not read/);
    assert.match(brief, /caf\\xe9\.txt \(EILSEQ/);
  });

  it('a clean tree reports unlisted 0', async () => {
    const s = await localRun('cleanunl', async (src) => { await fs.writeFile(path.join(src, 'a.txt'), 'a'); });
    assert.equal((await listSourceFiles(s.runDir, s.source)).unlisted, 0);
  });

  it('SKIP_DIRS applies to directories only: a file named build is listed, a directory dist is skipped', async () => {
    const s = await localRun('skipfile', async (src) => {
      await fs.writeFile(path.join(src, 'build'), 'make');
      await fs.mkdir(path.join(src, 'dist'));
      await fs.writeFile(path.join(src, 'dist', 'out.js'), 'x');
      await fs.writeFile(path.join(src, 'vendor'), 'v');
    });
    const files = await listSourceFiles(s.runDir, s.source);
    assert.deepEqual(files.files.map(f => f.path), ['build', 'vendor']);
  });

  it('SKIP_DIRS match is case-insensitive on macOS/Windows and case-sensitive elsewhere', async () => {
    const s = await localRun('skipcase', async (src) => {
      await fs.writeFile(path.join(src, 'a.txt'), 'a');
      await fs.mkdir(path.join(src, 'Node_Modules'));
      await fs.writeFile(path.join(src, 'Node_Modules', 'x.js'), 'x');
    });
    const mac = await listSourceFiles(s.runDir, s.source, { platform: 'darwin' });
    assert.deepEqual(mac.files.map(f => f.path), ['a.txt']);
    const win = await listSourceFiles(s.runDir, s.source, { platform: 'win32' });
    assert.deepEqual(win.files.map(f => f.path), ['a.txt']);
    const linux = await listSourceFiles(s.runDir, s.source, { platform: 'linux' });
    assert.deepEqual(linux.files.map(f => f.path), ['Node_Modules/x.js', 'a.txt'].sort((x, y) => x.localeCompare(y)));
  });

  it('NFS lost reply: a link that succeeded but threw EEXIST counts as committed (nlink 2); a real existing file still gets the --force error', async () => {
    const p = await intake(dir, '-', { stdin: 'nfs', now, slug: 'nfs' });
    const link = async (a, b) => { await fs.link(a, b); const e = new Error('file exists'); e.code = 'EEXIST'; throw e; };
    const out = await writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now, link });
    assert.equal(out.found, 1);
    assert.equal((await readJson(path.join(runDirOf(p), 'powers.json'))).powers.length, 1);
    assert.deepEqual((await fs.readdir(runDirOf(p))).filter(n => n.endsWith('.tmp')), []);
    await assert.rejects(() => writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now }), /powers\.json exists — pass --force to replace it/);
    const eexist = async () => { const e = new Error('file exists'); e.code = 'EEXIST'; throw e; };
    await assert.rejects(() => writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now, link: eexist }), /powers\.json exists — pass --force to replace it/);
  });

  it('the hard-link path syncs the tmp file before linking', async () => {
    const p = await intake(dir, '-', { stdin: 'sync', now, slug: 'sync' });
    const events = [];
    const realOpen = fs.open;
    const mock = await import('node:test');
    const m = mock.mock.method(fs, 'open', async (...args) => {
      const h = await realOpen.apply(fs, args);
      const sync = h.sync.bind(h);
      h.sync = async () => { events.push('sync'); return sync(); };
      return h;
    });
    try {
      const link = async (a, b) => { events.push('link'); return fs.link(a, b); };
      await writeInventory(dir, { run: p.runId, input: JSON.stringify([power()]), now, link });
    } finally { m.mock.restore(); }
    assert.deepEqual(events, ['sync', 'link']);
  });

  it('an empty input names the input: parseInventory label, empty stdin, and an empty --from file', async () => {
    assert.throws(() => parseInventory('  ', { label: '--from x.json' }), /JSON only — --from x\.json is empty/);
    assert.throws(() => parseInventory('```json\n\n```'), /JSON only — input is empty/);
    const cdir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-invr3e-'));
    try {
      assert.equal(run(cdir, ['intake', '-', '--slug', 'em'], 'pasted').code, 0);
      const a = run(cdir, ['inventory', '--from', '-'], '');
      assert.equal(a.code, 1);
      assert.match(a.err, /--from - \(stdin\) is empty/);
      const f = path.join(cdir, 'empty.json');
      await fs.writeFile(f, '');
      const b = run(cdir, ['inventory', '--from', f]);
      assert.equal(b.code, 1);
      assert.ok(b.err.includes(`--from ${f} is empty`), b.err);
    } finally { await fs.rm(cdir, { recursive: true, force: true }); }
  });

  it('a name in a script with combining marks is accepted and stored NFC; a leading mark is still refused', () => {
    const p = validatePower(power({ name: 'हिन्दी' }), 0);
    assert.equal(p.name, 'हिन्दी'.normalize('NFC'));
    assert.equal(p.name, p.name.normalize('NFC'));
    assert.throws(() => validatePower(power({ name: '́abc' }), 0), /powers\[0\]\.name/);
    assert.match(inventoryBrief({ source: { type: 'local', ref: 'x', identity: 'i' }, files: { root: '/r', files: [], total: 0, errors: [] }, maxPowers: 12 }), /combining marks/);
  });
});
