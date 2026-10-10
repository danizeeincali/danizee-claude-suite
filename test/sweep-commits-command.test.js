import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
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
