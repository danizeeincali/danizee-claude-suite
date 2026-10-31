import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, verb, usage, parseStoryDuration, buildFfmpegArgs, frameCount, planStory, probeFfmpeg, FORMATS, FFMPEG_MISSING } from '../src/lib/kit/story-render.js';
import { KitExit } from '../src/lib/kit/kit-exit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'src', 'lib', 'kit', 'cli.js');
const code = async (p) => { try { await p; return 0; } catch (e) { assert.ok(e instanceof KitExit, String(e)); return e.code; } };
const story = (ms, extra = '') => `<!doctype html><html><head><meta name="story-duration-ms" content="${ms}"><style>.b{animation:g 1s linear forwards}@keyframes g{to{width:200px}}</style></head><body ${extra}><div class="b" style="height:20px;background:#c33"></div></body></html>`;

let dir;
const write = async (name, text) => { const f = path.join(dir, name); await fs.writeFile(f, text); return f; };
before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'story-render-t-')); });
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('story-render metadata', () => {
  it('reads the meta tag, then html, then body (first hit wins)', () => {
    assert.deepEqual(parseStoryDuration(story(3000)), { duration_ms: 3000, source: '<meta name="story-duration-ms">' });
    assert.equal(parseStoryDuration('<html data-story-duration-ms="1500"><body data-story-duration-ms="9"></body></html>').duration_ms, 1500);
    assert.equal(parseStoryDuration('<html><body data-story-duration-ms=\'800\'></body></html>').duration_ms, 800);
    assert.equal(parseStoryDuration('<html data-story-duration-ms=700><meta name="story-duration-ms" content="4000"></html>').duration_ms, 4000);
    assert.equal(parseStoryDuration('<META NAME="Story-Duration-MS" CONTENT=" 2500 ">').duration_ms, 2500);
  });
  it('ignores comments, script and style text that look like the tag', () => {
    const h = '<!-- <meta name="story-duration-ms" content="9"> --><script>var a="<meta name=\\"story-duration-ms\\" content=\\"8\\">"</script><meta name="story-duration-ms" content="1200">';
    assert.equal(parseStoryDuration(h).duration_ms, 1200);
    assert.throws(() => parseStoryDuration('<style>/* <meta name="story-duration-ms" content="5"> */</style>'), KitExit);
  });
  it('refuses missing, zero, negative, fractional, huge and non-numeric durations', () => {
    for (const bad of ['', 'abc', '0', '-5', '1.5', '1e3', '12345678901', ' ']) {
      assert.throws(() => parseStoryDuration(`<meta name="story-duration-ms" content="${bad}">`), (e) => e instanceof KitExit && e.code === 1, bad);
    }
    assert.throws(() => parseStoryDuration('<html><body>no metadata</body></html>'), /story-duration-ms/);
    assert.throws(() => parseStoryDuration('<meta name="story-duration-ms">'), KitExit);
  });
  it('the 8 MiB worst case (many unclosed tags) is scanned in linear time', () => {
    const t = Date.now();
    assert.throws(() => parseStoryDuration('<meta name="x" '.repeat(Math.floor(8 * 1048576 / 15))), KitExit);
    assert.throws(() => parseStoryDuration('<!-- '.repeat(1000000)), KitExit);
    assert.throws(() => parseStoryDuration('<script '.repeat(1000000)), KitExit);
    assert.ok(Date.now() - t < 5000, `took ${Date.now() - t} ms`);
  });
});

describe('story-render plan (pure)', () => {
  it('frame counts cover the duration', () => {
    assert.equal(frameCount(1000, 30), 30);
    assert.equal(frameCount(1001, 30), 31);
    assert.equal(frameCount(10000, 60), 600);
  });
  it('square and wide sizes, defaults and ffmpeg argv', () => {
    const p = planStory({ html: story(2000) });
    assert.equal(p.format, 'square');
    assert.deepEqual(p.size, { w: 1080, h: 1080 });
    assert.equal(p.fps, 30);
    assert.equal(p.frames, 60);
    assert.equal(p.duration_ms, 2000);
    assert.deepEqual(planStory({ html: story(2000), format: 'wide' }).size, { w: 1920, h: 1080 });
    assert.deepEqual(FORMATS.wide, { w: 1920, h: 1080 });
    for (const flag of ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r']) assert.ok(p.ffmpeg_args.includes(flag), flag);
    assert.ok(p.ffmpeg_args.some((a) => a.includes('{frames_dir}')));
    assert.equal(p.ffmpeg_args.at(-1), '{out}');
  });
  it('buildFfmpegArgs is a plain argv with constant frame rate, shell metacharacters stay one element', () => {
    const a = buildFfmpegArgs({ framesDir: '/t/f; rm -rf x', out: '/o/a b$(x).mp4', fps: 24 });
    assert.equal(a[a.indexOf('-framerate') + 1], '24');
    assert.equal(a[a.indexOf('-r') + 1], '24');
    assert.equal(a[a.indexOf('-i') + 1], '/t/f; rm -rf x/frame-%05d.png');
    assert.equal(a.at(-1), '/o/a b$(x).mp4');
    assert.ok(a.every((x) => typeof x === 'string'));
  });
  it('refuses a duration over the cap, and the cap is reachable', () => {
    assert.throws(() => planStory({ html: story(10001) }), /over the 10 s cap/);
    assert.equal(planStory({ html: story(10000) }).frames, 300);
    assert.equal(planStory({ html: story(20000), maxSeconds: 20 }).frames, 600);
    assert.throws(() => planStory({ html: story(20001), maxSeconds: 20 }), KitExit);
  });
  it('rejects an unknown format, including inherited object keys', () => {
    for (const f of ['tall', 'constructor', '__proto__', 'toString']) assert.throws(() => planStory({ html: story(1000), format: f }), KitExit, f);
  });
});

describe('story-render CLI surface (run)', () => {
  it('usage and help', async () => {
    assert.equal(verb, 'story-render');
    assert.deepEqual(await run([]), { usage });
    assert.deepEqual(await run(['plan', '--help']), { usage });
    assert.equal(await code(run(['nope'])), 1);
  });
  it('plan --file prints the documented fields', async () => {
    const f = await write('s.html', story(1000));
    const p = await run(['plan', '--file', f, '--format', 'wide', '--fps', '24'], {});
    assert.deepEqual(Object.keys(p), ['file', 'format', 'size', 'fps', 'frames', 'duration_ms', 'duration_source', 'ffmpeg_args']);
    assert.equal(p.format, 'wide');
    assert.equal(p.fps, 24);
    assert.equal(p.frames, 24);
    assert.equal(p.file, await fs.realpath(f));
    const rel = await run(['plan', '--file=s.html'], { cwd: dir });
    assert.equal(rel.frames, 30);
  });
  it('plan refuses over-cap (exit 1) and honours --max-seconds', async () => {
    const f = await write('long.html', story(12000));
    assert.equal(await code(run(['plan', '--file', f])), 1);
    assert.equal((await run(['plan', '--file', f, '--max-seconds', '12'])).frames, 360);
  });
  it('bad input exits 1: missing file, empty, binary, directory, /dev, oversize, no metadata', async () => {
    assert.equal(await code(run(['plan'])), 1);
    assert.equal(await code(run(['plan', '--file', path.join(dir, 'missing.html')])), 1);
    assert.equal(await code(run(['plan', '--file', await write('empty.html', '')])), 1);
    assert.equal(await code(run(['plan', '--file', await write('bin.html', Buffer.from([0x3c, 0, 0, 1, 2]).toString('latin1'))])), 1);
    const nul = path.join(dir, 'nul.html'); await fs.writeFile(nul, Buffer.concat([Buffer.from(story(1000)), Buffer.from([0])]));
    assert.equal(await code(run(['plan', '--file', nul])), 1);
    assert.equal(await code(run(['plan', '--file', dir])), 1);
    assert.equal(await code(run(['plan', '--file', '/dev/null'])), 1);
    assert.equal(await code(run(['plan', '--file', await write('plain.html', '<html></html>')])), 1);
    const big = path.join(dir, 'big.html');
    await fs.writeFile(big, story(1000) + ' '.repeat(8 * 1048576));
    assert.equal(await code(run(['plan', '--file', big])), 1);
    const exact = path.join(dir, 'exact.html');
    const base = story(1000);
    await fs.writeFile(exact, base + ' '.repeat(8 * 1048576 - Buffer.byteLength(base)));
    assert.equal((await run(['plan', '--file', exact])).frames, 30);
  });
  it('a BOM before the page is tolerated', async () => {
    assert.equal((await run(['plan', '--file', await write('bom.html', '﻿' + story(1000))])).duration_ms, 1000);
  });
  it('unknown, duplicate, valueless and out-of-range flags exit 1', async () => {
    const f = await write('s2.html', story(1000));
    for (const args of [
      ['plan', '--file', f, '--bogus', '1'], ['plan', '--file', f, '--file', f], ['plan', '--file'], ['plan', '--file', ''],
      ['plan', '--file', f, '--format', 'tall'], ['plan', '--file', f, '--fps', '0'], ['plan', '--file', f, '--fps', '61'],
      ['plan', '--file', f, '--fps', 'x'], ['plan', '--file', f, '--max-seconds', '0'], ['plan', '--file', f, '--max-seconds', '121'],
      ['plan', '--file', f, 'extra'], ['plan', '--file', f, '--constructor', 'x'], ['plan', '--file', f, '--keep-frames'],
      ['play', '--file', f, '--fps', '30'], ['render', '--file', f, '--keep-frames=1'],
    ]) assert.equal(await code(run(args)), 1, args.join(' '));
  });
  it('play prints the file:// URL and the ?play=1 contract and starts nothing', async () => {
    const f = await write('p.html', story(1000));
    const r = await run(['play', '--file', f, '--format', 'wide']);
    assert.match(r.url, /^file:\/\/\//);
    assert.equal(r.play_url, r.url + '?play=1');
    assert.match(r.contract, /\?play=1/);
    assert.deepEqual(r.size, { w: 1920, h: 1080 });
    assert.match(r.next, /story-render render/);
    assert.equal(await code(run(['play'])), 1);
    assert.equal(await code(run(['play', '--file', f, '--format', 'tall'])), 1);
  });
});

describe('story-render render (injected tools)', () => {
  it('ffmpeg missing: exit 4 with a reason, before any frame is captured', async () => {
    const f = await write('r.html', story(1000));
    let captured = false;
    const io = { cwd: dir, exec: async () => ({ code: null, stderr: '', error: Object.assign(new Error('x'), { code: 'ENOENT' }) }), resolvePlaywright: async () => { captured = true; return null; } };
    const r = await run(['render', '--file', f, '--out', 'o.mp4'], io);
    assert.equal(r.exit, 4);
    assert.equal(r.out, null);
    assert.match(r.reason, new RegExp(FFMPEG_MISSING));
    assert.equal(captured, false);
    const p = await probeFfmpeg('/nonexistent/ffmpeg');
    assert.equal(p.ok, false);
    assert.match(p.reason, /--ffmpeg/);
    await assert.rejects(fs.stat(path.join(dir, 'o.mp4')));
  });
  it('playwright missing: exit 4, nothing written, temp frames removed', async () => {
    const f = await write('r2.html', story(1000));
    const before = (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('story-render-')).length;
    const io = { cwd: dir, exec: async () => ({ code: 0, stderr: '' }), resolvePlaywright: async () => null };
    const r = await run(['render', '--file', f, '--out', 'o2.mp4'], io);
    assert.equal(r.exit, 4);
    assert.match(r.reason, /playwright not installed/);
    assert.equal((await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('story-render-')).length, before);
  });
  it('render argument errors exit 1: no --out, wrong extension, missing directory, over-cap, directory as out', async () => {
    const f = await write('r3.html', story(1000));
    const io = { cwd: dir, exec: async () => ({ code: 0, stderr: '' }), resolvePlaywright: async () => null };
    assert.equal(await code(run(['render', '--file', f], io)), 1);
    assert.equal(await code(run(['render', '--file', f, '--out', 'o.gif'], io)), 1);
    assert.equal(await code(run(['render', '--file', f, '--out', 'nodir/o.mp4'], io)), 1);
    assert.equal(await code(run(['render', '--file', f, '--out', 'x.mp4', '--max-seconds', '1', '--fps', '30'], { ...io })), 0);
    assert.equal(await code(run(['render', '--file', await write('r4.html', story(5000)), '--out', 'x.mp4', '--max-seconds', '1'], io)), 1);
    await fs.mkdir(path.join(dir, 'd.mp4'));
    assert.equal(await code(run(['render', '--file', f, '--out', 'd.mp4'], io)), 1);
  });
  it('a failing ffmpeg exits 1 and leaves no partial file or temp frames', async () => {
    const f = await write('r5.html', story(1000));
    const fakePw = { chromium: { launch: async () => { throw new Error('no browser'); } } };
    const io = { cwd: dir, exec: async () => ({ code: 0, stderr: '' }), resolvePlaywright: async () => fakePw };
    const r = await run(['render', '--file', f, '--out', 'o5.mp4'], io);
    assert.equal(r.exit, 4);
    assert.match(r.reason, /browser could not start/);
  });
});

describe('story-render through the real CLI path', () => {
  const cli = (args, cwd = dir) => { const r = spawnSync(process.execPath, [CLI, 'story-render', ...args], { cwd, encoding: 'utf-8' }); let json = null; try { json = JSON.parse(r.stdout); } catch {} return { code: r.status, out: r.stdout, err: r.stderr, json }; };
  it('plan --file, play, and error exits through cli.js', async () => {
    await write('c.html', story(2000));
    const p = cli(['plan', '--file', 'c.html', '--format', 'wide']);
    assert.equal(p.code, 0);
    assert.equal(p.json.frames, 60);
    assert.equal(p.json.size.w, 1920);
    assert.equal(cli(['play', '--file', 'c.html']).json.play_url.endsWith('c.html?play=1'), true);
    const over = cli(['plan', '--file', 'long.html']);
    assert.equal(over.code, 1);
    assert.equal(over.out, '');
    assert.match(over.err, /over the 10 s cap/);
    assert.equal(cli(['plan', '--file', 'nope.html']).code, 1);
    assert.equal(cli(['plan']).code, 1);
    const help = spawnSync(process.execPath, [CLI, 'help'], { encoding: 'utf-8' });
    assert.ok(JSON.parse(help.stdout).verbs.includes('story-render'));
  });
  it('render with a missing ffmpeg exits 4 through cli.js', async () => {
    await write('c2.html', story(1000));
    const r = cli(['render', '--file', 'c2.html', '--out', 'c2.mp4', '--ffmpeg', path.join(dir, 'no-such-ffmpeg')]);
    assert.equal(r.code, 4);
    assert.equal(r.json.out, null);
    assert.match(r.json.reason, /ffmpeg not found/);
  });
});

describe('story-render header contract', () => {
  it('every documented output field and exit appears in the header and the code', async () => {
    const src = await fs.readFile(path.join(HERE, '..', 'src', 'lib', 'kit', 'story-render.js'), 'utf-8');
    const header = src.slice(0, src.indexOf('*/'));
    for (const k of ['file', 'format', 'size', 'fps', 'frames', 'duration_ms', 'duration_source', 'ffmpeg_args', 'out', 'bytes', 'frames_dir', 'url', 'play_url', 'contract', 'next', 'exit:4']) assert.ok(header.includes(k), k);
    for (const k of ['story-duration-ms', 'data-story-duration-ms', '?play=1', '--keep-frames', '--ffmpeg', '--max-seconds', 'libx264', 'yuv420p', '+faststart']) assert.ok(header.includes(k), k);
    assert.ok(header.trimEnd().endsWith('Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.'));
    const mirror = await fs.readFile(path.join(HERE, '..', '.claude', 'helpers', 'kit', 'story-render.js'));
    assert.ok(mirror.equals(Buffer.from(src)));
  });
});

describe('story-render end to end (real playwright + ffmpeg)', () => {
  it('renders a 1 s CSS-animation story to a valid MP4', async (t) => {
    let pw = null;
    try { const { createRequire } = await import('node:module'); createRequire(import.meta.url).resolve('playwright'); pw = true; } catch { /* not installed */ }
    const ff = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8' });
    if (!pw) return t.skip('playwright cannot be resolved here; end-to-end render skipped');
    if (ff.error || ff.status !== 0) return t.skip('ffmpeg is not installed; end-to-end render skipped');
    const f = await write('e2e.html', story(1000));
    const out = path.join(dir, 'e2e.mp4');
    const r = await run(['render', '--file', f, '--out', out, '--fps', '10', '--keep-frames'], { cwd: HERE.replace(/test$/, '') });
    assert.equal(r.exit, undefined, r.reason);
    assert.equal(r.frames, 10);
    assert.deepEqual(r.size, { w: 1080, h: 1080 });
    assert.ok(r.bytes > 1024, `bytes ${r.bytes}`);
    assert.equal((await fs.stat(out)).size, r.bytes);
    assert.ok((await fs.readdir(r.frames_dir)).filter((n) => /^frame-\d+\.png$/.test(n)).length === 10);
    await fs.rm(r.frames_dir, { recursive: true, force: true });
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt,codec_name:format=duration', '-of', 'json', out], { encoding: 'utf-8' });
    if (probe.error || probe.status !== 0) return; // ffprobe is optional
    const j = JSON.parse(probe.stdout);
    assert.equal(j.streams[0].width, 1080);
    assert.equal(j.streams[0].height, 1080);
    assert.equal(j.streams[0].codec_name, 'h264');
    assert.equal(j.streams[0].pix_fmt, 'yuv420p');
    assert.ok(Math.abs(Number(j.format.duration) - 1) < 0.15, `duration ${j.format.duration}`);
    // default run removes its temp frames
    const left = (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('story-render-') && !n.startsWith('story-render-t-'));
    const r2 = await run(['render', '--file', f, '--out', path.join(dir, 'e2e2.mp4'), '--fps', '5', '--format', 'wide'], { cwd: HERE });
    assert.deepEqual(r2.size, { w: 1920, h: 1080 });
    assert.equal(r2.frames_dir, undefined);
    assert.equal((await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('story-render-') && !n.startsWith('story-render-t-')).length, left.length);
  });
});
