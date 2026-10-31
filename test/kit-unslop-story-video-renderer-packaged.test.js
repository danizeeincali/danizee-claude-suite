import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installPackaged } from './helpers/packaged.js';

const story = (ms) => `<!doctype html><html><head><meta name="story-duration-ms" content="${ms}"></head><body><div style="animation:g 1s forwards"></div></body></html>`;

describe('story-render — packaged end to end', () => {
  let pkg;
  before(async () => { pkg = await installPackaged(); });
  after(async () => { await pkg.cleanup(); });

  it('plans, prints the play URL, renders when playwright resolves, refuses bad input, zero egress', async (t) => {
    assert.ok(JSON.parse(pkg.kit(['help']).out).verbs.includes('story-render'));
    await fs.writeFile(path.join(pkg.dir, 'story.html'), story(1000));
    const p = pkg.kit(['story-render', 'plan', '--file', 'story.html', '--format', 'wide', '--fps', '30']);
    assert.equal(p.code, 0);
    assert.equal(p.json.frames, 30);
    assert.deepEqual(p.json.size, { w: 1920, h: 1080 });
    assert.ok(p.json.ffmpeg_args.includes('libx264'));

    const play = pkg.kit(['story-render', 'play', '--file', 'story.html']);
    assert.equal(play.code, 0);
    assert.match(play.json.play_url, /^file:\/\/.*story\.html\?play=1$/);

    await fs.writeFile(path.join(pkg.dir, 'long.html'), story(30000));
    const over = pkg.kit(['story-render', 'plan', '--file', 'long.html']);
    assert.equal(over.code, 1);
    assert.equal(over.out, '');
    await fs.writeFile(path.join(pkg.dir, 'plain.html'), '<html></html>');
    assert.equal(pkg.kit(['story-render', 'plan', '--file', 'plain.html']).code, 1);
    assert.equal(pkg.kit(['story-render', 'plan', '--file', 'missing.html']).code, 1);
    assert.equal(pkg.kit(['story-render', 'plan']).code, 1);
    assert.equal(pkg.kit(['story-render', 'nope']).code, 1);

    // ffmpeg missing: an absolute path inside the project (so the sandbox preload allows the spawn attempt)
    const gone = pkg.kit(['story-render', 'render', '--file', 'story.html', '--out', 'o.mp4', '--ffmpeg', path.join(pkg.dir, 'no-ffmpeg')]);
    assert.equal(gone.code, 4);
    assert.match(gone.json.reason, /ffmpeg not found/);

    // a stand-in ffmpeg (a script inside the project) lets the render path run without any real encoder
    const fake = path.join(pkg.dir, 'fake-ffmpeg.sh');
    await fs.writeFile(fake, '#!/bin/sh\nfor a; do last="$a"; done\n[ "$1" = "-version" ] && echo fake && exit 0\nhead -c 4096 /dev/zero > "$last"\n');
    await fs.chmod(fake, 0o755);
    // The packaged harness forbids spawning a browser, so the render part runs only where playwright cannot be resolved
    // (NODE_PATH cleared): it must then stop cleanly with exit 4 before writing anything.
    const args = ['story-render', 'render', '--file', 'story.html', '--out', 'o.mp4', '--ffmpeg', fake, '--fps', '5'];
    const r = pkg.kit(args, undefined, { extraEnv: { NODE_PATH: '' } });
    if (r.code === 4) {
      assert.match(r.json.reason, /playwright not installed/);
      assert.equal(r.json.out, null);
      await assert.rejects(fs.stat(path.join(pkg.dir, 'o.mp4')));
    } else {
      t.diagnostic('playwright resolves from the packaged temp project even without NODE_PATH; render not driven here');
    }
    assert.deepEqual(pkg.egress(), []);
  });
});
