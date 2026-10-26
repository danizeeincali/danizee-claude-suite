import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { KitExit } from '../src/lib/kit/kit-exit.js';
import * as mp from '../src/lib/kit/motion-plan.js';

const { plan, decideMode, run, verb } = mp;
const exit = (fn, code = 1) => assert.throws(fn, e => e instanceof KitExit && e.code === code);
const io = (stdin, cwd) => ({ cwd, stdinBytes: async () => Buffer.from(stdin, 'utf-8'), stdinIsTTY: false, env: {} });
const ioNoStdin = cwd => ({ cwd, stdin: async () => { throw new Error('stdin must not be read'); }, stdinBytes: async () => { throw new Error('stdin must not be read'); }, stdinIsTTY: false, env: {} });
const base = (o = {}) => ({ request: 'animate this', has_site_codebase: false, sections: [], ...o });

describe('mode rules in priority order', () => {
  it('explicit mode wins over everything', () => {
    const r = plan(base({ mode: 'showcase', has_site_codebase: true, request: 'our page section' }));
    assert.equal(r.mode, 'showcase');
    assert.equal(r.assumed, false);
    assert.equal(r.plays, 'loop-from-empty');
    assert.match(r.why, /explicit/i);
    assert.equal(plan(base({ mode: 'website', request: 'a looping reel' })).plays, 'once-on-scroll');
  });
  it('a site codebase means website', () => {
    const r = plan(base({ has_site_codebase: true, request: 'make a demo video' }));
    assert.equal(r.mode, 'website');
    assert.equal(r.assumed, false);
    assert.equal(r.plays, 'once-on-scroll');
    assert.match(r.why, /codebase/i);
  });
  it('website words decide next', () => {
    for (const w of ['page', 'site', 'section', 'scroll']) {
      const r = plan(base({ request: `animate the ${w} please` }));
      assert.equal(r.mode, 'website', w);
      assert.equal(r.assumed, false);
      assert.match(r.why, new RegExp(w));
    }
  });
  it('showcase words decide after that', () => {
    for (const w of ['loop', 'reel', 'demo', 'video', 'showcase']) {
      const r = plan(base({ request: `I want a ${w} of this` }));
      assert.equal(r.mode, 'showcase', w);
      assert.equal(r.assumed, false);
      assert.equal(r.plays, 'loop-from-empty');
      assert.match(r.why, new RegExp(w));
    }
  });
  it('otherwise website is assumed, with a reason', () => {
    const r = plan(base({ request: 'make it move' }));
    assert.equal(r.mode, 'website');
    assert.equal(r.assumed, true);
    assert.equal(r.plays, 'once-on-scroll');
    assert.ok(r.why.length > 10);
    assert.match(r.why, /assum/i);
  });
});

describe('word matching', () => {
  it('matches whole words case-insensitively', () => {
    assert.equal(plan(base({ request: 'A LOOP of the logo' })).mode, 'showcase');
    assert.equal(plan(base({ request: 'On Scroll reveal' })).mode, 'website');
  });
  it('does not match inside longer words', () => {
    for (const t of ['a loophole', 'the sitemap', 'websites are fun? no: pageant', 'prescroll', 'demographic', 'reelect', 'videographer']) {
      const r = plan(base({ request: t }));
      assert.equal(r.assumed, true, t);
    }
  });
  it('decideMode is exported and pure', () => {
    assert.equal(decideMode({ request: 'loophole', has_site_codebase: false }).assumed, true);
  });
});

describe('a request naming both', () => {
  it('resolves by order and explains it', () => {
    const r = plan(base({ request: 'a looping demo of the hero section on our site' }));
    assert.equal(r.mode, 'website');
    assert.equal(r.assumed, false);
    assert.match(r.why, /demo/);
    assert.match(r.why, /showcase/i);
    assert.match(r.why, /first|order|wins|priority/i);
  });
  it('explicit mode with both still wins', () => {
    assert.equal(plan(base({ mode: 'showcase', request: 'a looping demo of the hero section on our site' })).mode, 'showcase');
  });
});

describe('section motion', () => {
  const sec = o => plan(base({ sections: [o] })).sections[0];
  it('hero gets a small load-in on text', () => {
    const s = sec({ id: 'h', kind: 'hero' });
    assert.equal(s.id, 'h');
    assert.deepEqual(s.motion, ['load-in']);
    assert.match(s.note, /text/i);
  });
  it('cards with a visual get card intro plus story', () => {
    assert.deepEqual(sec({ id: 'c', kind: 'cards', has_visual: true }).motion, ['card-intro', 'story']);
  });
  it('cards without a visual get the card intro only', () => {
    for (const v of [false, undefined]) {
      const s = sec({ id: 'c', kind: 'cards', has_visual: v });
      assert.deepEqual(s.motion, ['card-intro']);
      assert.match(s.note, /no visual/i);
    }
  });
  it('mockup is load-in only', () => {
    const s = sec({ id: 'm', kind: 'mockup' });
    assert.deepEqual(s.motion, ['load-in']);
    assert.equal(s.note, 'more only if the owner asks');
  });
  it('text is left to the normal scroll reveal', () => {
    const s = sec({ id: 't', kind: 'text' });
    assert.deepEqual(s.motion, []);
    assert.match(s.note, /scroll reveal/i);
  });
  it('media gets a load-in', () => {
    assert.deepEqual(sec({ id: 'v', kind: 'media' }).motion, ['load-in']);
  });
  it('other gets none and asks', () => {
    const s = sec({ id: 'o', kind: 'other' });
    assert.deepEqual(s.motion, []);
    assert.ok(s.note);
  });
  it('keeps section order', () => {
    const r = plan(base({ sections: [{ id: 'b', kind: 'text' }, { id: 'a', kind: 'hero' }] }));
    assert.deepEqual(r.sections.map(s => s.id), ['b', 'a']);
  });
});

describe('invalid input exits 1', () => {
  it('duplicate section ids', () => {
    exit(() => plan(base({ sections: [{ id: 'x', kind: 'hero' }, { id: 'x', kind: 'text' }] })));
    assert.throws(() => plan(base({ sections: [{ id: 'x', kind: 'hero' }, { id: 'x', kind: 'text' }] })), /x/);
  });
  it('bad shapes name the field', () => {
    exit(() => plan([]));
    exit(() => plan(null));
    exit(() => plan(base({ extra: 1 })));
    exit(() => plan({ has_site_codebase: true, sections: [] }));
    exit(() => plan(base({ request: '' })));
    exit(() => plan(base({ request: 5 })));
    exit(() => plan(base({ has_site_codebase: 'yes' })));
    exit(() => plan({ request: 'x', sections: [] }));
    exit(() => plan(base({ sections: 'no' })));
    exit(() => plan(base({ sections: [5] })));
    exit(() => plan(base({ sections: [{ id: '', kind: 'hero' }] })));
    exit(() => plan(base({ sections: [{ id: 'a', kind: 'footer' }] })));
    exit(() => plan(base({ sections: [{ id: 'a', kind: 'hero', has_visual: 'y' }] })));
    exit(() => plan(base({ sections: [{ id: 'a', kind: 'hero', zzz: 1 }] })));
    exit(() => plan(base({ mode: 'both' })));
    assert.throws(() => plan(base({ mode: 'both' })), /mode/);
    assert.throws(() => plan(base({ sections: [{ id: 'a', kind: 'footer' }] })), /sections\[0\]\.kind/);
  });
});

describe('run', () => {
  it('reads stdin or --file, returns the plan', async () => {
    assert.equal(verb, 'motion-plan');
    const r = await run([], io(JSON.stringify(base({ request: 'a reel' }))));
    assert.equal(r.mode, 'showcase');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-'));
    try {
      await fs.writeFile(path.join(dir, 'f.json'), '﻿' + JSON.stringify(base({ request: 'the page' })));
      const r2 = await run(['--file', 'f.json'], io('', dir));
      assert.equal(r2.mode, 'website');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('refuses bad json, empty input, unknown flags, missing file, oversize', async () => {
    await assert.rejects(run([], io('{nope')), e => e.code === 1);
    await assert.rejects(run([], io('  ')), e => e.code === 1);
    await assert.rejects(run(['--bogus'], io('{}')), e => e.code === 1);
    await assert.rejects(run(['--file'], io('{}')), e => e.code === 1);
    await assert.rejects(run(['--file', '/no/such/file.json'], io('')), e => e.code === 1);
    await assert.rejects(run([], io('x'.repeat(8 * 1024 * 1024 + 1))), e => e.code === 1);
  });
  it('stdin is read with stdinBytes({maxBytes: 8 MiB + 1}) and a happy path works', async () => {
    let seen;
    const r = await run([], { stdinBytes: async o => { seen = o; return Buffer.from(JSON.stringify(base({ request: 'a reel' }))); }, stdin: async () => { throw new Error('use stdinBytes'); }, env: {} });
    assert.equal(r.mode, 'showcase');
    assert.deepEqual(seen, { maxBytes: 8 * 1024 * 1024 + 1 });
  });
  it('the 8 MiB cap counts bytes, not characters (multibyte text)', async () => {
    const euro = '\u20ac'.repeat(3 * 1024 * 1024); // 3 Mi chars, 9 Mi bytes
    assert.ok(euro.length < 8 * 1024 * 1024);
    await assert.rejects(run([], io(euro)), e => e instanceof KitExit && e.code === 1 && /8 MiB/.test(e.message));
  });
  it('--file refuses a directory, naming it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-'));
    try {
      await assert.rejects(run(['--file', '.'], ioNoStdin(dir)), e => e instanceof KitExit && e.code === 1 && e.message.includes(dir));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('--file refuses a FIFO without reading it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-'));
    const fifo = path.join(dir, 'f.fifo');
    let hold;
    try {
      execFileSync('mkfifo', [fifo]);
      hold = await fs.open(fifo, 'r+'); // keeps the pipe open: an unbounded read never sees EOF
      await hold.write(JSON.stringify(base({ request: 'the page' })));
      let timer;
      const outcome = await Promise.race([
        run(['--file', fifo], ioNoStdin(dir)).then(() => 'read', e => (e instanceof KitExit && e.code === 1 && e.message.includes(fifo) ? 'refused' : 'other')),
        new Promise(res => { timer = setTimeout(() => res('hung'), 1500); }),
      ]);
      clearTimeout(timer);
      assert.equal(outcome, 'refused');
    } finally {
      if (hold) await hold.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  it('--file refuses /dev/stdin', async () => {
    await assert.rejects(run(['--file', '/dev/stdin'], ioNoStdin()), e => e instanceof KitExit && e.code === 1);
  });
  it('--file refuses a file over 8 MiB, including one that reads past the cap', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-'));
    try {
      await fs.writeFile(path.join(dir, 'big.json'), Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));
      await assert.rejects(run(['--file', 'big.json'], ioNoStdin(dir)), e => e instanceof KitExit && e.code === 1 && /8 MiB/.test(e.message));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('an empty --file value and a repeated --file are refused, not read from stdin', async () => {
    const stdin = JSON.stringify(base({ request: 'a reel' }));
    await assert.rejects(run(['--file', ''], io(stdin)), e => e instanceof KitExit && e.code === 1);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-'));
    try {
      await fs.writeFile(path.join(dir, 'a.json'), JSON.stringify(base()));
      await assert.rejects(run(['--file', 'a.json', '--file', 'a.json'], io(stdin, dir)), e => e instanceof KitExit && e.code === 1 && /more than once/.test(e.message));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
