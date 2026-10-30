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

  it('exports the verb and usage', () => {
    assert.equal(verb, 'image-gate');
    assert.match(usage, /image-gate/);
  });

  it('request records a pending request with a stable id and one question', async () => {
    const r = await req('--service', 'a text-to-image API', '--asset', 'assets/hero.webp', '--est-cost', 'about 4 cents');
    assert.equal(r.status, 'pending');
    assert.equal(r.id, idOf('A quiet harbour at dawn, flat colour, teal and sand', 'imagegen-1', '1024x768'));
    assert.deepEqual(r.show, { prompt: 'A quiet harbour at dawn, flat colour, teal and sand', model: 'imagegen-1', size: '1024x768', service: 'a text-to-image API', asset: 'assets/hero.webp', est_cost: 'about 4 cents' });
    assert.match(r.question, /Prompt: "A quiet harbour/);
    assert.match(r.question, /imagegen-1/);
    assert.match(r.question, /1024x768/);
    assert.match(r.question, /about 4 cents/);
    assert.match(r.question, /assets\/hero\.webp/);
    assert.match(r.question, /Yes or no\?$/);
    const again = await req('--service', 'a text-to-image API', '--asset', 'assets/hero.webp');
    assert.equal(again.id, r.id);
    assert.equal(again.status, 'pending');
    assert.equal((await g('status', '--state', 'st.json')).count, 1);
  });

  it('defaults the asset to assets/generated/<id>.png and est_cost to null', async () => {
    const r = await req();
    assert.equal(r.show.asset, `assets/generated/${r.id}.png`);
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
    const pending = await g('check', '--state', 'st.json', '--id', id);
    assert.equal(pending.exit, 2);
    assert.equal(pending.approved, false);
    assert.equal(pending.status, 'pending');
    const ap = await g('approve', '--state', 'st.json', '--id', id);
    assert.equal(ap.status, 'approved');
    assert.ok(ap.at);
    const ok = await g('check', '--state', 'st.json', '--id', id);
    assert.equal(ok.exit, undefined);
    assert.equal(ok.approved, true);
    assert.equal(ok.show.model, 'imagegen-1');
    const used = await g('used', '--state', 'st.json', '--id', id);
    assert.equal(used.status, 'used');
    const after = await g('check', '--state', 'st.json', '--id', id);
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
    const c = await g('check', '--state', 'st.json', '--id', id);
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
    const c = await g('check', '--state', 'none.json', '--id', 'abcdef012345');
    assert.deepEqual([c.exit, c.status], [2, 'unknown']);
    await req();
    await exit(() => g('approve', '--state', 'st.json', '--id', 'abcdef012345'));
    await exit(() => g('decline', '--state', 'st.json', '--id', 'abcdef012345'));
    await exit(() => g('used', '--state', 'st.json', '--id', 'abcdef012345'));
    await exit(() => g('check', '--state', 'st.json', '--id', 'nope'));
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
  });

  it('rejects an empty, binary or oversize prompt file', async () => {
    const r = (f) => g('request', '--state', 'st.json', '--prompt-file', f, '--model', 'm', '--size', '10x10');
    await fs.writeFile(path.join(dir, 'e.txt'), '  \n');
    await fs.writeFile(path.join(dir, 'b.txt'), Buffer.from([65, 0, 66]));
    await fs.writeFile(path.join(dir, 'big.txt'), Buffer.alloc(8 * 1024 * 1024 + 1, 97));
    await fs.writeFile(path.join(dir, 'long.txt'), 'a'.repeat(20001));
    for (const f of ['e.txt', 'b.txt', 'big.txt', 'long.txt']) await exit(() => r(f));
  });

  it('a corrupt or foreign state is exit 1', async () => {
    await fs.writeFile(path.join(dir, 'bad.json'), '{nope');
    await exit(() => g('status', '--state', 'bad.json'));
    await fs.writeFile(path.join(dir, 'v.json'), JSON.stringify({ version: 2, requests: {} }));
    await exit(() => g('status', '--state', 'v.json'));
    await fs.writeFile(path.join(dir, 'r.json'), JSON.stringify({ version: 1, requests: { a: { id: 'a', status: 'weird' } } }));
    await exit(() => g('check', '--state', 'r.json', '--id', 'abcdef012345'));
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
});
