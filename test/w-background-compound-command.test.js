import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHORTCUTS_DIR = path.join(__dirname, '..', '.claude', 'commands', '.shortcuts');
const commands = getCommands();
const content = commands['w-background-compound'].content;
const FALLBACK = /If `\.claude\/helpers\/kit\/cli\.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before\./;

const section = (from, to) => {
  const a = content.indexOf(from);
  assert.ok(a >= 0, `missing ${from}`);
  const b = content.indexOf(to, a + from.length);
  assert.ok(b > a, `missing ${to}`);
  return content.slice(a, b);
};
const handoff = () => section('### ⛔ CHECKPOINT 1: Handoff', '### ⛔ CHECKPOINT 2');
const phase1 = () => section('**Phase 1: Inline Compound**', '**Phase 1.5');
const phase2 = () => section('**Phase 2: Git Commit**', '**Phase 3');
const phase3 = () => section('**Phase 3: Git Push/Merge', '**Phase 4');
const errors = () => section('**ERROR HANDLING:**', '### ⛔ CHECKPOINT 3');
const blocksOf = t => [...t.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]);

describe('repo copy of the w-background-compound shortcut is regenerated', () => {
  it('w-background-compound.md equals the generator output, no backslash-escaped backticks', async () => {
    const md = await fs.readFile(path.join(SHORTCUTS_DIR, 'w-background-compound.md'), 'utf-8');
    assert.equal(md, content);
    assert.ok(!md.includes('\\`'));
  });
  it('bc and bcp aliases still point at the main command', () => {
    assert.match(commands.bc.content, /`\.shortcuts:w-background-compound` skill/);
    assert.match(commands.bcp.content, /`\.shortcuts:w-background-compound` skill[^.]*`--push` appended/);
  });
});

describe('scrub before both commits', () => {
  for (const [name, get] of [['Handoff', handoff], ['Phase 2', phase2]]) {
    it(`${name}: git add first, scrub --worktree, every exit code, no commit on hits`, () => {
      const s = get();
      assert.match(s, /scrub --worktree/);
      assert.ok(s.indexOf('git add') < s.indexOf('scrub --worktree') || /Stage only the paths it wrote/.test(s));
      assert.match(s, /untracked file is not scanned|a file still untracked was not scanned/);
      assert.match(s, /Exit 0 (is )?clean/);
      assert.match(s, /Exit 2 means hits or an incomplete scan: list them as printed/);
      assert.match(s, /do not commit/i);
      assert.match(s, /Exit 1 is wrong input or a broken state: report it/);
      assert.match(s, /Any other non-zero exit/);
      assert.match(s, /say so in the summary|summary/);
      assert.match(s, FALLBACK);
    });
  }
  it('scrub comes before the commit in each place', () => {
    const h = handoff();
    assert.ok(h.indexOf('scrub --worktree') < h.indexOf('- Commit these files'));
    const p = phase2();
    assert.ok(p.indexOf('scrub --worktree') < p.indexOf('- Commit with descriptive message'));
  });
});

describe('push-gate check at the start of Phase 3', () => {
  it('runs before any push and names every outcome', () => {
    const s = phase3();
    assert.match(s, /push-gate check/);
    assert.ok(s.indexOf('push-gate check') < s.indexOf('Then push current branch'));
    assert.match(s, /Exit 2 is a deny \(read `decision` and `reason`\) or a refused receipt store \(`kit: refused:` on stderr\): \*\*not pushed\*\*/);
    assert.match(s, /Exit 0 with decision `ask`: put the question to the owner and do not push until they answer/);
    assert.match(s, /Exit 0 with decision `abstain` \(no receipt\): the push goes on/);
    assert.match(s, /Exit 1 is an error: report it and do not push/);
    assert.match(s, /never skips or answers the owner's own permission prompt/);
    assert.match(s, FALLBACK);
  });
});

describe('never-abort clause respects the gate', () => {
  it('names deny, ask and scrub hits as stops', () => {
    const s = errors();
    assert.match(s, /NEVER abort/);
    assert.match(s, /push-gate deny or ask, and a scrub hit, are not errors to work around: the phase stops there/);
    assert.match(s, /summary says why/);
  });
});

describe('redact into the solution doc', () => {
  it('is gated on .claude/kit/secrets and names the real flags', () => {
    const s = phase1();
    assert.match(s, /when `\.claude\/kit\/secrets` exists/);
    assert.match(s, /redact --keep-lines/);
    assert.match(s, /stdin/);
    assert.match(s, /--secrets-file <f>/);
    assert.match(s, /Exit 1 is wrong input or a broken state/);
    assert.match(s, /When `\.claude\/kit\/secrets` does not exist, say so in one line and write the text as is/);
    assert.match(s, FALLBACK);
  });
});

describe('bash blocks parse and carry the kit guard', () => {
  it('every bash block passes bash -n and starts with the guard', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-bash-'));
    try {
      const blocks = [handoff(), phase1(), phase2(), phase3()].flatMap(blocksOf);
      assert.equal(blocks.length, 4);
      blocks.forEach((b, i) => {
        assert.ok(b.startsWith('if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed'), b);
        assert.match(b.trimEnd(), /\(exit \$RC\); fi$|\(exit 0\); fi$/);
        const f = path.join(dir, `b${i}.sh`);
        writeFileSync(f, b);
        const r = spawnSync('bash', ['-n', f], { encoding: 'utf-8' });
        assert.equal(r.status, 0, `block ${i}: ${r.stderr}`);
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  it('without the kit each block exits 0 and says so', () => {
    const dir = nodeMk();
    for (const b of [handoff(), phase1(), phase2(), phase3()].flatMap(blocksOf)) {
      const r = spawnSync('bash', ['-c', b], { cwd: dir, encoding: 'utf-8' });
      assert.equal(r.status, 0);
      assert.match(r.stdout, /kit not installed/);
    }
  });
});

import { mkdtempSync } from 'fs';
function nodeMk() { return mkdtempSync(path.join(os.tmpdir(), 'bc-nokit-')); }
