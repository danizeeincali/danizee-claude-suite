import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHORTCUTS_DIR = path.join(__dirname, '..', '.claude', 'commands', '.shortcuts');
const content = getCommands()['w-plan-tdd-swarm'].content;
const FALLBACK = /If `\.claude\/helpers\/kit\/cli\.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before\./;

const section = (from, to) => {
  const a = content.indexOf(from);
  assert.ok(a >= 0, `missing ${from}`);
  const b = content.indexOf(to, a + from.length);
  assert.ok(b > a, `missing ${to}`);
  return content.slice(a, b);
};
const search = () => section('### ⛔ CHECKPOINT 0: Search', '### 🧠 CHECKPOINT 0.5');
const review = () => section('### ⛔ CHECKPOINT 6: Review', '### ✅ VERIFICATION CHECKPOINT');
const closing = () => section('### 🔒 CLOSING STEP: Scrub and receipt', '### ⛔ CHECKPOINT 7: Compound');

describe('repo copy of the w-plan-tdd-swarm shortcut is regenerated', () => {
  it('w-plan-tdd-swarm.md equals the generator output, no backslash-escaped backticks', async () => {
    const md = await fs.readFile(path.join(SHORTCUTS_DIR, 'w-plan-tdd-swarm.md'), 'utf-8');
    assert.equal(md, content);
    assert.ok(!md.includes('\\`'));
  });
});

describe('/w-plan-tdd-swarm Search step', () => {
  it('runs callers --symbol and names its exit codes', () => {
    const s = search();
    assert.match(s, /callers --symbol <file>:<name>/);
    assert.match(s, /`floor`/);
    assert.match(s, /`reasons`/);
    assert.match(s, /`sentences`/);
    assert.match(s, /zero callers with `floor: true` is never "unused"/i);
    assert.match(s, /Exit 0 printed/);
    assert.match(s, /exit 1 is wrong input or a broken state: report it/);
    assert.match(s, /exit 2 is a refusal: stop that step and report it as printed/);
    assert.match(s, FALLBACK);
  });
});

describe('/w-plan-tdd-swarm Review step', () => {
  it('runs lenses, graph and impact over diff-range with case $RC handling', () => {
    const s = review();
    assert.match(s, /Code Analysis/);
    assert.match(s, /D=\$\(mktemp\); node \.claude\/helpers\/kit\/cli\.js diff-range > "\$D"; RC=\$\?\n/);
    assert.match(s, /lenses --diff "\$D"; RC=\$\?;; 3\) echo "no change to review"/);
    assert.match(s, /graph --diff "\$D" --budget-ms 20000 --max-parses 300; RC=\$\?;; 3\)/);
    assert.match(s, /diff-range --base-only/);
    assert.match(s, /diff-range --base "\$B"/);
    assert.match(s, /impact --diff "\$D" --base "\$B"; RC=\$\?;; 3\)/);
    assert.match(s, /rm -f "\$D"; \(exit \$RC\)/);
    assert.match(s, /Exit 3 from `diff-range` means an empty range: report "no change to review", never a failure/);
    assert.match(s, /Exit 2 means `diff-range` refused the repository/);
    assert.match(s, /Any other non-zero exit is wrong input or a broken state: report it, never skip the step/);
    assert.match(s, /removed_with_live_callers/);
    assert.match(s, /`risk`/);
    assert.match(s, /`cuts`/);
    assert.match(s, /floor: true/);
    assert.match(s, FALLBACK);
    assert.ok(!s.includes('\\`'));
  });
  it('comes before the findings table', () => {
    const s = review();
    assert.ok(s.indexOf('Code Analysis') < s.indexOf('| Category | Finding | Severity |'));
  });
});

describe('/w-plan-tdd-swarm closing step', () => {
  it('scrubs the worktree, names every exit code, and records the receipt', () => {
    const s = closing();
    assert.match(s, /cli\.js scrub --worktree/);
    assert.match(s, /exit 0 clean/i);
    assert.match(s, /exit 2 .*hits/i);
    assert.match(s, /do not commit/i);
    assert.match(s, /exit 1 .*wrong input or a broken state/i);
    assert.match(s, /push-gate receipt --verdict pass --high 0 --medium 0 --low 0/);
    assert.match(s, /push-gate receipt --verdict fail --high \d+ --medium \d+ --low \d+/);
    assert.ok(!s.includes('pass|fail'));
    assert.ok(!/<[A-Za-z]+>/.test(s.replace(/push-gate check/g, '')), 'no shell-hostile placeholders');
    assert.match(s, /push-gate check/);
    assert.match(s, /never skips their permission prompt/);
    assert.match(s, FALLBACK);
  });
  it('sits after Verification and before Compound', () => {
    assert.ok(content.indexOf('VERIFICATION CHECKPOINT') < content.indexOf('CLOSING STEP: Scrub and receipt'));
  });
  it('is in the todo list and checklist', () => {
    assert.match(content, /Scrub and receipt/);
    assert.match(content, /all 12 phases/);
    assert.ok(!content.includes('all 9 phases'));
  });
});

describe('bash blocks of the wired steps parse', () => {
  it('every bash block in Search, Review and closing passes bash -n', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pt-bash-'));
    try {
      const text = [search(), review(), closing()].join('\n');
      const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]);
      assert.ok(blocks.length >= 4);
      blocks.forEach((b, i) => {
        if (b.includes('curl')) return;
        const f = path.join(dir, `b${i}.sh`);
        fsSync(f, b);
        const r = spawnSync('bash', ['-n', f], { encoding: 'utf-8' });
        assert.equal(r.status, 0, `block ${i}: ${r.stderr}`);
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

import { writeFileSync } from 'fs';
function fsSync(f, b) { writeFileSync(f, b); }
