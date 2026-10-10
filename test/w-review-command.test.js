import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHORTCUTS_DIR = path.join(__dirname, '..', '.claude', 'commands', '.shortcuts');
const commands = getCommands();

describe('repo copy of the w-review shortcut is regenerated', () => {
  it('w-review.md equals the generator output, with no backslash-escaped backticks', async () => {
    const md = await fs.readFile(path.join(SHORTCUTS_DIR, 'w-review.md'), 'utf-8');
    assert.equal(md, commands['w-review'].content, 'w-review.md differs from getCommands()');
    assert.ok(!md.includes('\\`'), 'literal backslash-backtick in the repo copy');
  });
});

describe('/w-review closing step', () => {
  const step = () => {
    const c = commands['w-review'].content;
    const a = c.indexOf('## Closing step: record the push receipt');
    const b = c.indexOf('## Compounds', a);
    assert.ok(a >= 0 && b > a);
    return c.slice(a, b);
  };
  it('shows concrete pass and fail commands, no shell-hostile placeholders', () => {
    const s = step();
    assert.match(s, /push-gate receipt --verdict pass --high 0 --medium 0 --low 0/);
    assert.match(s, /push-gate receipt --verdict fail --high \d+ --medium \d+ --low \d+/);
    assert.ok(!s.includes('pass|fail'));
    assert.ok(!/<[HML]>/.test(s));
  });
  it('documents --threshold and that check must use the same level', () => {
    const s = step();
    assert.match(s, /--threshold high/);
    assert.match(s, /same `--threshold`/);
    assert.match(s, /--incomplete/);
  });
});

describe('/w-review lens step', () => {
  it('runs the lenses verb on a diff file inside Code Analysis, copy-pasteable as written', () => {
    const c = commands['w-review'].content;
    const a = c.indexOf('### ⛔ CHECKPOINT 1: Code Analysis');
    const b = c.indexOf('### ⛔ CHECKPOINT 2', a);
    const s = c.slice(a, b);
    assert.match(s, /D=\$\(mktemp\); node \.claude\/helpers\/kit\/cli\.js diff-range > "\$D"; RC=\$\?\n/);
    assert.match(s, /lenses --diff "\$D"; RC=\$\?;; 3\) echo "no change to review"/);
    assert.match(s, /rm -f "\$D"; \(exit \$RC\)\n/);
    assert.match(s, /diff-range --base-only/);
    assert.match(s, /--base "\$B"/);
    assert.ok(!s.includes('/tmp/w-review.diff'), 'no fixed shared temp path');
    assert.ok(!/git diff HEAD\b/.test(s), 'the lens step must not diff against HEAD only');
    assert.ok(!/BASE=\$\(git merge-base/.test(s), 'the hand-written range is gone');
    assert.match(s, /Exit 3 from `diff-range` means an empty range/);
    assert.match(s, /Any other non-zero exit is wrong input or a broken state/);
    assert.match(s, /--covered no-floating-promises/);
    assert.ok(!s.includes('\\`'));
  });
});

describe('/w-review exit-3 wording in all three steps', () => {
  it('lens, graph and impact paragraphs each say exit 3 is an empty range and any other non-zero exit is reported', () => {
    const c = commands['w-review'].content;
    const a = c.indexOf('**🔎 LENS CHECKS');
    const s = c.slice(a, c.indexOf('**REQUIRED OUTPUT:**', a));
    const paras = [s.slice(0, s.indexOf('**🕸️')), s.slice(s.indexOf('**🕸️'), s.indexOf('Then the blast radius')), s.slice(s.indexOf('Then the blast radius'))];
    for (const p of paras) {
      assert.match(p, /Exit 3 from `diff-range` means an empty range: report "no change to review", never a failure and never "no lens applies"/);
      assert.match(p, /Any other non-zero exit is wrong input or a broken state: report it, never skip the step/);
      assert.match(p, /Any other non-zero exit is wrong input or a broken state: report it, never skip the step\. Exit 2 means `diff-range` refused the repository \(for example an include in its own config\): report the refusal as printed\./);
    }
  });
});
