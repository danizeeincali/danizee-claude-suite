import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import { run, verb, usage, idOf, checkAsset } from '../src/lib/kit/image-gate.js';

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
    assert.match(r.question, /Prompt: "A quiet harbour/);
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
});
