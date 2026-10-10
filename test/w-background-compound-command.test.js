import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { writeFileSync, mkdtempSync, mkdirSync, cpSync, readdirSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KIT_SRC = path.join(__dirname, '..', 'src', 'lib', 'kit');
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
const checkpoint4 = () => section('### ⛔ CHECKPOINT 4: Record', '## Difference from /w-compound');

// A throwaway git repo with the real kit copied to .claude/helpers/kit (git-ignored, as an install leaves it).
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf-8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const putKit = dir => cpSync(KIT_SRC, path.join(dir, '.claude', 'helpers', 'kit'), { recursive: true });
function kitRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bc-kit-'));
  const dir = path.join(root, 'repo');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main', '.');
  writeFileSync(path.join(dir, '.gitignore'), '.claude/\n');
  writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  putKit(dir);
  const tmp = path.join(root, 'tmp');
  mkdirSync(tmp);
  const env = { ...process.env, HOME: root, TMPDIR: tmp, KIT_RECEIPTS_DIR: path.join(root, 'receipts'), GIT_CONFIG_NOSYSTEM: '1' };
  const run = (b, cwd = dir) => spawnSync('bash', ['-c', b], { cwd, encoding: 'utf-8', env });
  return { root, dir, tmp, run };
}
const redactBlock = () => blocksOf(phase1())[0];
const gateBlock = () => blocksOf(phase3())[0];
const NO_REVIEW = 'no review recorded for this change';

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
    assert.match(s, /Exit 0 with decision `abstain` \(a passing receipt for this exact change, or an incomplete one that found nothing blocking\): the push goes on/);
    assert.match(s, /Exit 0 with decision `ask` and a `reason` starting "no review recorded for this change"[^\n]*The push goes on, and the summary says "no review recorded for this change, pushed \(run \/w-review next time\)"/);
    assert.match(s, /Exit 0 with any other `ask`[^\n]*\*\*not pushed\*\*/);
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
  it('always runs when the kit is installed and names the real flags', () => {
    const s = phase1();
    assert.match(s, /whenever the kit is installed/);
    assert.match(s, /redact --keep-lines/);
    assert.match(s, /stdin/);
    assert.match(s, /--secrets-file <f>/);
    assert.match(s, /Exit 1 is wrong input or a broken state/);
    assert.match(s, /With no secrets file anywhere nothing is replaced \(`replaced: 0`\)/);
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
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bc-nokit-'));
    try {
      for (const b of [handoff(), phase1(), phase2(), phase3()].flatMap(blocksOf)) {
        const r = spawnSync('bash', ['-c', b], { cwd: dir, encoding: 'utf-8' });
        assert.equal(r.status, 0);
        assert.match(r.stdout, /kit not installed/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('review round 1 fixes (wording)', () => {
  it('high: the redact block never tests for the secrets file itself; the verb finds it in the worktree or the main checkout', () => {
    const b = redactBlock();
    assert.doesNotMatch(b, /kit\/secrets/);
    assert.match(b, /redact --keep-lines/);
    const s = phase1();
    assert.match(s, /Never test for the secrets file yourself/);
    assert.match(s, /at the top of the worktree it runs in, then in the main checkout/);
  });
  it('medium: the diff goes to a guarded temp file, git\'s exit is checked, then redact reads the file', () => {
    const b = redactBlock();
    assert.match(b, /D=\$\(mktemp 2>\/dev\/null\) && \[ -n "\$D" \] \|\| \{/);
    assert.match(b, /git diff HEAD~1 > "\$D"; RC=\$\?/);
    assert.match(b, /redact --keep-lines < "\$D"/);
    assert.doesNotMatch(b, /\| node/);
    assert.match(b, /\[ -z "\$D" \] \|\| rm -f "\$D"/);
    assert.match(phase1(), /the same pipeline applies to any excerpt/);
  });
  it('medium: the no-review reason in the text is the verb\'s own reason', async () => {
    const src = await fs.readFile(path.join(KIT_SRC, 'push-gate.js'), 'utf-8');
    assert.ok(src.includes(`block('${NO_REVIEW};`), 'push-gate.js no longer returns the no-review reason this text quotes');
    assert.ok(phase3().includes(`starting "${NO_REVIEW}"`));
  });
  it('medium: an ask or deny stops Phase 3 into the summary and the lead relays it', () => {
    const s = phase3();
    assert.match(s, /Stop Phase 3 and write "not pushed — gate asks: <reason>" into the Phase 4 summary/);
    assert.match(s, /Stop Phase 3 and write "not pushed — gate denied: <reason>"/);
    assert.match(s, /never puts the question itself and never answers it/);
    assert.match(section('**Phase 4', '**ERROR HANDLING'), /not pushed — gate asks: <reason>/);
    const c = checkpoint4();
    assert.match(c, /\*\*Relay a gate stop \(lead\):\*\*/);
    assert.match(c, /relay that line to the owner word for word/);
    assert.match(c, /Only after the owner answers does the lead run the push in the foreground/);
    assert.match(c, /never answers the gate's question or that prompt itself/);
    assert.doesNotMatch(s, /put the question to the owner and do not push until they answer/);
  });
  it('low: main is re-checked after the merge, before main is pushed', () => {
    const s = phase3();
    const merge = s.indexOf('merge to main');
    const again = s.indexOf('run the same push-gate block again on main before pushing main');
    assert.ok(merge > 0 && again > merge, 'no push-gate re-check on main after the merge');
  });
  it('low: path-limited commits, refused lead scrub unstages and drops --push, Phase 2 failures skip Phase 3', () => {
    const p = phase2();
    assert.match(p, /git commit -m "<message>" -- <its own paths>/);
    assert.match(p, /Exit 1 is wrong input or a broken state: report it, do not commit, skip Phase 3/);
    assert.match(p, /Any other non-zero exit is a failure of the step: report it, do not commit, skip Phase 3/);
    const h = handoff();
    assert.match(h, /git restore --staged -- <those paths>/);
    assert.match(h, /dispatch the background agent \*\*without `--push`\*\*/);
    assert.match(h, /git commit -- <those paths>/);
  });
});

describe('blocks run against the real kit', () => {
  it('push-gate block with no receipt: exit 0, decision ask, the no-review reason (push goes on per the text)', () => {
    const fx = kitRepo();
    try {
      const r = fx.run(gateBlock());
      assert.equal(r.status, 0, r.stderr);
      const j = JSON.parse(r.stdout);
      assert.equal(j.decision, 'ask');
      assert.ok(j.reason.startsWith(NO_REVIEW), j.reason);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('redact block replaces a planted secret listed in .claude/kit/secrets', () => {
    const fx = kitRepo();
    try {
      const secret = 'sk-planted-7f3a9c2e1b8d4f60';
      mkdirSync(path.join(fx.dir, '.claude', 'kit'), { recursive: true });
      writeFileSync(path.join(fx.dir, '.claude', 'kit', 'secrets'), `${secret}\n`);
      writeFileSync(path.join(fx.dir, 'a.txt'), `one\ntoken = ${secret}\n`);
      git(fx.dir, 'commit', '-q', '-am', 'leak');
      const r = fx.run(redactBlock());
      assert.equal(r.status, 0, r.stderr);
      const j = JSON.parse(r.stdout);
      assert.ok(j.replaced >= 1);
      assert.ok(!j.text.includes(secret));
      assert.match(j.text, /token = /);
      assert.deepEqual(readdirSync(fx.tmp), [], 'temp file left behind');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('high: in a linked worktree the redact block uses the main checkout\'s secrets file', () => {
    const fx = kitRepo();
    try {
      const secret = 'sk-planted-worktree-0c41e7';
      mkdirSync(path.join(fx.dir, '.claude', 'kit'), { recursive: true });
      writeFileSync(path.join(fx.dir, '.claude', 'kit', 'secrets'), `${secret}\n`);
      writeFileSync(path.join(fx.dir, 'a.txt'), `one\n${secret}\n`);
      git(fx.dir, 'commit', '-q', '-am', 'leak');
      const wt = path.join(fx.root, 'wt');
      git(fx.dir, 'worktree', 'add', '-q', '--detach', wt);
      putKit(wt);
      const r = fx.run(redactBlock(), wt);
      assert.equal(r.status, 0, r.stderr);
      const j = JSON.parse(r.stdout);
      assert.ok(j.replaced >= 1);
      assert.ok(!j.text.includes(secret));
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('redact block with no secrets file anywhere: replaced 0, text as is', () => {
    const fx = kitRepo();
    try {
      writeFileSync(path.join(fx.dir, 'a.txt'), 'one\ntwo\n');
      git(fx.dir, 'commit', '-q', '-am', 'two');
      const r = fx.run(redactBlock());
      assert.equal(r.status, 0, r.stderr);
      const j = JSON.parse(r.stdout);
      assert.equal(j.replaced, 0);
      assert.match(j.text, /\+two/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('medium: a failing git diff is reported, never an empty clean result, and the temp file is removed', () => {
    const fx = kitRepo(); // one commit: HEAD~1 does not exist
    try {
      const r = fx.run(redactBlock());
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /git diff failed \(exit \d+\)/);
      assert.doesNotMatch(r.stdout, /"replaced"/);
      assert.deepEqual(readdirSync(fx.tmp), [], 'temp file left behind');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});
