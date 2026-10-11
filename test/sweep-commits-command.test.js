import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHORTCUTS_DIR = path.join(__dirname, '..', '.claude', 'commands', '.shortcuts');
const commands = getCommands();

const NO_KIT = (what) => new RegExp(`kit not installed \\(\\.claude/helpers/kit/cli\\.js missing\\): ${what} skipped, advisory`);
const section = (name, from, to) => {
  const c = commands[name].content;
  const a = c.indexOf(from);
  assert.ok(a >= 0, `${name}: missing ${from}`);
  const b = to ? c.indexOf(to, a + from.length) : c.length;
  assert.ok(b > a, `${name}: missing ${to}`);
  return c.slice(a, b);
};

// Every analysis step: lenses (and impact where a review step exists), the guard, every exit code named.
const assertAnalysis = (s, { impact }) => {
  assert.match(s, /Code Analysis/);
  assert.match(s, NO_KIT('step'));
  assert.match(s, /diff-range > "\$D"; RC=\$\?/);
  assert.match(s, /lenses --diff "\$D"; RC=\$\?;; 3\) echo "no change to review"/);
  assert.match(s, /\*\) echo "diff-range failed \(exit \$RC\)/);
  if (impact) {
    assert.match(s, /diff-range --base-only/);
    assert.match(s, /impact --diff "\$D" --base "\$B"/);
    assert.match(s, /removed_with_live_callers/);
  } else {
    assert.ok(!/impact --diff/.test(s), 'lenses only here');
  }
  assert.match(s, /Exit 3 from `diff-range` means an empty range/);
  assert.match(s, /Exit 1 is wrong input or a broken state/);
  assert.match(s, /Exit 2 is a refusal/);
  assert.match(s, /Any other non-zero exit \(for example 127, or a signal\) is a failure of that step: report it, never read it as nothing found/);
  assert.match(s, /mktemp failed/);
  assert.ok(!s.slice(s.indexOf('Code Analysis')).split('\n### ')[0].includes('\\`'), 'no backslash-backtick in the wired text');
};

// Scrub then receipt, in that order, with every exit code named.
const assertClosing = (s) => {
  assert.match(s, NO_KIT('scrub'));
  assert.match(s, /scrub --worktree; RC=\$\?/);
  assert.match(s, /Exit 2 means hits or an incomplete scan/);
  assert.match(s, /Exit 1 is wrong input or a broken state/);
  assert.match(s, NO_KIT('receipt'));
  assert.match(s, /push-gate receipt --verdict pass --high 0 --medium 0 --low 0/);
  assert.match(s, /push-gate receipt --verdict fail --high \d+ --medium \d+ --low \d+/);
  assert.ok(!s.includes('pass|fail'));
  assert.ok(s.indexOf('scrub --worktree') < s.indexOf('push-gate receipt'));
  assert.match(s, /exit 1 is wrong input or a broken state and exit 2 a refused receipt store/);
  assert.match(s, /push-gate check/);
  assert.match(s, /none is an allow/);
  assert.match(s, /never skips their permission prompt/);
  assert.ok(!s.includes('\\`'));
};

const assertScrubBeforeCommit = (s) => {
  assert.match(s, /Scrub before the commit/);
  assert.match(s, /`git add` the .* first/);
  assert.match(s, NO_KIT('scrub'));
  assert.match(s, /scrub --worktree; RC=\$\?/);
  assert.match(s, /Exit 0 is clean for the tracked files/);
  assert.match(s, /Exit 2 means hits or an incomplete scan: list them as printed and \*\*do not commit\*\*/);
  assert.match(s, /Exit 1 is wrong input or a broken state: report it, never read it as clean, do not commit/);
  assert.match(s, /Any other non-zero exit is a failure of the step: report it, do not commit/);
  assert.match(s, /git reset -q -- <those paths>; RC=\$\?/);
  const w = s.slice(s.indexOf('Scrub before the commit'));
  assert.ok(!w.slice(0, w.indexOf('git reset -q')).includes('\\`'));
};

describe('repo copies of the eight swept shortcuts equal the generator output', () => {
  for (const name of ['w-tdd-swarm', 'w-agent-tdd-swarm', 'w-debug', 'w-hotfix', 'w-security', 'w-end', 'w-ralph-pick', 'w-autoresearch']) {
    it(`${name}.md equals getCommands()`, async () => {
      const md = await fs.readFile(path.join(SHORTCUTS_DIR, `${name}.md`), 'utf-8');
      assert.equal(md, commands[name].content);
    });
  }
});

describe('review workflows: lenses and impact at the review step, scrub and receipt at the close', () => {
  const cases = [
    ['w-tdd-swarm', '### ⛔ CHECKPOINT 5: Review', '### ✅ VERIFICATION CHECKPOINT', '### ⛔ CHECKPOINT 6: Compound'],
    ['w-debug', '### ⛔ CHECKPOINT 6: Review', '### ✅ VERIFICATION CHECKPOINT', '### ⛔ CHECKPOINT 7: Compound'],
    ['w-hotfix', '### ⛔ CHECKPOINT 3: Security Review', '### ⛔ CHECKPOINT 4: Compound', '### ⛔ CHECKPOINT 4: Compound'],
    ['w-security', '### ⛔ CHECKPOINT 2: Analysis Done', '### ✅ VERIFICATION CHECKPOINT', '### ⛔ CHECKPOINT 3: Compound'],
  ];
  for (const [name, review, reviewEnd, compound] of cases) {
    it(`${name}: lenses and impact inside the review checkpoint`, () => {
      const s = section(name, review, reviewEnd);
      assertAnalysis(s, { impact: true });
    });
    it(`${name}: scrub, then receipt, before Compound`, () => {
      const c = commands[name].content;
      const a = c.indexOf('### 🔒 CLOSING STEP: Scrub and receipt');
      const b = c.indexOf(compound);
      assert.ok(a >= 0 && b > a, 'closing step sits before Compound');
      assertClosing(c.slice(a, b));
    });
  }
});

describe('w-agent-tdd-swarm', () => {
  it('lenses and impact inside the verification checkpoint', () => {
    assertAnalysis(section('w-agent-tdd-swarm', '### ✅ VERIFICATION CHECKPOINT', '### PHASE 7'), { impact: true });
  });
  const phase7 = () => section('w-agent-tdd-swarm', '### PHASE 7: Commit & PR', '**AUTO-PROCEED:** Continue to Compound');
  it('scrubs before the commit, records the receipt after it, checks before the push', () => {
    const s = phase7();
    assertScrubBeforeCommit(s);
    const iAdd = s.indexOf('git add -A');
    const iScrub = s.indexOf('scrub --worktree');
    const iCommit = s.indexOf('3. Commit with descriptive message');
    const iReceipt = s.indexOf('push-gate receipt --verdict pass');
    const iCheck = s.indexOf('push-gate check; RC=$?');
    const iPush = s.indexOf('git push -u origin HEAD');
    const iPr = s.indexOf('gh pr create');
    assert.ok(iAdd >= 0 && iAdd < iScrub && iScrub < iCommit && iCommit < iReceipt && iReceipt < iCheck && iCheck < iPush && iPush < iPr);
  });
  it('names every receipt and push-gate check exit code, and stays advisory', () => {
    const s = phase7();
    assert.match(s, NO_KIT('receipt'));
    assert.match(s, NO_KIT('push-gate check'));
    assert.match(s, /exit 1 is wrong input or a broken state and exit 2 a refused receipt store/);
    assert.match(s, /Exit 0 with decision `abstain`: the push goes on/);
    assert.match(s, /starting "no review recorded for this change": the push goes on/);
    assert.match(s, /any other `ask`.*\*\*not pushed\*\*/);
    assert.match(s, /Exit 2 is a deny .*\*\*not pushed\*\*/);
    assert.match(s, /`kit: refused:` on stderr/);
    assert.match(s, /Exit 1 is an error: report it and do not push/);
    assert.match(s, /Any other non-zero exit is a failure of the step: report it and do not push/);
    assert.match(s, /only abstains, asks or denies, and it never allows, skips or answers the owner's own permission prompt/);
    assert.ok(!s.includes('\\`'));
  });
});

describe('w-end', () => {
  it('scrubs the staged session files before the commit', () => {
    const s = section('w-end', '### ⛔ CHECKPOINT 2: Commit', 'STOP and wait');
    assertScrubBeforeCommit(s);
    assert.ok(s.indexOf('scrub --worktree') < s.indexOf('- Commit message: _____'));
    assert.match(s, /not `git add -A`/);
    assert.match(s, /Commit only after the scrub exited 0 \(or the kit is not installed\)/);
  });
});

describe('w-autoresearch', () => {
  it('puts the scrub in the background dispatch before every Keep commit', () => {
    const s = section('w-autoresearch', '### ⛔ CHECKPOINT 3: Background Dispatch', '## State Files');
    assertScrubBeforeCommit(s);
    assert.ok(s.indexOf('**Keep:**') < s.indexOf('Scrub before the commit'));
    assert.match(s, /Keep:\*\* metric improved → run the scrub below, then `git commit`/);
    assert.match(s, /a scrub refusal means no commit/);
    assert.match(s, /background agent's prompt/);
  });
});

describe('w-ralph-pick', () => {
  it('runs lenses only at Completion Verification', () => {
    const s = section('w-ralph-pick', '### ⛔ CHECKPOINT 4: Completion Verification', '### ⛔ CHECKPOINT 5');
    assertAnalysis(s, { impact: false });
  });
  it('does not commit, so adds no scrub', () => {
    assert.ok(!/scrub --worktree/.test(commands['w-ralph-pick'].content));
  });
});

describe('sweep-commits round 1 review fixes', () => {
  const six = [
    ['w-tdd-swarm', true], ['w-agent-tdd-swarm', true], ['w-debug', true],
    ['w-hotfix', true], ['w-security', true], ['w-ralph-pick', false],
  ];
  for (const [name] of six) {
    it(`${name}: the range sentence covers the no-upstream case`, () => {
      const c = commands[name].content;
      const s = c.slice(c.indexOf('Code Analysis ('));
      if (name === 'w-ralph-pick') {
        assert.match(s, /the whole history when there is no upstream; no removal check runs in this workflow \(lenses only\)\)/);
        assert.ok(!s.includes('removed_with_live_callers'));
      } else {
        assert.match(s, /the whole history when there is no upstream: then `removed_with_live_callers` cannot find removals, so say the removal check did not run\)/);
      }
      assert.ok(!c.includes('review output below'));
    });
  }
  for (const name of ['w-tdd-swarm', 'w-debug', 'w-security', 'w-hotfix']) {
    it(`${name}: lens findings go to the review findings above`, () => {
      assert.match(commands[name].content, /add its findings to the review findings above/);
    });
  }
  it('w-agent-tdd-swarm: lens findings sentence points above', () => {
    assert.match(commands['w-agent-tdd-swarm'].content, /add its findings to the review findings above/);
  });
  it('w-ralph-pick: CP4 REQUIRED OUTPUT has a Lens findings line', () => {
    const s = section('w-ralph-pick', '### ⛔ CHECKPOINT 4: Completion Verification', '**🔎 Code Analysis');
    assert.match(s, /\*\*REQUIRED OUTPUT:\*\*[\s\S]*- Lens findings: _____/);
  });

  it('w-end: the gate is conditional, with no push option after a scrub refusal', () => {
    const s = section('w-end', '**USER GATE:** Use AskUserQuestion. The gate depends on the scrub result', '## What Gets Captured');
    assert.match(s, /After a scrub refusal \(nothing was committed\): Question: "Not committed: scrub refused\. Fix and retry\?" Options: \["Fix and retry", "Done without committing"\]\. There is no push option on this path\./);
    assert.match(s, /On the normal path: Question: "Commit complete\. Session ended\. Run \/w-start to resume later\." Options: \["Done", "Push to remote"\]/);
    const refusal = s.slice(s.indexOf('After a scrub refusal'), s.indexOf('On the normal path'));
    assert.ok(!refusal.includes('Push to remote'));
  });
  it('w-end: Push to remote runs the guarded push-gate check, every exit named', () => {
    const c = commands['w-end'].content;
    const s = c.slice(c.indexOf('**On "Push to remote"'), c.indexOf('## What Gets Captured'));
    assert.match(s, NO_KIT('push-gate check'));
    assert.match(s, /push-gate check; RC=\$\?/);
    assert.ok(s.indexOf('push-gate check; RC=$?') < s.indexOf('git push -u origin HEAD'));
    assert.match(s, /Exit 0 with decision `abstain`: push/);
    assert.match(s, /starting "no review recorded for this change": the push goes on/);
    assert.match(s, /any other `ask` \([^)]*\): \*\*not pushed\*\*; only the "no review recorded" ask lets the push go on/);
    assert.match(s, /Exit 2 is a deny .*\*\*not pushed\*\*/);
    assert.match(s, /`kit: refused:` on stderr/);
    assert.match(s, /Exit 1 is an error: report it and do not push/);
    assert.match(s, /Any other non-zero exit is a failure of the step: report it and do not push/);
    assert.match(s, /never allows, skips or answers the owner's own permission prompt/);
    assert.ok(!s.includes('\\`'));
  });

  it('w-agent-tdd-swarm step 4: failed receipt means not pushed, with the verdict rule', () => {
    const c = commands['w-agent-tdd-swarm'].content;
    const s = c.slice(c.indexOf('4. Record the review receipt'), c.indexOf('5. Run the push gate'));
    assert.match(s, /`--verdict fail` when any high finding is open, else `--verdict pass`, always with the real counts/);
    assert.match(s, /Any other non-zero exit is a failure of the step: name the exit code/);
    assert.match(s, /"not pushed: receipt not recorded \(exit N\)"/);
    assert.match(s, /skip step 5 and the push/);
  });

  it('no generated copy carries the broken Pi Brain curl line, and the fixed line is valid bash', () => {
    const broken = /memories\/search "\[[^\]]*\]" --top-k=3/;
    let fixed = 0;
    for (const [name, cmd] of Object.entries(commands)) {
      assert.ok(!broken.test(cmd.content), `${name}: broken Pi Brain curl line`);
      assert.ok(!cmd.content.includes('# npm client (preferred)'), `${name}: mislabelled curl`);
      for (const m of cmd.content.matchAll(/^curl -s -G "https:\/\/pi\.ruv\.io\/v1\/memories\/search".*$/gm)) {
        fixed++;
        const r = spawnSync('bash', ['-n'], { input: m[0] + '\n', encoding: 'utf-8' });
        assert.equal(r.status, 0, `${name}: bash -n failed: ${r.stderr}`);
      }
    }
    assert.ok(fixed > 0);
  });
  it('no repo copy carries the broken Pi Brain curl line', async () => {
    for (const f of await fs.readdir(SHORTCUTS_DIR)) {
      const md = await fs.readFile(path.join(SHORTCUTS_DIR, f), 'utf-8');
      assert.ok(!/memories\/search "\[[^\]]*\]" --top-k=3/.test(md), `${f}: broken Pi Brain curl line`);
    }
  });

  it('w-end: Checkpoint 1 ends with AUTO-PROCEED to the Commit phase', () => {
    const s = section('w-end', '### ⛔ CHECKPOINT 1: Compound', '### ⛔ CHECKPOINT 2: Commit');
    assert.match(s, /RALPH CANDIDATE CHECK[\s\S]*\*\*AUTO-PROCEED:\*\* Continue to Commit phase\./);
  });
});

describe('sweep-commits round 2 review fixes', () => {
  it('w-agent-tdd-swarm step 5 and w-end: the earlier-review ask is described correctly and stays not pushed', () => {
    const c = commands['w-agent-tdd-swarm'].content;
    const e = commands['w-end'].content;
    const parts = [
      c.slice(c.indexOf('5. Run the push gate'), c.indexOf('6. Push branch')),
      e.slice(e.indexOf('**On "Push to remote"'), e.indexOf('## What Gets Captured')),
    ];
    for (const s of parts) {
      assert.match(s, /"only an earlier review exists, for a different version of this change"/);
      assert.match(s, /another branch or change in the same repository/);
      assert.match(s, /\*\*not pushed\*\*; only the "no review recorded" ask lets the push go on/);
      assert.match(s, /run \/w-review \(or record a receipt\) on the current change and rerun the check/);
      assert.ok(!/a review of an earlier version/.test(s));
    }
  });

  it('w-agent-tdd-swarm: the not-pushed case is reported in Phase 7, Phase 9, the notify line, rules and checklist', () => {
    const c = commands['w-agent-tdd-swarm'].content;
    const p7 = c.slice(c.indexOf('### PHASE 7'), c.indexOf('### PHASE 8'));
    assert.match(p7, /\*\*REQUIRED OUTPUT:\*\*[\s\S]*- Push: pushed \/ not pushed — <reason>[\s\S]*- PR URL: _____ \(or none when not pushed\)/);
    const p9 = c.slice(c.indexOf('### PHASE 9'), c.indexOf('## Completion Checklist'));
    assert.match(p9, /- Push: pushed \/ not pushed — <reason>/);
    assert.match(p9, /Agent \{id\} finished: pushed PR \{url\} \| not pushed — \{reason\}\. Report:/);
    assert.ok(!c.includes('Agent {id} completed. PR:'));
    assert.match(c, /ALWAYS create a PR at the end with `gh pr create --fill` when the push gate lets the push go on; otherwise report "not pushed — <reason>" and create none/);
    assert.match(c, /- \[ \] PR created with `gh pr create --fill`, or "not pushed — <reason>" reported/);
  });

  const scrubNames = ['w-end', 'w-agent-tdd-swarm', 'w-autoresearch'];
  for (const name of scrubNames) {
    it(`${name}: no unstaged changes to the staged paths before the scrub, and why`, () => {
      const c = commands[name].content;
      const i = c.indexOf('**Scrub before the commit:**') >= 0 ? c.indexOf('**Scrub before the commit:**') : c.indexOf('2. **Scrub before the commit:**');
      assert.ok(i >= 0);
      const s = c.slice(i, c.indexOf('scrub --worktree; RC=$?', i));
      assert.match(s, /run a plain `git diff --quiet` with no path \(exit 0 means none\)/);
      assert.ok(!s.includes('<the staged paths>'), 'the check covers the whole index, not only the paths just staged');
      if (name === 'w-agent-tdd-swarm') assert.ok(!/git diff --quiet -- /.test(s), 'no path-limited diff check');
      assert.match(s, /Check the whole index, not only the paths just staged: `git commit` commits everything staged, by anyone, earlier included/);
      assert.match(s, /reads each file's content from disk but git commits the index, so the two must agree/);
      if (name === 'w-agent-tdd-swarm') {
        assert.match(s, /Exit 1 means unstaged changes: re-stage the paths `git diff --name-only` lists \(`git add`\) and check once more before the scrub/);
        assert.match(s, /any other exit \(128 and above\) is a git error: report it and do not commit\./);
        assert.ok(!c.includes('AskUserQuestion'), 'the swarm has no user gate');
      } else if (name === 'w-autoresearch') {
        assert.match(s, /Exit 1 means unstaged changes: re-stage the paths `git diff --name-only` lists \(`git add`\) and check once more before the scrub; with the clean-tree precondition every one of them is the experiment's own, so list the three path lists again and save them in place of the earlier ones\./);
        assert.match(s, /Any other exit \(128 and above\) is a git error: report it and do not commit\./);
        assert.ok(!/git diff --quiet -- /.test(s), 'no path-limited diff check');
        assert.ok(!/leave it unstaged|leave other paths unstaged/.test(c), 'no leave-unstaged branch: the clean-tree precondition leaves nothing else');
        assert.ok(!/re-stage \(`git add`\) only the paths that appear in both/.test(s));
      } else {
        assert.match(s, /Exit 1 means unstaged changes: re-stage \(`git add`\) only the paths that appear in both `git diff --name-only` and `git diff --cached --name-only`/);
        assert.match(s, /For any other path `git diff --name-only` lists, do not run `git add` on it: /);
        assert.match(s, /`git diff --quiet -- \$\(git diff --cached --name-only\)` over the staged paths only|as `git diff --quiet -- \$\(git diff --cached --name-only\)`/);
        assert.match(s, /Any other exit \(128 and above\) is a git error: report it and do not commit\./);
      }
      if (name === 'w-end') {
        assert.match(s, /AskUserQuestion: "Unstaged edits in <paths> are not part of this session's files\. Include them, leave them out, or stop\?" with options \["Leave them out and commit", "Include them", "Stop"\]/);
        assert.match(s, /"Leave them out and commit" means the check is run as `git diff --quiet -- \$\(git diff --cached --name-only\)` over the staged paths only/);
      }
      if (name === 'w-end') {
        assert.match(s, /run the block with that command in place of its first `git diff --quiet`, so the scrub still runs only when that check exits 0\./);
      }
      if (name === 'w-autoresearch') {
        assert.ok(!s.includes('AskUserQuestion'));
      }
      assert.match(s, /The block below runs the scrub only when this check exits 0: on exit 1 it prints the message, runs no scrub and exits 1, on 128 and above it runs no scrub and exits with that code, so after the re-stage run the whole block again \(never only its scrub line\) and commit only when that run exits 0\./);
      assert.match(s, /If the re-check still exits non-zero, report it and do not commit\./);
      const q = s.indexOf('git diff --quiet');
      const r = s.indexOf('If the re-check still exits non-zero');
      assert.ok(q >= 0 && r > q, 'the diff check and its exit rules come before the scrub run (s ends at it)');
      const blk = c.indexOf('```bash', i);
      const dq = c.indexOf('git diff --quiet; D=$?; if [ $D -eq 1 ]; then echo "unstaged changes: ', blk);
      const sc = c.indexOf('scrub --worktree; RC=$?', blk);
      const endBlk = c.indexOf('```', blk + 7);
      assert.ok(blk >= 0 && dq > blk && dq < sc && sc < endBlk, 'the whole-index check is inside the fenced block before the scrub');
      const chain = c.slice(dq, c.indexOf('\n', sc));
      assert.ok(!c.slice(dq, sc).includes('\n'), 'the check and the scrub are one if-chain on one line');
      assert.match(chain, /then run this block again"; \(exit 1\); elif \[ \$D -ne 0 \]; then echo "git error \(exit \$D\): do not commit"; \(exit \$D\); elif \[ ! -f \.claude\/helpers\/kit\/cli\.js \]; then echo "kit not installed \(\.claude\/helpers\/kit\/cli\.js missing\): scrub skipped, advisory"; \(exit 0\); else node \.claude\/helpers\/kit\/cli\.js scrub --worktree; RC=\$\?; \(exit \$RC\); fi$/);
    });

    it(`${name}: with index and disk differing the block exits 1 and runs no scrub, with and without the kit`, async () => {
      const os = await import('os');
      const c = commands[name].content;
      const i = c.indexOf('**Scrub before the commit:**');
      const blk = c.indexOf('```bash\n', i) + 8;
      const code = c.slice(blk, c.indexOf('\n```', blk));
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep6-'));
      try {
        const git = (...a) => { const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
        git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
        await fs.writeFile(path.join(dir, 'a'), 'a\n'); git('add', 'a'); git('commit', '-qm', 'init');
        await fs.writeFile(path.join(dir, 'a'), 'staged\n'); git('add', 'a');
        await fs.writeFile(path.join(dir, 'a'), 'disk differs\n');
        for (const kit of [false, true]) {
          const marker = path.join(dir, 'SCRUB_RAN');
          if (kit) {
            await fs.mkdir(path.join(dir, '.claude', 'helpers', 'kit'), { recursive: true });
            await fs.writeFile(path.join(dir, '.claude', 'helpers', 'kit', 'cli.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); process.exit(0);\n`);
          }
          const r = spawnSync('bash', ['-c', code], { cwd: dir, encoding: 'utf8' });
          assert.equal(r.status, 1, `kit=${kit}: exit ${r.status}, ${r.stdout}${r.stderr}`);
          assert.match(r.stdout, /^unstaged changes: /);
          await assert.rejects(fs.access(marker), `kit=${kit}: the scrub must not run`);
        }
        await fs.writeFile(path.join(dir, '.claude', 'helpers', 'kit', 'cli.js'), `process.exit(0);\n`);
        git('add', 'a');
        const ok = spawnSync('bash', ['-c', code], { cwd: dir, encoding: 'utf8' });
        assert.equal(ok.status, 0, 'a clean check runs the scrub and takes its exit');
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  }

  for (const name of ['w-tdd-swarm', 'w-debug', 'w-hotfix', 'w-security']) {
    it(`${name}: closing step ties the receipt to the scrub and names other exits`, () => {
      const c = commands[name].content;
      const a = c.indexOf('scrub --worktree; RC=$?');
      const s = c.slice(a, c.indexOf('push-gate check', a));
      assert.match(s, /Exit 2 means hits or an incomplete scan: list them as printed and do not commit\./);
      assert.match(s, /Exit 1 is wrong input or a broken state: report it, never read it as clean, do not commit\./);
      assert.match(s, /Any other non-zero exit is a failure of the step: report it, do not commit\./);
      assert.match(s, /After a scrub refusal or failure record no receipt \(skip the receipt commands below\) and continue to Compound\./);
      assert.ok(!/list them as printed and stop/.test(s));
      assert.match(s, /record the receipt again, only when a receipt was recorded before Compound,/);
      assert.match(s, /Any other non-zero exit is a failure of the step: name the exit code, never read it as recorded\./);
    });
  }

  it('w-autoresearch: a scrub refusal reverts only the experiment\'s paths and pauses after 3 in a row', () => {
    const s = commands['w-autoresearch'].content;
    const u = s.indexOf('git reset -q -- <the experiment\'s paths>');
    const k = s.indexOf('`git checkout -- <its tracked paths>` (only those, never `git checkout -- .`, which would also wipe edits that are not the experiment\'s; a new path in that list makes the whole checkout fail; with none, skip the checkout); if the experiment created new paths, `git clean -fd -- <those paths>`');
    assert.ok(u >= 0 && k > u, 'unstage comes before the scoped checkout and the clean');
    assert.ok(!s.replace(/never `git checkout -- \.`/g, '').includes('git checkout -- .'), 'git checkout -- . appears only as a prohibition');
    assert.equal(s.split('git checkout -- .').length - 1, (s.match(/never `git checkout -- \.`/g) || []).length, 'every git checkout -- . is a never');
    assert.match(s, /if the experiment created new paths, `git clean -fd -- <those paths>` so a refused new file does not stay on disk untracked and unscanned; with none, skip the clean; never run git clean without a path/);
    assert.ok(!s.includes("git clean -fd -- <the experiment's new paths>"), 'no unconditional clean over a possibly empty list');
    assert.ok(!/git clean -fd -- \.|git clean -fd`|git clean -fd;/.test(s), 'no pathless git clean');
    assert.match(s, /revert in this order: first unstage/);
    assert.match(s, /right after that `git add`, and before any `git reset`, list the experiment's paths with `git diff --cached --name-only --no-renames`, its new paths with `git diff --cached --name-only --no-renames --diff-filter=A` and its tracked paths \(all but the new ones\) with `git diff --cached --name-only --no-renames --diff-filter=a`, and save the three lists in the experiment's log entry \(`--no-renames` so a rename lists both its old and its new path/);
    assert.match(s, /by path \(never `git add -A` or `git add \.`: they would stage the loop's untracked state\)/);
    assert.match(s, /the clean-tree precondition means the index held nothing before this `git add`, so these lists are exactly the experiment's own paths and nobody else's/);
    assert.match(s, /<the experiment's paths> is the recorded list from `git diff --cached --name-only --no-renames`, <its tracked paths> the recorded list from `git diff --cached --name-only --no-renames --diff-filter=a` and <those paths> the recorded list of new paths from `git diff --cached --name-only --no-renames --diff-filter=A`/);
    assert.match(s, /log the hits, take the path lists recorded in the scrub step, revert in this order/);
    assert.match(s, /if the unstage failed, do not count it as reverted: report it and pause the loop \(create `\.autoresearch-off`\)/);
    assert.match(s, /After 3 consecutive scrub refusals pause the loop: create `\.autoresearch-off` and log why/);
    assert.match(s, /\*\*Discard:\*\* metric worse\/equal → revert the experiment's changes only: `git add` the files it changed by path, save the three path lists as in the scrub step, then revert in the same order as after a scrub refusal \(unstage, checkout of its tracked paths, guarded clean of its new paths\); never `git checkout -- \.`/);
    assert.match(s, /\*\*Crash:\*\* non-zero exit → log error, revert as for Discard/);
  });

  it('w-autoresearch: a clean-tree precondition before each experiment, else the loop pauses and touches nothing', () => {
    const s = commands['w-autoresearch'].content;
    const p = s.indexOf('**Before each experiment (clean-tree precondition):**');
    const t = s.indexOf('1. **Think:**');
    assert.ok(p >= 0 && t > p, 'the precondition comes before the loop\'s first step');
    assert.match(s, /run `git diff --quiet && git diff --cached --quiet` and `git ls-files --others --exclude-standard`\. The tree is clean when both diff checks exit 0 and the untracked list holds nothing but the loop's own state files/);
    assert.match(s, /If the tree is not clean \(a staged path, an unstaged edit or another untracked file, any of which may be someone else's work\), do not start the experiment and touch nothing \(no stash, reset, checkout or clean\): pause the loop \(create `\.autoresearch-off`\) and log why \("paused: tree not clean before experiment: <paths>"\)\. So the index only ever holds the experiment's own changes\./);
  });

  it('w-autoresearch: the precondition fails on a staged file and an unrelated edit, and the revert loses nothing else', async () => {
    const os = await import('os');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep6ar-'));
    const run = (cmd) => spawnSync('bash', ['-c', cmd], { cwd: dir, encoding: 'utf8' });
    const pre = 'git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard | grep -vxE \'autoresearch\\.jsonl|\\.autoresearch-off\')" ]';
    try {
      assert.equal(run('git init -q && git config user.email t@t && git config user.name t && echo a>a && echo b>b && echo z>z && git add . && git commit -qm init && echo st>autoresearch.jsonl').status, 0);
      assert.equal(run(pre).status, 0, 'only the loop state is untracked: clean');
      assert.equal(run('echo other>other && git add other && echo mine>b').status, 0);
      assert.notEqual(run(pre).status, 0, 'a staged file and an unrelated unstaged edit fail the precondition');
      assert.equal(run('cat other b').stdout, 'other\nmine\n', 'nothing is lost: the loop touches nothing');
      assert.equal(run('git diff --cached --name-only').stdout, 'other\n');
      assert.equal(run('git reset -q && rm other && git checkout -- b').status, 0);
      assert.equal(run(pre).status, 0);
      // experiment: modify a, delete b, new c, rename z -> z2; then the recorded revert
      const r = run([
        'echo exp>a && rm b && echo c>c && mv z z2 && git add -- a b c z z2',
        'P=$(git diff --cached --name-only --no-renames); N=$(git diff --cached --name-only --no-renames --diff-filter=A); T=$(git diff --cached --name-only --no-renames --diff-filter=a)',
        'git reset -q -- $P && git checkout -- $T && git clean -fd -- $N',
        'git status --porcelain',
      ].join('\n'));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout.split('\n').filter((l) => !l.startsWith('Removing')).join('\n'), '?? autoresearch.jsonl\n', 'tree back to clean, loop state kept');
      assert.equal(run('cat a b z').stdout, 'a\nb\nz\n');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
