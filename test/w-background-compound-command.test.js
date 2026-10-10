import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { writeFileSync, mkdtempSync, mkdirSync, cpSync, readdirSync, rmSync, existsSync, readFileSync, statSync } from 'fs';
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
const checkpoint0 = () => section('### ⛔ CHECKPOINT 0: Pre-flight', '### ⛔ CHECKPOINT 1');
const dispatch = () => section('### ⛔ CHECKPOINT 2: Background Dispatch', '**Phase 1: Inline Compound**');
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
  const run = (b, cwd = dir, extra = {}) => spawnSync('bash', ['-c', b], { cwd, encoding: 'utf-8', env: { ...env, ...extra } });
  return { root, dir, tmp, run };
}
// The redact block prints one summary line and leaves the redacted text in the file it names.
function redactOut(fx, r) {
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/^replaced=(\d+) bytes=(\d+) file=(\S+)\n$/);
  assert.ok(m, `summary line shape: ${r.stdout}`);
  assert.ok(existsSync(m[3]), 'the named file does not exist');
  const text = readFileSync(m[3], 'utf-8');
  assert.equal(Buffer.byteLength(text), Number(m[2]));
  assert.deepEqual(readdirSync(fx.tmp), [path.basename(m[3])], 'only the redacted file is left in TMPDIR (D and J are gone)');
  return { replaced: Number(m[1]), text, file: m[3] };
}
const redactBlock = () => blocksOf(phase1())[0];
const gateBlock = () => blocksOf(phase3())[0];
const baseBlock = () => blocksOf(checkpoint0())[0];
const EARLIER = 'only an earlier review exists, for a different version of this change; run /w-review on the current one';
const REFUSED = '"not committed, not pushed — handoff scrub refused: <hits>"';
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
      const blocks = [checkpoint0(), handoff(), phase1(), phase2(), phase3()].flatMap(blocksOf);
      assert.equal(blocks.length, 6);
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
      for (const b of [checkpoint0(), handoff(), phase1(), phase2(), phase3()].flatMap(blocksOf)) {
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
    // retargeted: the guard now makes D, J and R together
    assert.match(b, /D=\$\(mktemp 2>\/dev\/null\) && J=\$\(mktemp 2>\/dev\/null\) && R=\$\(mktemp 2>\/dev\/null\) && \[ -n "\$D" \] && \[ -n "\$J" \] && \[ -n "\$R" \] \|\| \{/);
    assert.match(b, /diff-range --base "\$BASE" --no-untracked > "\$D"; RC=\$\?/);
    assert.match(b, /redact --keep-lines < "\$D"/);
    assert.doesNotMatch(b, /\| node/);
    assert.match(b, /\[ -z "\$D" \] \|\| rm -f "\$D" "\$J"/); // retargeted: D and J are removed together
    assert.match(phase1(), /the same pipeline applies to any excerpt/);
  });
  it('medium: the no-review reason in the text is the verb\'s own reason', async () => {
    const src = await fs.readFile(path.join(KIT_SRC, 'push-gate.js'), 'utf-8');
    assert.ok(src.includes(`block('${NO_REVIEW};`), 'push-gate.js no longer returns the no-review reason this text quotes');
    assert.ok(phase3().includes(`starting "${NO_REVIEW}"`));
  });
  it('medium: an ask or deny stops Phase 3 into the summary and the lead relays it', () => {
    const s = phase3();
    assert.match(s, /Stop Phase 3 and write "not pushed \(branch\) — gate asks: <reason>" into the Phase 4 summary/);
    assert.match(s, /Stop Phase 3 and write "not pushed \(branch\) — gate denied: <reason>"/);
    assert.match(s, /never puts the question itself and never answers it/);
    assert.match(section('**Phase 4', '**ERROR HANDLING'), /not pushed \(main\) — gate asks: <reason>/);
    const c = checkpoint4();
    assert.match(c, /\*\*Relay a gate stop \(lead\):\*\*/);
    assert.match(c, /relay that line to the owner word for word/);
    assert.match(c, /only after the owner explicitly says go does the lead push in the foreground/);
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
    assert.match(h, /git reset -q -- <those paths>/);
    assert.match(h, /dispatch the background agent \*\*without `--push`\*\*/);
    assert.match(h, /git commit -- <those paths>/);
  });
});

describe('review round 2 fixes (wording)', () => {
  it('high: the lead records the session base and passes BASE; the redact block diffs "$BASE", no HEAD~1 in any block', async () => {
    const c0 = checkpoint0();
    assert.match(c0, /\*\*Step 0: Record the session base\*\*/);
    assert.match(baseBlock(), /diff-range --base-only/);
    assert.match(c0, /prints the merge-base of HEAD with `@\{upstream\}`, or, when there is no upstream, the empty-tree id/);
    assert.match(c0, /it exits non-zero on failure/);
    assert.match(c0, /the lead uses the pre-handoff HEAD instead and says so; without the kit, `BASE` is the pre-handoff HEAD/);
    assert.match(c0, /auto-detect from the range since `\$BASE`/);
    assert.match(c0, /writes it into the dispatch prompt as the agent's `BASE`/);
    assert.match(dispatch(), /The dispatch prompt carries `BASE=<sha>`/);
    assert.match(redactBlock(), /diff-range --base "\$BASE" --no-untracked > "\$D"/);
    assert.match(phase1(), /then writes the range with the hardened verb, `node \.claude\/helpers\/kit\/cli\.js diff-range --base "\$BASE" --no-untracked > "\$D"; RC=\$\?`/);
    for (const b of [checkpoint0(), handoff(), phase1(), phase2(), phase3()].flatMap(blocksOf)) assert.doesNotMatch(b, /HEAD~1/);
    const src = await fs.readFile(path.join(KIT_SRC, 'diff-range.js'), 'utf-8');
    assert.match(src, /--base-only prints the resolved base/);
  });
  it('medium/low: a refused handoff scrub is reported "not committed, not pushed", the same in the handoff and Phase 2', () => {
    const h = handoff();
    assert.match(h, /`scrub --worktree` scans every tracked file as it is on disk, so while a tracked file still holds the hit the agent's Phase 2 scrub refuses too/);
    assert.match(h, /write "handoff scrub refused: <hits>" \(the hits as printed\) into its dispatch prompt/);
    assert.match(h, /skips Phase 2 and Phase 3/);
    assert.match(h, /The lead does not write that line itself/);
    assert.ok(h.includes(REFUSED));
    const p = phase2();
    assert.match(p, /when the dispatch prompt carries "handoff scrub refused: <hits>", skip Phase 2 and Phase 3/);
    assert.ok(p.includes(REFUSED));
    assert.ok(phase3().includes(REFUSED));
    assert.doesNotMatch(content, /"not pushed — handoff scrub refused"/);
    assert.doesNotMatch(h, /commits its own paths/);
  });
  it('medium: main is re-checked with --base "$MB", the branch base; a new tree gets the earlier-review ask, relayed', async () => {
    const src = await fs.readFile(path.join(KIT_SRC, 'push-gate.js'), 'utf-8');
    assert.ok(src.includes(`block('${EARLIER}'`), 'push-gate.js no longer returns the earlier-review reason this text quotes');
    const s = phase3();
    const mb = s.indexOf('MB=$(git merge-base @{upstream} HEAD 2>/dev/null)');
    const merge = s.indexOf('merge to main');
    assert.ok(mb > 0 && merge > mb, 'MB not recorded before the merge');
    assert.ok(s.indexOf('push-gate check --base "$MB"') > merge);
    assert.match(s, /a fast-forward merge of the reviewed tree matches its receipt/);
    assert.ok(s.includes(`A non-fast-forward merge yields a new tree, for which the gate returns ask "${EARLIER}"; that goes to the relay (CHECKPOINT 4) like any other ask`));
  });
  it('medium: relay — an explicit go on an ask pushes without rerunning the stop rule; a deny is never pushed past', () => {
    const c = checkpoint4();
    assert.match(c, /On an ask, only after the owner explicitly says go does the lead push in the foreground \(the push and merge lines of Phase 3\) without rerunning the gate's stop rule/);
    assert.match(c, /the owner's own permission prompt still applies, the lead never answers the gate's question or that prompt itself/);
    assert.match(c, /A deny is never pushed past, not even on the owner's word: the owner fixes the cause and runs \/bcp again/);
    assert.doesNotMatch(c, /push-gate block first/);
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
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      git(fx.dir, 'commit', '-q', '-am', 'leak');
      const r = fx.run(redactBlock(), fx.dir, { BASE });
      assert.equal(r.status, 0, r.stderr);
      const j = redactOut(fx, r);
      assert.ok(j.replaced >= 1);
      assert.ok(!j.text.includes(secret));
      assert.match(j.text, /token = /);
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
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      git(fx.dir, 'commit', '-q', '-am', 'leak');
      const wt = path.join(fx.root, 'wt');
      git(fx.dir, 'worktree', 'add', '-q', '--detach', wt);
      putKit(wt);
      const r = fx.run(redactBlock(), wt, { BASE });
      assert.equal(r.status, 0, r.stderr);
      const j = redactOut(fx, r);
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
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      git(fx.dir, 'commit', '-q', '-am', 'two');
      const r = fx.run(redactBlock(), fx.dir, { BASE });
      assert.equal(r.status, 0, r.stderr);
      const j = redactOut(fx, r);
      assert.equal(j.replaced, 0);
      assert.match(j.text, /\+two/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('medium: a BASE that does not resolve is reported, never an empty clean result, and the temp file is removed', () => {
    const fx = kitRepo();
    try {
      const r = fx.run(redactBlock(), fx.dir, { BASE: 'no-such-ref-0000' });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /BASE is not a commit/);
      assert.doesNotMatch(r.stdout, /"replaced"/);
      assert.deepEqual(readdirSync(fx.tmp), [], 'temp file left behind');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('high: the base block resolves the merge-base with the upstream, so the redact diff covers every session commit', () => {
    const fx = kitRepo();
    try {
      const start = git(fx.dir, 'rev-parse', 'HEAD').trim();
      git(fx.dir, 'branch', 'up');
      git(fx.dir, 'branch', '-u', 'up');
      writeFileSync(path.join(fx.dir, 'a.txt'), 'one\nfirst-commit-line\n');
      git(fx.dir, 'commit', '-q', '-am', 'first');
      writeFileSync(path.join(fx.dir, 'b.txt'), 'second-commit-line\n');
      git(fx.dir, 'add', 'b.txt');
      git(fx.dir, 'commit', '-q', '-m', 'second');
      const b = fx.run(baseBlock());
      assert.equal(b.status, 0, b.stderr);
      const BASE = b.stdout.match(/^BASE=(\S+)$/m)[1];
      assert.equal(BASE, start);
      const r = fx.run(redactBlock(), fx.dir, { BASE });
      assert.equal(r.status, 0, r.stderr);
      const j = redactOut(fx, r);
      assert.match(j.text, /\+first-commit-line/);
      assert.match(j.text, /\+second-commit-line/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('high: with no upstream the base block falls back to the pre-handoff HEAD and says so', () => {
    const fx = kitRepo();
    try {
      const head = git(fx.dir, 'rev-parse', 'HEAD').trim();
      const b = fx.run(baseBlock());
      assert.equal(b.status, 0, b.stderr);
      assert.match(b.stdout, /no upstream \(diff-range printed the empty-tree id\): BASE is the pre-handoff HEAD/);
      assert.equal(b.stdout.match(/^BASE=(\S+)$/m)[1], head);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('high: the redact block with BASE unset reads nothing and says so', () => {
    const fx = kitRepo();
    try {
      const env = { BASE: '' };
      const r = fx.run(redactBlock(), fx.dir, env);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /BASE not set/);
      assert.doesNotMatch(r.stdout, /"replaced"/);
      assert.deepEqual(readdirSync(fx.tmp), [], 'temp file left behind');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});

describe('review round 3 fixes', () => {
  it('medium: MB is recorded before the branch push, and the main re-check reuses it', async () => {
    const src = await fs.readFile(path.join(KIT_SRC, 'push-gate.js'), 'utf-8');
    assert.match(src, /merge-base', 'HEAD', up\.stdout\.trim\(\)/, 'push-gate.js no longer keys the change id on the merge-base with @{upstream}');
    const s = phase3();
    const gate = s.indexOf('push-gate check;');
    const mb = s.indexOf('MB=$(git merge-base @{upstream} HEAD 2>/dev/null)');
    const push = s.indexOf('git push -u origin HEAD');
    const again = s.indexOf('push-gate check --base "$MB"');
    assert.ok(gate > 0 && mb > gate, 'MB not recorded after the branch gate check');
    assert.ok(push > mb, 'MB recorded after the branch push');
    assert.ok(again > push);
    assert.match(s, /a successful push moves the remote-tracking ref, so the merge-base becomes HEAD/);
    assert.match(s, /`MB` is empty: the branch check had no base, and the main check runs without `--base`/);
    assert.match(s, /returns the same earlier-review ask \("only an earlier review exists…"\), which goes to the relay \(CHECKPOINT 4\)/);
  });
  it('medium: the handoff unstages with git reset -q, checks its exit and names the paths still staged', () => {
    const h = handoff();
    assert.match(h, /`git reset -q -- <those paths>; RC=\$\?`/);
    assert.doesNotMatch(content, /git restore --staged --/);
    assert.match(h, /a non-zero exit means nothing was unstaged, so report "unstage failed \(exit \$RC\): still staged: <those paths>", naming each path/);
  });
  it('medium: a failed push stops Phase 3 (no merge, no main push, no clean-up) and is written into the summary', () => {
    const FAILED = '"not pushed — push failed (exit N): <first line of git\'s stderr>"';
    const s = phase3();
    assert.ok(s.includes('`git push -u origin HEAD; RC=$?`'));
    assert.ok(s.includes('`git push origin main; RC=$?`'));
    assert.match(s, /is a failed push: stop Phase 3 there \(no merge into main, no main push, no clean-up\)/);
    assert.ok(s.includes(`write ${FAILED} (N is \`$RC\`) into the Phase 4 summary`));
    assert.ok(s.includes(`no clean-up, and the summary says ${FAILED} for main`));
    assert.ok(s.indexOf('git push -u origin HEAD') < s.indexOf('merge to main'));
    assert.match(s, /never let the shell answer or bypass the owner's own permission prompt/);
    assert.ok(section('**Phase 4', '**ERROR HANDLING').includes(FAILED.slice(1, -1)));
    const e = errors();
    assert.ok(e.includes(`A failed push (a non-zero exit from \`git push\`, written ${FAILED}) is a stop beside them, not an error to work around: no merge, no main push and no clean-up after it`));
  });
  it('low: the redact block traps the temp file in a subshell; the claim names what the trap cannot catch', () => {
    const b = redactBlock();
    assert.match(b, /else \( D=\$\(mktemp/);
    const trap = b.indexOf(`[ -z "$D" ] || trap 'rm -f "$D" "$J"; [ -n "$KEEP" ] || rm -f "$R"' EXIT INT TERM`); // retargeted: D and J always, R only when not kept
    assert.ok(trap > b.indexOf('mktemp failed') && trap < b.indexOf('diff-range --base'), 'trap not set right after the mktemp guard');
    assert.match(b, /exit \$RC \); RC=\$\?; \(exit \$RC\); fi\s*$/);
    const p = phase1();
    assert.doesNotMatch(p, /The temp file is removed on every path\./);
    assert.match(p, /Only a SIGKILL, which no trap can catch, can leave it behind/);
  });
  it('low: the subshell trap leaves the caller\'s D and EXIT trap alone', () => {
    const fx = kitRepo();
    try {
      const keep = path.join(fx.root, 'keep');
      writeFileSync(keep, 'x');
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      const r = fx.run(`D=${JSON.stringify(keep)}; trap 'echo caller-trap' EXIT\n${redactBlock()}\necho "D=$D"`, fx.dir, { BASE });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes(`D=${keep}`));
      assert.match(r.stdout, /caller-trap/);
      assert.deepEqual(readdirSync(fx.root).includes('keep'), true, 'the caller\'s file was deleted');
      assert.deepEqual(readdirSync(fx.tmp), [], 'temp file left behind');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});

describe('review round 4 fixes', () => {
  const CHECK = 'case "$BASE" in -*) echo "BASE is not a commit" >&2; RC=1; BASE=;; *) BASE=$(git rev-parse --verify -q "$BASE^{commit}") || { echo "BASE is not a commit" >&2; RC=1; BASE=; };; esac';
  const DR = 'node .claude/helpers/kit/cli.js diff-range --base "$BASE" --no-untracked > "$D"; RC=$?';
  it('medium: the range comes from diff-range in the redact block and Step 1; no bare git diff "$BASE" left', () => {
    for (const b of [checkpoint0(), handoff(), phase1(), phase2(), phase3()].flatMap(blocksOf)) assert.doesNotMatch(b, /git diff "\$BASE"/);
    assert.doesNotMatch(content.replaceAll('GIT_NO_LAZY_FETCH=1 GIT_TERMINAL_PROMPT=0 git diff --end-of-options "$BASE"', ''), /git diff (--end-of-options )?"\$BASE"/);
    const b = redactBlock();
    assert.ok(b.includes(DR));
    assert.match(b, /if \[ \$RC -eq 0 \]; then node \.claude\/helpers\/kit\/cli\.js redact --keep-lines < "\$D"/);
    assert.match(b, /elif \[ \$RC -eq 3 \]; then echo "no change to compound[^"]*"; RC=0/);
    assert.match(b, /elif \[ \$RC -eq 2 \]; then echo "diff-range refused \(exit 2, reason as printed\)/);
    assert.match(b, /else echo "diff-range failed \(exit \$RC\)/);
    const step1 = section('- **Step 1:**', '- **Step 2:**');
    assert.ok(step1.includes(`\`${DR}\``));
    assert.match(step1, /Exit 3 is an empty range: no change to compound/);
    assert.match(step1, /Exit 2 is a refusal \(a refused repository or driver, or a range over 32 MiB; a range whose git output passes 64 MiB is exit 1 instead\): report the reason as printed and stop that step/);
    assert.match(step1, /Exit 1 is bad input, a git failure or an unread change/);
    assert.match(step1, /Any other non-zero exit is a failure of the step/);
    assert.ok(step1.includes('Without the kit, fall back to `GIT_NO_LAZY_FETCH=1 GIT_TERMINAL_PROMPT=0 git diff --end-of-options "$BASE"` and say in one line that the kit\'s protections'));
    for (const s of [step1, phase1()]) assert.match(s, /diff-range never fetches and never prompts/);
    assert.match(phase1(), /exits 0; the solution doc is still written/);
  });
  it('medium: the redact rule covers ralph-candidates, memory exports and the commit message, said where each is written', () => {
    const RULE = 'the redact rule covers every write and commit that carries diff text: the solution doc, the RC-D/RC-F entries in `.claude/ralph-candidates.md`, memory exports, and the commit message; each takes only the redacted `text`';
    const p1 = phase1();
    const rc = p1.indexOf('- Append all to .claude/ralph-candidates.md');
    const rule1 = p1.indexOf(RULE);
    assert.ok(rc >= 0 && rule1 > rc && rule1 - rc < 200, 'redact-everywhere sentence not right after the ralph-candidates bullet');
    const p2 = phase2();
    const commit = p2.indexOf('git commit -m "<message>" -- <its own paths>');
    const rule2 = p2.indexOf(RULE.replace(/^t/, 'T'));
    assert.ok(commit >= 0 && rule2 > commit && rule2 - commit < 300, 'redact-everywhere sentence not at the commit message');
    assert.match(p1, /do \*\*not\*\* write the unredacted diff into the solution doc, `\.claude\/ralph-candidates\.md`, a memory export or the commit message/);
  });
  it('low: BASE is checked as a commit, and the resolved sha is used, before any range is read', () => {
    const b = redactBlock();
    assert.ok(b.includes(CHECK));
    assert.ok(b.indexOf(CHECK) < b.indexOf('diff-range --base'));
    assert.match(b, /if \[ -n "\$BASE" \]; then node \.claude\/helpers\/kit\/cli\.js diff-range/);
    const step1 = section('- **Step 1:**', '- **Step 2:**');
    assert.ok(step1.includes(CHECK) && step1.indexOf(CHECK) < step1.indexOf('diff-range --base'));
    assert.match(phase1(), /a value starting with `-` such as `--output=<path>` is refused before git sees it/);
  });
  it('empty range: exit 0, "no change to compound", nothing redacted, no temp file', () => {
    const fx = kitRepo();
    try {
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      const r = fx.run(redactBlock(), fx.dir, { BASE });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /no change to compound/);
      assert.doesNotMatch(r.stdout, /"replaced"/);
      assert.deepEqual(readdirSync(fx.tmp), [], 'temp file left behind');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('a BASE of --output=x: exit 1, "BASE is not a commit", no file x written', () => {
    const fx = kitRepo();
    try {
      for (const BASE of ['--output=x', '--output=x^{commit}']) {
        const r = fx.run(redactBlock(), fx.dir, { BASE });
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /BASE is not a commit/);
        assert.doesNotMatch(r.stdout, /"replaced"/);
        for (const d of [fx.dir, fx.root, fx.tmp]) assert.ok(!readdirSync(d).some(n => n.startsWith('x')), `file x written in ${d}`);
      }
      assert.deepEqual(readdirSync(fx.tmp), [], 'temp file left behind');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('a refused repository (include.path in .git/config): exit 2, reported, nothing redacted', () => {
    const fx = kitRepo();
    try {
      writeFileSync(path.join(fx.dir, 'a.txt'), 'one\ntwo\n');
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      git(fx.dir, 'commit', '-q', '-am', 'two');
      git(fx.dir, 'config', 'include.path', path.join(fx.root, 'nothing.cfg'));
      const r = fx.run(redactBlock(), fx.dir, { BASE });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /diff-range refused \(exit 2, reason as printed\)/);
      assert.doesNotMatch(r.stdout, /"replaced"/);
      assert.deepEqual(readdirSync(fx.tmp), [], 'temp file left behind');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('a diff-range failure (exit 1, or any other code) is reported, never an empty clean result', () => {
    const fx = kitRepo();
    try {
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      for (const code of [1, 5]) {
        writeFileSync(path.join(fx.dir, '.claude', 'helpers', 'kit', 'cli.js'), `if (process.argv[2] === 'diff-range') process.exit(${code}); process.stdout.write('{"replaced":0}');\n`);
        const r = fx.run(redactBlock(), fx.dir, { BASE });
        assert.equal(r.status, code, r.stderr);
        assert.match(r.stderr, new RegExp(`diff-range failed \\(exit ${code}\\)`));
        assert.doesNotMatch(r.stdout, /"replaced"/);
      }
      assert.deepEqual(readdirSync(fx.tmp), [], 'temp file left behind');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});

describe('review round 5 fixes', () => {
  const MBREC = 'MB=$(git merge-base @{upstream} HEAD 2>/dev/null); echo "MB=$MB"';
  const step1Text = () => section('- **Step 1:**', '- **Step 2:**');
  const step1Block = () => blocksOf(step1Text())[0];
  it('medium: MB is recorded and printed in one step, kept by the agent, and the main check drops --base when it is empty', () => {
    const s = phase3();
    assert.ok(s.includes(MBREC));
    assert.match(s, /keeps the printed sha and sets `MB=<sha>` in the shell that runs the main check/);
    assert.ok(s.includes('if [ -n "$MB" ]; then node .claude/helpers/kit/cli.js push-gate check --base "$MB"; else node .claude/helpers/kit/cli.js push-gate check; fi'));
    assert.ok(s.indexOf(MBREC) < s.indexOf('git push -u origin HEAD'));
    const r = spawnSync('bash', ['-c', MBREC], { encoding: 'utf-8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^MB=/);
  });
  it('medium: the redact block is the first Phase 1 step; Analyze and Append use the redacted text; no plain git diff in Phase 1', () => {
    const p = phase1();
    const red = p.indexOf('- **Redact first');
    const analyze = p.indexOf('- Analyze:');
    const append = p.indexOf('- Append all to');
    const storage = p.indexOf('- Storage:');
    assert.ok(red >= 0 && red < storage && red < analyze && red < append, 'redact block not first');
    assert.ok(p.indexOf('```bash') > red && p.indexOf('```bash') < analyze);
    assert.match(p, /- Analyze: read the redacted file `\$R` named in the redact block's summary line \(the range since `\$BASE`\)/);
    assert.match(p, /- Append all to \.claude\/ralph-candidates\.md \(redacted entries only/);
    assert.doesNotMatch(p, /git diff/);
    assert.doesNotMatch(p.replace(/```bash\n[\s\S]*?```/g, ''), /parse git diff/);
  });
  it('low: Step 1 defines its temp file with the mktemp guard, trap and subshell, and removes it', () => {
    const b = step1Block();
    assert.ok(b, 'no Step 1 block');
    assert.ok(b.includes('else ( D=$(mktemp 2>/dev/null) && [ -n "$D" ] ||'));
    assert.ok(b.includes(`trap 'rm -f "$D"' EXIT INT TERM`));
    assert.ok(b.includes('[ -z "$D" ] || rm -f "$D"'));
    assert.ok(b.indexOf('mktemp') < b.indexOf('> "$D"'));
    assert.match(step1Text(), /deletes `\$D` as soon as the category is detected/);
  });
  it('low: a stop names the ref, and the go path re-runs the main check, stopping on a deny and ignoring only an ask', () => {
    const c = checkpoint4();
    assert.match(c, /"not pushed \(branch\|main\) — gate asks: <reason>"/);
    assert.match(c, /a branch stop → push the branch, merge to main, run the main check, push main; a main stop → push main only/);
    assert.match(c, /the lead still runs the main re-check .* and stops on a deny there, ignoring only an ask/);
    assert.ok(phase3().includes('"not pushed (main) — gate asks: <reason>; MB=<sha>"')); // retargeted: the main-stop line now carries MB
    assert.ok(phase3().includes('"not pushed (main) — gate denied: <reason>"'));
    assert.ok(section('**Phase 4', '**ERROR HANDLING').includes('"not pushed (branch) — gate asks: <reason>", "not pushed (main) — gate asks: <reason>"'));
  });
  it('low: diff-range exit 2 is a refusal (repository, driver or 32 MiB), said once the same way, never only a refused repository', async () => {
    const src = await fs.readFile(path.join(KIT_SRC, 'diff-range.js'), 'utf-8');
    assert.match(src, /\(32 MiB\) is refused, exit 2/);
    const W = 'Exit 2 is a refusal (a refused repository or driver, or a range over 32 MiB; a range whose git output passes 64 MiB is exit 1 instead): report the reason as printed';
    assert.ok(step1Text().includes(W));
    assert.ok(phase1().includes(W));
    assert.ok(!content.includes('refused the repository'));
    assert.ok(!content.includes('Exit 2 is a refused repository'));
  });
  it('Step 1 block in the real kit: exits 0, prints a category, leaves no temp file', () => {
    const fx = kitRepo();
    try {
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      let r = fx.run(step1Block(), fx.dir, { BASE, ARG: '' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /CATEGORY=feature/);
      writeFileSync(path.join(fx.dir, 'a.txt'), 'one\nfix the auth token bug\nfix a crash error\n');
      git(fx.dir, 'commit', '-q', '-am', 'change');
      r = fx.run(step1Block(), fx.dir, { BASE, ARG: '' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /CATEGORY=bug/);
      r = fx.run(step1Block(), fx.dir, { BASE: '--output=x', ARG: '' });
      assert.equal(r.status, 0);
      assert.match(r.stderr, /BASE is not a commit/);
      assert.match(r.stdout, /CATEGORY=feature/);
      r = fx.run(step1Block(), fx.dir, { BASE, ARG: 'perf' });
      assert.match(r.stdout, /CATEGORY=perf/);
      assert.deepEqual(readdirSync(fx.tmp), [], 'temp file left behind');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('Step 1: diff-range exit 2 (include.path in .git/config) prints the refusal and falls back to feature', () => {
    const fx = kitRepo();
    try {
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      writeFileSync(path.join(fx.dir, 'a.txt'), 'one\nfix the auth token bug\n');
      git(fx.dir, 'commit', '-q', '-am', 'change');
      git(fx.dir, 'config', 'include.path', '../extra.cfg');
      const r = fx.run(step1Block(), fx.dir, { BASE, ARG: '' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /diff-range refused \(exit 2/);
      assert.match(r.stdout, /CATEGORY=feature/);
      assert.deepEqual(readdirSync(fx.tmp), [], 'temp file left behind');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('Step 1: diff-range exit 1 (stub kit) prints the failure and falls back to feature', () => {
    const fx = kitRepo();
    try {
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      writeFileSync(path.join(fx.dir, '.claude', 'helpers', 'kit', 'cli.js'), 'console.error("stub: git failed"); process.exit(1);\n');
      const r = fx.run(step1Block(), fx.dir, { BASE, ARG: '' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /diff-range failed \(exit 1/);
      assert.match(r.stdout, /CATEGORY=feature/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('Step 1: a path containing "auth" with plain added lines is feature (+++ headers are not scored)', () => {
    const fx = kitRepo();
    try {
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      mkdirSync(path.join(fx.dir, 'auth-token'));
      writeFileSync(path.join(fx.dir, 'auth-token', 'secret-cache-error.txt'), 'plain\nlines\n');
      git(fx.dir, 'add', '.');
      git(fx.dir, 'commit', '-q', '-m', 'plain');
      const r = fx.run(step1Block(), fx.dir, { BASE, ARG: '' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /CATEGORY=feature/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('round 6 wording: fallback pointer, 64 MiB exit 1, headers skipped, MB handed to the lead', async () => {
    assert.ok(step1Block().includes("use the git diff fallback in Step 1's text"));
    assert.ok(!step1Block().includes('fallback below'));
    assert.match(step1Text(), /same keyword weights on the fallback's added lines/);
    const dr = await fs.readFile(path.join(KIT_SRC, 'diff-range.js'), 'utf-8');
    const pg = await fs.readFile(path.join(KIT_SRC, 'push-gate.js'), 'utf-8');
    assert.match(dr, /\(32 MiB\)/);
    assert.match(pg, /maxBuffer: 64 \* 1024 \* 1024/);
    assert.ok(step1Text().includes('a range whose git output passes 64 MiB is exit 1 instead'));
    assert.ok(phase1().includes('a range whose git output passes 64 MiB is exit 1 instead'));
    assert.ok(step1Block().includes('/^[+][+][+] /{next}')); // retargeted: the headers are skipped inside the one awk pass
    assert.match(step1Text(), /file headers are skipped/);
    const c = checkpoint4();
    assert.match(c, /on a branch stop the agent never pushed, so the lead records `MB` itself with Phase 3's record line/);
    assert.match(c, /on a main stop the agent's summary line carries it, "not pushed \(main\) — gate asks: <reason>; MB=<sha>"/);
  });
});

describe('review round 7 fixes', () => {
  const step1Text = () => section('- **Step 1:**', '- **Step 2:**');
  const step1Block = () => blocksOf(step1Text())[0];
  it('medium: the redact block writes the redacted text to a file and prints one summary line; the prose reads it in chunks and removes it', () => {
    const b = redactBlock();
    assert.match(b, /redact --keep-lines < "\$D" > "\$J"/);
    assert.ok(b.includes('writeFileSync(process.argv[2],j.text)'));
    assert.ok(b.includes('console.log("replaced="+j.replaced+" bytes="+Buffer.byteLength(j.text)+" file="+process.argv[2])'));
    const p = phase1();
    assert.match(p, /exactly one summary line, `replaced=<n> bytes=<n> file=<path>`/);
    assert.ok(p.includes("`grep -n '^diff --git' \"$R\"` then `sed -n 'a,bp' \"$R\"`"));
    assert.ok(p.includes('At the end of Phase 1 run `rm -f "$R"`'));
    assert.match(p, /a killed shell leaves it in `\$TMPDIR` \(mode 0600\), and the lead's Phase 4 summary names it if it was not removed/);
  });
  it('medium: a large range never reaches stdout; failure and empty-range paths leave no file', () => {
    const fx = kitRepo();
    try {
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      writeFileSync(path.join(fx.dir, 'a.txt'), 'one\n' + 'line of added text\n'.repeat(5000));
      git(fx.dir, 'commit', '-q', '-am', 'big');
      const r = fx.run(redactBlock(), fx.dir, { BASE });
      const j = redactOut(fx, r);
      assert.ok(r.stdout.length < 200, 'stdout carries more than the summary line');
      assert.ok(j.text.length > 50000);
      assert.equal(existsSync(j.file) && (statSync(j.file).mode & 0o777), 0o600);
      const none = fx.run(redactBlock(), fx.dir, { BASE: git(fx.dir, 'rev-parse', 'HEAD').trim() });
      assert.equal(none.status, 0, none.stderr);
      assert.doesNotMatch(none.stdout, /file=/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
  it('low: Step 1 counts the five categories in one awk pass, same patterns and weights, POSIX only', () => {
    const b = step1Block();
    assert.equal((b.match(/grep -ciE/g) || []).length, 0);
    assert.equal((b.match(/awk /g) || []).length, 1);
    assert.ok(b.includes('tolower($0)'));
    assert.doesNotMatch(b, /IGNORECASE/);
    for (const pat of ['secret|token|password|auth|csrf|xss|inject', 'fix|bug|error|crash|regress', 'perf|cache|latency|optimi|throughput', 'refactor|architect|interface|module|abstract', 'add|new|feature|support']) {
      assert.ok(b.includes(`^[+].*(${pat})`), pat);
    }
    assert.ok(b.includes('[ $((SEC * 3)) -gt $BEST ]') && b.includes('[ $((BUG * 2)) -gt $BEST ]'));
    assert.match(step1Text(), /counted for all five categories in one pass/);
  });
  it('low: Step 1 one-pass scoring still gives security, bug and feature (upper case counts)', () => {
    const fx = kitRepo();
    try {
      const BASE = git(fx.dir, 'rev-parse', 'HEAD').trim();
      const cat = body => {
        writeFileSync(path.join(fx.dir, 'a.txt'), `one\n${body}`);
        git(fx.dir, 'commit', '-q', '-am', 'c');
        const r = fx.run(step1Block(), fx.dir, { BASE, ARG: '' });
        assert.equal(r.status, 0, r.stderr);
        return r.stdout.match(/CATEGORY=(\S+)/)[1];
      };
      assert.equal(cat('The PASSWORD check\nCSRF guard\n'), 'security');
      assert.equal(cat('one\nFix a Crash\nBug in loop\n'), 'bug');
      assert.equal(cat('one\nplain text\n'), 'feature');
      assert.deepEqual(readdirSync(fx.tmp), [], 'temp file left behind');
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});
