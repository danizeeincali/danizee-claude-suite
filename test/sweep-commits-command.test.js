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
      assert.match(s, /git diff --quiet -- <the staged paths>/);
      assert.match(s, /reads each file's content from disk but git commits the index, so the two must agree/);
      assert.match(s, /if the check fails, re-stage those paths \(`git add`\)/);
      assert.ok(s.indexOf('git diff --quiet') >= 0);
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

  it('w-autoresearch: a scrub refusal reverts new files too and pauses after 3 in a row', () => {
    const s = commands['w-autoresearch'].content;
    const u = s.indexOf('git reset -q -- <the experiment\'s paths>');
    const k = s.indexOf('git checkout -- . && git clean -fd -- <the experiment\'s new paths>');
    assert.ok(u >= 0 && k > u, 'unstage comes before the checkout and clean');
    assert.match(s, /revert in this order: first unstage/);
    assert.match(s, /if the unstage failed, do not count it as reverted: report it and pause the loop \(create `\.autoresearch-off`\)/);
    assert.match(s, /After 3 consecutive scrub refusals pause the loop: create `\.autoresearch-off` and log why/);
  });
});
