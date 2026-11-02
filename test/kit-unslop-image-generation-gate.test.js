import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { run, verb, usage, idOf, checkAsset, cleanPrompt } from '../src/lib/kit/image-gate.js';

const CLI = fileURLToPath(new URL('../.claude/helpers/kit/cli.js', import.meta.url));
const cli = (args, cwd) => new Promise((resolve) => {
  execFile(process.execPath, [CLI, 'image-gate', ...args], { cwd, encoding: 'utf-8' }, (err, stdout, stderr) => {
    let json = null;
    try { json = JSON.parse(stdout); } catch {}
    resolve({ code: err ? err.code : 0, out: stdout, err: stderr, json });
  });
});

const exit = async (p, code = 1) => assert.rejects(Promise.resolve().then(p), (e) => e instanceof KitExit && e.code === code);

describe('image-gate', () => {
  let dir; let io;
  const g = (...a) => run(a, io);
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-gate-'));
    io = { cwd: dir, env: {} };
    await fs.writeFile(path.join(dir, 'p.txt'), 'A quiet harbour at dawn, flat colour, teal and sand\n');
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const req = (...extra) => g('request', '--state', 'st.json', '--prompt-file', 'p.txt', '--model', 'imagegen-1', '--size', '1024x768', ...extra);

  const chk = (id, ...extra) => g('check', '--state', 'st.json', '--prompt-file', 'p.txt', '--model', 'imagegen-1', '--size', '1024x768', ...(id ? ['--id', id] : []), ...extra);

  it('exports the verb and usage', () => {
    assert.equal(verb, 'image-gate');
    assert.match(usage, /image-gate/);
  });

  it('request records a pending request with a stable id and one question', async () => {
    const r = await req('--service', 'a text-to-image API', '--asset', 'assets/hero.webp', '--est-cost', 'about 4 cents');
    assert.equal(r.status, 'pending');
    assert.equal(r.id, idOf('A quiet harbour at dawn, flat colour, teal and sand', 'imagegen-1', '1024x768', 'a text-to-image API', 'about 4 cents', 'assets/hero.webp'));
    assert.deepEqual(r.show, { prompt: 'A quiet harbour at dawn, flat colour, teal and sand', model: 'imagegen-1', size: '1024x768', service: 'a text-to-image API', asset: 'assets/hero.webp', est_cost: 'about 4 cents' });
    assert.match(r.question, /\nPrompt \(1 line, each starting with "\| "\):\n\| A quiet harbour at dawn, flat colour, teal and sand\n\(end of prompt\)\n/);
    assert.match(r.question, /imagegen-1/);
    assert.match(r.question, /1024x768/);
    assert.match(r.question, /about 4 cents/);
    assert.match(r.question, /assets\/hero\.webp/);
    assert.match(r.question, /Yes or no\?$/);
    const again = await req('--service', 'a text-to-image API', '--asset', 'assets/hero.webp', '--est-cost', 'about 4 cents');
    assert.equal(again.id, r.id);
    assert.equal(again.status, 'pending');
    assert.equal((await g('status', '--state', 'st.json')).count, 1);
  });

  it('defaults the asset to assets/generated/<id>.png and est_cost to null', async () => {
    const r = await req();
    assert.equal(r.show.asset, `assets/generated/${idOf('A quiet harbour at dawn, flat colour, teal and sand', 'imagegen-1', '1024x768', 'any connected image-generation tool', null, '')}.png`);
    assert.equal(r.id, idOf('A quiet harbour at dawn, flat colour, teal and sand', 'imagegen-1', '1024x768', 'any connected image-generation tool', null, r.show.asset));
    assert.equal(r.show.est_cost, null);
    assert.match(r.question, /may cost money/);
  });

  it('different prompt, model or size gives a different id', async () => {
    const a = await req();
    await fs.writeFile(path.join(dir, 'q.txt'), 'A different harbour');
    const b = await g('request', '--state', 'st.json', '--prompt-file', 'q.txt', '--model', 'imagegen-1', '--size', '1024x768');
    const c = await g('request', '--state', 'st.json', '--prompt-file', 'p.txt', '--model', 'imagegen-2', '--size', '1024x768');
    assert.equal(new Set([a.id, b.id, c.id]).size, 3);
  });

  it('check blocks until approved, then passes; used consumes it', async () => {
    const { id } = await req();
    const pending = await chk(id);
    assert.equal(pending.exit, 2);
    assert.equal(pending.approved, false);
    assert.equal(pending.status, 'pending');
    const ap = await g('approve', '--state', 'st.json', '--id', id);
    assert.equal(ap.status, 'approved');
    assert.ok(ap.at);
    const ok = await chk(id);
    assert.equal(ok.exit, undefined);
    assert.equal(ok.approved, true);
    assert.equal(ok.show.model, 'imagegen-1');
    const used = await g('used', '--state', 'st.json', '--id', id);
    assert.equal(used.status, 'used');
    const after = await chk(id);
    assert.equal(after.exit, 2);
    assert.equal(after.status, 'used');
    assert.equal(after.approved, false);
  });

  it('a used id returns reroll: true with a warning on request', async () => {
    const { id } = await req();
    await g('approve', '--state', 'st.json', '--id', id);
    await g('used', '--state', 'st.json', '--id', id);
    const again = await req();
    assert.equal(again.reroll, true);
    assert.equal(again.status, 'used');
    assert.match(again.warning, /change the prompt/);
    assert.equal(again.question, null);
  });

  it('decline blocks check and shows in report; slot is empty', async () => {
    const { id } = await req('--asset', 'assets/hero.png');
    const d = await g('decline', '--state', 'st.json', '--id', id);
    assert.equal(d.status, 'declined');
    const c = await chk(id, '--asset', 'assets/hero.png');
    assert.deepEqual([c.exit, c.status, c.approved], [2, 'declined', false]);
    const rep = await g('report', '--state', 'st.json');
    assert.equal(rep.count, 1);
    assert.equal(rep.requests[0].prompt, 'A quiet harbour at dawn, flat colour, teal and sand');
    assert.equal(rep.requests[0].save_as, 'assets/hero.png');
    const again = await req('--asset', 'assets/hero.png');
    assert.equal(again.status, 'declined');
  });

  it('only a pending request can change (exit 2); used needs approved', async () => {
    const { id } = await req();
    await exit(() => g('used', '--state', 'st.json', '--id', id), 2);
    await g('approve', '--state', 'st.json', '--id', id);
    await exit(() => g('approve', '--state', 'st.json', '--id', id), 2);
    await exit(() => g('decline', '--state', 'st.json', '--id', id), 2);
    await g('used', '--state', 'st.json', '--id', id);
    await exit(() => g('used', '--state', 'st.json', '--id', id), 2);
    await exit(() => g('approve', '--state', 'st.json', '--id', id), 2);
  });

  it('unknown id: check exits 2 with status unknown, state changes exit 1; missing state is unknown too', async () => {
    const c = await g('check', '--state', 'none.json', '--prompt-file', 'p.txt', '--model', 'm', '--size', '10x10');
    assert.deepEqual([c.exit, c.status], [2, 'unknown']);
    await req();
    await exit(() => g('approve', '--state', 'st.json', '--id', 'abcdef012345'));
    await exit(() => g('decline', '--state', 'st.json', '--id', 'abcdef012345'));
    await exit(() => g('used', '--state', 'st.json', '--id', 'abcdef012345'));
    await exit(() => chk('nope'));
  });

  it('report lists pending and declined only; status lists all', async () => {
    const a = await req();
    await fs.writeFile(path.join(dir, 'q.txt'), 'second');
    const b = await g('request', '--state', 'st.json', '--prompt-file', 'q.txt', '--model', 'm', '--size', '64x64');
    await g('approve', '--state', 'st.json', '--id', b.id);
    assert.deepEqual((await g('report', '--state', 'st.json')).requests.map((r) => r.id), [a.id]);
    assert.equal((await g('status', '--state', 'st.json')).count, 2);
    assert.equal((await g('report', '--state', 'empty.json')).count, 0);
    assert.equal((await g('status', '--state', 'empty.json')).count, 0);
  });

  it('slot gives an empty aria-hidden box of exact size and radius', async () => {
    const s = await g('slot', '--width', '640', '--height', '360', '--radius', '12');
    assert.match(s.html, /aria-hidden="true"/);
    assert.doesNotMatch(s.html, />[^<]+</);
    assert.match(s.css, /width:640px/);
    assert.match(s.css, /height:360px/);
    assert.match(s.css, /border-radius:12px/);
    assert.match(s.report_note, /prompt/);
    assert.match(s.report_note, /report/);
    assert.match((await g('slot', '--width', '10', '--height', '10')).css, /border-radius:0px/);
    assert.match((await g('slot', '--width', '10', '--height', '10', '--radius', '2.5')).css, /border-radius:2.5px/);
  });

  it('slot rejects bad numbers', async () => {
    for (const a of [['--width', '0', '--height', '5'], ['--width', 'x', '--height', '5'], ['--width', '5', '--height', '-1'], ['--width', '5', '--height', '99999'],
      ['--width', '5', '--height', '5', '--radius', '-3'], ['--width', '5', '--height', '5', '--radius', 'big'], ['--width', '5', '--height', '5', '--radius', '5000'], ['--width', '5']]) {
      await exit(() => g('slot', ...a));
    }
  });

  it('refuses unsafe asset locations', async () => {
    for (const a of ['/etc/x.png', '../x.png', 'a/../../x.png', 'https://cdn.example.com/x.png', 'C:\\x.png', 'tmp/x.png', 'assets/tmp/x.png', '/tmp/x.png', 'var/tmp/x.png', '~/x.png', 'assets\\x.png', '//host/x.png', 'assets/x.txt', 'assets/', 'assets//x.png', 'data:image/png;base64,AAA']) {
      await exit(() => req('--asset', a));
      assert.throws(() => checkAsset(a), KitExit);
    }
    assert.equal(checkAsset('./assets/hero.PNG'), 'assets/hero.PNG');
    await assert.rejects(fs.stat(path.join(dir, 'st.json')));
  });

  it('rejects bad input', async () => {
    await exit(() => g());
    await exit(() => g('bogus'));
    await exit(() => g('request', '--state', 'st.json', '--prompt-file', 'p.txt', '--model', 'm'));
    await exit(() => req('--bogus', 'x'));
    await exit(() => req('--model', 'again'));
    await exit(() => req('--service'));
    await exit(() => g('request', '--state', 'st.json', '--prompt-file', 'p.txt', '--model', 'm', '--size', '10by10'));
    await exit(() => g('request', '--state', 'st.json', '--prompt-file', 'p.txt', '--model', 'm', '--size', '0x10'));
    await exit(() => g('request', '--state', 'st.json', '--prompt-file', 'missing.txt', '--model', 'm', '--size', '10x10'));
    await exit(() => g('request', '--state', 'st.json', '--prompt-file', '', '--model', 'm', '--size', '10x10'));
    await exit(() => g('request', '--state', 'st.json', '--prompt-file', '.', '--model', 'm', '--size', '10x10'));
    await exit(() => g('request', '--state', 'st.json', '--prompt-file', 'p.txt', '--model', 'm\nx', '--size', '10x10'));
    await exit(() => g('status', 'extra'));
    await exit(() => g('check', '--state', 'st.json'));
    await exit(() => g('check', '--state', 'st.json', '--id', 'abcdef012345'));
  });

  it('rejects an empty, binary or oversize prompt file', async () => {
    const r = (f) => g('request', '--state', 'st.json', '--prompt-file', f, '--model', 'm', '--size', '10x10');
    await fs.writeFile(path.join(dir, 'e.txt'), '  \n');
    await fs.writeFile(path.join(dir, 'b.txt'), Buffer.from([65, 0, 66]));
    await fs.writeFile(path.join(dir, 'big.txt'), Buffer.alloc(8 * 1024 * 1024 + 1, 97));
    await fs.writeFile(path.join(dir, 'long.txt'), 'a'.repeat(20001));
    for (const f of ['e.txt', 'b.txt', 'big.txt', 'long.txt']) await exit(() => r(f));
  });

  const chk2 = (state) => g('check', '--state', state, '--prompt-file', 'p.txt', '--model', 'imagegen-1', '--size', '1024x768');

  it('a corrupt or foreign state is exit 1', async () => {
    await fs.writeFile(path.join(dir, 'bad.json'), '{nope');
    await exit(() => g('status', '--state', 'bad.json'));
    await fs.writeFile(path.join(dir, 'v.json'), JSON.stringify({ version: 2, requests: {} }));
    await exit(() => g('status', '--state', 'v.json'));
    await fs.writeFile(path.join(dir, 'r.json'), JSON.stringify({ version: 1, requests: { a: { id: 'a', status: 'weird' } } }));
    await exit(() => chk2('r.json'));
  });

  it('parallel requests all keep their writes and leave no temp files', async () => {
    const n = 8;
    await Promise.all(Array.from({ length: n }, async (_, i) => {
      await fs.writeFile(path.join(dir, `p${i}.txt`), `prompt ${i}`);
      return g('request', '--state', 'st.json', '--prompt-file', `p${i}.txt`, '--model', 'm', '--size', '64x64');
    }));
    assert.equal((await g('status', '--state', 'st.json')).count, n);
    assert.deepEqual((await fs.readdir(dir)).filter((f) => f.includes('.tmp') || f.endsWith('.lock')), []);
  });

  it('check recomputes the id: a changed prompt, model, size, service, cost or asset exits 2 and no --id is needed', async () => {
    const { id } = await req('--service', 's1', '--est-cost', '$1', '--asset', 'assets/a.png');
    await g('approve', '--state', 'st.json', '--id', id);
    const same = ['--service', 's1', '--est-cost', '$1', '--asset', 'assets/a.png'];
    const ok = await chk(null, ...same);
    assert.equal(ok.exit, undefined);
    assert.equal(ok.approved, true);
    assert.equal(ok.id, id);
    assert.equal((await g('release', '--state', 'st.json', '--id', id)).status, 'approved');
    assert.equal((await chk(id, ...same)).approved, true);
    for (const other of [['--service', 's2', '--est-cost', '$1', '--asset', 'assets/a.png'], ['--service', 's1', '--est-cost', '$5', '--asset', 'assets/a.png'],
      ['--service', 's1', '--est-cost', '$1', '--asset', 'assets/b.png'], ['--service', 's1', '--asset', 'assets/a.png'], []]) {
      const c = await chk(null, ...other);
      assert.deepEqual([c.exit, c.approved, c.status], [2, false, 'unknown']);
    }
    const c = await g('check', '--state', 'st.json', '--prompt-file', 'p.txt', '--model', 'imagegen-2', '--size', '1024x768', '--service', 's1', '--est-cost', '$1', '--asset', 'assets/a.png');
    assert.deepEqual([c.exit, c.approved], [2, false]);
    const sz = await g('check', '--state', 'st.json', '--prompt-file', 'p.txt', '--model', 'imagegen-1', '--size', '512x512', '--service', 's1', '--est-cost', '$1', '--asset', 'assets/a.png');
    assert.equal(sz.exit, 2);
    const wrongId = await chk(id, '--service', 's2');
    assert.deepEqual([wrongId.exit, wrongId.status], [2, 'mismatch']);
  });

  it('check exits 2 when the prompt file was edited after approval', async () => {
    const { id } = await req();
    await g('approve', '--state', 'st.json', '--id', id);
    assert.equal((await chk(id)).approved, true);
    await fs.writeFile(path.join(dir, 'p.txt'), 'A loud neon city, glossy 3D');
    const c = await chk(id);
    assert.deepEqual([c.exit, c.approved], [2, false]);
    assert.match(c.next, /Do not call the image tool/);
  });

  it('request with a different service, cost or asset is a new pending request, not the old approval', async () => {
    const a = await req('--service', 'cheap', '--est-cost', '$0.01');
    await g('approve', '--state', 'st.json', '--id', a.id);
    const b = await req('--service', 'pricey', '--est-cost', '$5', '--asset', 'img/hero.png');
    assert.notEqual(b.id, a.id);
    assert.equal(b.status, 'pending');
    assert.match(b.question, /pricey/);
    assert.equal(b.show.asset, 'img/hero.png');
    assert.equal((await chk(null, '--service', 'pricey', '--est-cost', '$5', '--asset', 'img/hero.png')).exit, 2);
    assert.equal((await chk(null, '--service', 'cheap', '--est-cost', '$0.01')).approved, true);
    const c = await req('--service', 'cheap', '--est-cost', '$0.01', '--asset', 'img/other.png');
    assert.equal(c.status, 'pending');
    assert.notEqual(c.id, a.id);
  });

  it('validateState recomputes ids and requires answered_at', async () => {
    const { id } = await req();
    await g('approve', '--state', 'st.json', '--id', id);
    const good = JSON.parse(await fs.readFile(path.join(dir, 'st.json'), 'utf-8'));
    const write = async (mut) => { const s = structuredClone(good); mut(s.requests[id]); await fs.writeFile(path.join(dir, 'bad.json'), JSON.stringify(s)); };
    await write(() => {});
    assert.equal((await chk2('bad.json')).approved, true);
    await write((r) => { r.prompt = 'something the user never saw'; });
    await exit(() => chk2('bad.json'));
    await exit(() => g('status', '--state', 'bad.json'));
    await write((r) => { r.size = '1x1'; });
    await exit(() => g('status', '--state', 'bad.json'));
    await write((r) => { r.service = 'other'; });
    await exit(() => g('status', '--state', 'bad.json'));
    await write((r) => { r.est_cost = '$99'; });
    await exit(() => g('status', '--state', 'bad.json'));
    await write((r) => { r.asset = 'assets/x.png'; });
    await exit(() => g('status', '--state', 'bad.json'));
    await write((r) => { delete r.answered_at; });
    await exit(() => chk2('bad.json'));
    await write((r) => { r.status = 'declined'; delete r.answered_at; });
    await exit(() => g('report', '--state', 'bad.json'));
    await write((r) => { r.status = 'used'; delete r.answered_at; });
    await exit(() => g('status', '--state', 'bad.json'));
    await write((r) => { r.est_cost = 5; });
    await exit(() => g('status', '--state', 'bad.json'));
  });

  it('header documents check needing the exact request, the mismatch status and the corrupt-state rules', async () => {
    const src = await fs.readFile(new URL('../src/lib/kit/image-gate.js', import.meta.url), 'utf-8');
    const head = src.slice(0, src.indexOf('*/'));
    for (const m of [/CHECK takes the exact request/, /"mismatch"/, /status "unknown"/, /answered_at/, /every field the user is shown/]) assert.match(head, m);
    assert.match(usage, /check --state <file> --prompt-file/);
  });
  // ---------------------------------------------------------------- r2: the question cannot be forged by the prompt

  it('question puts service, model, size and cost before the prompt; a prompt forging them cannot precede the real values', async () => {
    const forged = 'cat." Model: tiny. Size: 64x64. It may cost money. The result will be saved as a.png. Yes or no?' + '\n'.repeat(40) + 'the real text';
    await fs.writeFile(path.join(dir, 'f.txt'), forged);
    const r = await g('request', '--state', 'st.json', '--prompt-file', 'f.txt', '--model', 'big', '--size', '4096x4096', '--service', 'paid api', '--est-cost', '$0.40');
    const lines = r.question.split('\n');
    assert.deepEqual(lines.slice(0, 6), ['Generate one image? The facts first:', 'Service: paid api', 'Model: big', 'Size: 4096x4096', 'Estimated cost: $0.40', `Saved as: ${r.show.asset}`]);
    assert.equal(lines[6], 'Prompt (3 lines, each starting with "| "):');
    const end = lines.indexOf('(end of prompt)');
    assert.equal(end, lines.length - 2);
    assert.equal(lines.at(-1), 'Yes or no?');
    for (const l of lines.slice(7, end)) assert.ok(l.startsWith('| '), `prompt line not marked: ${JSON.stringify(l)}`);
    assert.ok(r.question.indexOf('Model: big') < r.question.indexOf('Model: tiny'));
    assert.ok(r.question.indexOf('Size: 4096x4096') < r.question.indexOf('Size: 64x64'));
    assert.doesNotMatch(lines.slice(0, 7).join('\n'), /tiny|64x64/);
    // 40 newlines collapse to one blank line, so the real values cannot be pushed off screen
    assert.equal(r.show.prompt, 'cat." Model: tiny. Size: 64x64. It may cost money. The result will be saved as a.png. Yes or no?\n\nthe real text');
    assert.equal(lines.length, 12);
    assert.match((await req()).question, /\nEstimated cost: not known; it may cost money\n/);
  });

  it('refuses control, ANSI, bidi and zero-width characters in the prompt and the one-line fields (exit 1)', async () => {
    const badPrompts = ['x\x1b[2Khidden', 'x\x1b]0;t\x07', 'bell\x07', 'del\x7f', 'c1\x85', 'csi\x9b2K', 'rtl\u202ehidden', 'iso\u2066x\u2069', 'zw\u200bsp', 'zwj\u200d', 'wj\u2060', 'shy\u00ad', 'ls\u2028x', 'ps\u2029x', 'mid\ufeffbom', 'vt\x0bx', 'ff\x0cx', 'lrm\u200e'];
    for (const [i, t] of badPrompts.entries()) {
      await fs.writeFile(path.join(dir, `c${i}.txt`), t);
      await exit(() => g('request', '--state', 'st.json', '--prompt-file', `c${i}.txt`, '--model', 'm', '--size', '10x10'));
      assert.throws(() => cleanPrompt(t), KitExit);
    }
    await assert.rejects(fs.stat(path.join(dir, 'st.json')));
    await fs.writeFile(path.join(dir, 'ok.txt'), '\ufeffline one\twith tab\r\nline two   \r\n\r\n\r\n\r\nline three\n');
    const ok = await g('request', '--state', 'st.json', '--prompt-file', 'ok.txt', '--model', 'm', '--size', '10x10');
    assert.equal(ok.show.prompt, 'line one\twith tab\nline two\n\nline three');
    for (const [k, v] of [['--model', 'm\u202e'], ['--service', 's\x1b[2K'], ['--est-cost', '$1\u200b'], ['--est-cost', '$1\x9b'], ['--asset', 'assets/a\u202egnp.png'], ['--asset', 'assets/a\x85.png']]) {
      const flags = { '--model': 'm', '--size': '10x10', [k]: v };
      await exit(() => g('request', '--state', 'st.json', '--prompt-file', 'p.txt', ...Object.entries(flags).flat()));
    }
  });

  it('caps the prompt at 4000 characters after blank lines collapse', async () => {
    const r = (f) => g('request', '--state', 'st.json', '--prompt-file', f, '--model', 'm', '--size', '10x10');
    await fs.writeFile(path.join(dir, 'c4000.txt'), 'a'.repeat(4000));
    await fs.writeFile(path.join(dir, 'c4001.txt'), 'a'.repeat(4001));
    await fs.writeFile(path.join(dir, 'cpad.txt'), 'a'.repeat(1990) + '   \n'.repeat(500) + 'b'.repeat(2008));
    assert.equal((await r('c4000.txt')).show.prompt.length, 4000);
    await exit(() => r('c4001.txt'));
    assert.equal((await r('cpad.txt')).show.prompt.length, 4000);
  });

  it('prompt scan stays linear at the 8 MiB cap (blank runs, long space runs, a late control char)', async () => {
    const MB8 = 8 * 1024 * 1024;
    const shapes = { 'w1.txt': ' \n'.repeat(MB8 / 2), 'w2.txt': (' '.repeat(1023) + 'x').repeat(MB8 / 1024), 'w3.txt': 'a'.repeat(MB8 - 1) + '\x1b' };
    for (const [f, body] of Object.entries(shapes)) {
      await fs.writeFile(path.join(dir, f), body);
      const t = Date.now();
      await exit(() => g('request', '--state', 'st.json', '--prompt-file', f, '--model', 'm', '--size', '10x10'));
      assert.ok(Date.now() - t < 4000, `${f} took ${Date.now() - t} ms`);
    }
  });

  // ---------------------------------------------------------------- r2: approval is single-use at the gate

  it('check claims the approval: a second check (or claim) without a new yes exits 2 with status claimed', async () => {
    const { id } = await req();
    await g('approve', '--state', 'st.json', '--id', id);
    const first = await chk(id);
    assert.deepEqual([first.exit, first.approved, first.status], [undefined, true, 'claimed']);
    assert.ok(first.claimed_at);
    assert.match(first.next, /release/);
    const second = await chk(id);
    assert.deepEqual([second.exit, second.approved, second.status], [2, false, 'claimed']);
    assert.match(second.next, /Do not call the image tool/);
    const alias = await g('claim', '--state', 'st.json', '--prompt-file', 'p.txt', '--model', 'imagegen-1', '--size', '1024x768');
    assert.deepEqual([alias.exit, alias.status], [2, 'claimed']);
    const again = await req();
    assert.deepEqual([again.status, again.question], ['claimed', null]);
    assert.match(again.next, /release/);
    const rep = await g('report', '--state', 'st.json');
    assert.deepEqual(rep.requests.map((r) => [r.id, r.status]), [[id, 'claimed']]);
    assert.match(rep.requests[0].note, /never marked used or released/);
    assert.equal((await g('used', '--state', 'st.json', '--id', id)).status, 'used');
    assert.equal((await chk(id)).status, 'used');
  });

  it('claim works as check: exit 0 once for an approved request', async () => {
    const { id } = await req();
    await g('approve', '--state', 'st.json', '--id', id);
    const c = await g('claim', '--state', 'st.json', '--prompt-file', 'p.txt', '--model', 'imagegen-1', '--size', '1024x768', '--id', id);
    assert.deepEqual([c.exit, c.approved, c.status], [undefined, true, 'claimed']);
  });

  it('parallel checks in one process: exactly one claims the approval', async () => {
    const { id } = await req();
    await g('approve', '--state', 'st.json', '--id', id);
    const rs = await Promise.all(Array.from({ length: 8 }, () => chk(id)));
    assert.equal(rs.filter((r) => r.approved === true && r.exit === undefined).length, 1);
    assert.equal(rs.filter((r) => r.exit === 2 && r.status === 'claimed').length, 7);
  });

  it('parallel checks through the real CLI: exactly one process exits 0', async () => {
    const { id } = await req();
    await g('approve', '--state', 'st.json', '--id', id);
    const args = ['check', '--state', 'st.json', '--prompt-file', 'p.txt', '--model', 'imagegen-1', '--size', '1024x768', '--id', id];
    const rs = await Promise.all(Array.from({ length: 6 }, () => cli(args, dir)));
    assert.deepEqual(rs.map((r) => r.code).sort(), [0, 2, 2, 2, 2, 2]);
    assert.equal(rs.find((r) => r.code === 0).json.status, 'claimed');
    for (const r of rs.filter((x) => x.code === 2)) assert.equal(r.json.status, 'claimed');
  });

  it('release returns a claimed approval to approved exactly once, recorded', async () => {
    const { id } = await req();
    await exit(() => g('release', '--state', 'st.json', '--id', id), 2);
    await g('approve', '--state', 'st.json', '--id', id);
    await exit(() => g('release', '--state', 'st.json', '--id', id), 2);
    assert.equal((await chk(id)).status, 'claimed');
    const rel = await g('release', '--state', 'st.json', '--id', id);
    assert.equal(rel.status, 'approved');
    assert.match(rel.next, /A second failure needs a new request/);
    const st1 = (await g('status', '--state', 'st.json')).requests[0];
    assert.equal(st1.status, 'approved');
    assert.equal(st1.released_at, rel.at);
    assert.ok(st1.claimed_at);
    const again = await chk(id);
    assert.deepEqual([again.exit, again.status], [undefined, 'claimed']);
    await exit(() => g('release', '--state', 'st.json', '--id', id), 2);
    assert.equal((await chk(id)).exit, 2);
    assert.equal((await g('status', '--state', 'st.json')).requests[0].released_at, rel.at);
    assert.equal((await g('used', '--state', 'st.json', '--id', id)).status, 'used');
    await exit(() => g('release', '--state', 'st.json', '--id', id), 2);
    await exit(() => g('release', '--state', 'st.json', '--id', 'abcdef012345'));
    await exit(() => g('release', '--state', 'st.json', '--id', 'nope'));
    await exit(() => g('release', '--state', 'st.json'));
  });

  it('a claimed record without claimed_at, or a non-string released_at, is a corrupt state', async () => {
    const { id } = await req();
    await g('approve', '--state', 'st.json', '--id', id);
    await chk(id);
    const good = JSON.parse(await fs.readFile(path.join(dir, 'st.json'), 'utf-8'));
    const write = async (mut) => { const s = structuredClone(good); mut(s.requests[id]); await fs.writeFile(path.join(dir, 'bad.json'), JSON.stringify(s)); };
    await write(() => {});
    assert.equal((await g('status', '--state', 'bad.json')).requests[0].status, 'claimed');
    await write((r) => { delete r.claimed_at; });
    await exit(() => g('status', '--state', 'bad.json'));
    await write((r) => { r.released_at = 5; });
    await exit(() => g('status', '--state', 'bad.json'));
    await write((r) => { delete r.answered_at; });
    await exit(() => g('status', '--state', 'bad.json'));
  });

  it('header and usage document single-use check, claim, release, the prompt rules and every exit code', async () => {
    const src = await fs.readFile(new URL('../src/lib/kit/image-gate.js', import.meta.url), 'utf-8');
    const head = src.slice(0, src.indexOf('*/'));
    for (const m of [/image-gate claim/, /image-gate release --state <file> --id <id>/, /SINGLE-USE/, /status: "claimed"/, /claimed_at/, /released_at/,
      /works once per request/, /4000 characters/, /bidi/, /zero-width/, /ANSI/, /runs of blank lines collapse/, /facts FIRST/, /"\| "/, /\(end of prompt\)/,
      /Exit codes: 0 /, /1 bad input or broken state/, /2 only from check/, /release\)/, /pending, claimed \(checked but never marked used or released\) or declined/]) assert.match(head, m);
    assert.match(usage, /claim/);
    assert.match(usage, /release/);
    assert.match(usage, /single-use/);
  });
});
