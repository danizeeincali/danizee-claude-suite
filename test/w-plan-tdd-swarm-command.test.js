import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import nodeFs from 'fs';
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
    assert.match(s, /D=\$\(mktemp 2>\/dev\/null\) && \[ -n "\$D" \] \|\| \{[^\n]*\nif \[ -n "\$D" \]; then node \.claude\/helpers\/kit\/cli\.js diff-range > "\$D"; RC=\$\?\n/);
    assert.match(s, /lenses --diff "\$D"; RC=\$\?;; 3\) echo "no change to review"/);
    assert.match(s, /graph --diff "\$D" --budget-ms 20000 --max-parses 300; RC=\$\?;; 3\)/);
    assert.match(s, /diff-range --base-only/);
    assert.match(s, /diff-range --base "\$B"/);
    assert.match(s, /impact --diff "\$D" --base "\$B"; RC=\$\?;; 3\)/);
    assert.match(s, /rm -f "\$D"; \(exit \$RC\)/);
    assert.match(s, /Exit 3 from `diff-range` means an empty range: report "no change to review", never a failure/);
    assert.match(s, /Exit 2 means `diff-range` refused the repository/);
    assert.match(s, /Exit 1 is wrong input or a broken state: report it, never skip the step/);
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

describe('review round 1 fixes', () => {
  it('Search reads missing, partial and not_read on exit 0', () => {
    const s = search();
    assert.match(s, /Exit 0 printed the entry but can still leave a symbol out/);
    for (const w of ['`missing`', '`partial`', '`not_read`']) assert.ok(s.includes(w), w);
    assert.match(s, /was not answered[^.]*never "no callers"/);
  });
  it('exit 2 is named per verb and --base-only keeps its own exit code', () => {
    const r = review();
    assert.match(r, /Exit 2 from any of these verbs \(`diff-range`, including `--base-only`, `lenses`, `graph`, `impact`\) is a refusal/);
    assert.match(r, /32 MiB/);
    assert.match(r, /B=\$\(node \.claude\/helpers\/kit\/cli\.js diff-range --base-only\); RC=\$\?/);
    assert.ok(!r.includes('then RC=1; else'));
    assert.ok(!r.includes('B=; }'));
  });
  it('closing step stages new files before scrub and receipt and says untracked files are not covered', () => {
    const c = closing();
    const add = c.indexOf('`git add`');
    assert.ok(add >= 0);
    assert.ok(add < c.indexOf('scrub --worktree'));
    assert.ok(add < c.indexOf('push-gate receipt'));
    assert.match(c, /untracked files are in neither the scrub nor the receipt until they are added/);
    assert.match(c, /a file still untracked was not scanned/);
    assert.match(c, /after Compound, `git add` its new files and, if the tracked tree changed, record the receipt again/);
  });
  it('push-gate check exits are named and none is an allow', () => {
    const c = closing();
    assert.match(c, /exit 0 means abstain or ask \(read `decision`\), exit 2 deny \(read `decision` and `reason`\) or a refused receipt store \(`kit: refused:` on stderr\), and exit 1 an error; none is an allow/);
  });
  it('description copies agree with the template phase count', async () => {
    const m = content.match(/with all (\d+) phases/)[1];
    const root = path.join(__dirname, '..');
    for (const f of ['src/utils/shortcuts.js', 'WORKFLOW-SHORTCUTS.md']) {
      const t = await fs.readFile(path.join(root, f), 'utf-8');
      const i = t.indexOf('Ideas need refinement before implementation');
      assert.ok(i >= 0, f);
      assert.ok(t.slice(i, i + 600).includes(`Use TodoWrite first with all ${m} phases`), f);
    }
  });
});

describe('review round 2 fixes', () => {
  const blocks = () => [...review().matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]).filter(b => b.includes('diff-range'));
  it('exit 0 with skipped files is a floor naming them', () => {
    const r = review();
    assert.match(r, /Exit 0 from `diff-range` can still leave files out/);
    for (const w of ['too_large', 'max_untracked', 'nested_repository', 'skipped_detail', 'stderr']) assert.ok(r.includes(w), w);
    assert.match(r, /name each skipped file in the findings, say it was not analysed, and treat every lens, graph and impact result as a floor/);
  });
  it('exit 1, 2 and 3 are separate sentences', () => {
    const r = review();
    assert.match(r, /Exit 1 is wrong input or a broken state: report it, never skip the step\./);
    assert.match(r, /Any other non-zero exit \(for example 127, or a signal\) is a failure of that step: report it, never read it as nothing found\./);
    assert.match(r, /Exit 2 means `diff-range` refused the repository[^.]*: report the refusal as printed\./);
    assert.match(r, /Exit 3 from `diff-range` means an empty range[^.]*the whole block exits 0 on an empty range/);
  });
  it('the 3) branch sets RC=0 in every block', () => {
    const bs = blocks();
    assert.equal(bs.length, 3);
    for (const b of bs) {
      assert.match(b, /3\) echo "no change to review"; RC=0;;/);
      assert.match(b.trimEnd(), /\(exit \$RC\); fi$/);
    }
  });
  it('a kit guard precedes each kit call and does not exit the shell', () => {
    const bs = blocks();
    for (const b of bs) {
      assert.ok(b.startsWith('if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed'), b);
      assert.ok(b.indexOf('kit not installed') < b.indexOf('node .claude/helpers/kit/cli.js'));
      assert.ok(!/(^|[;\s])exit \d/.test(b.replace(/\(exit (\$RC|0)\)/g, '')));
    }
  });
  it('push-gate check exit 2 is a deny or a refused receipt store', () => {
    assert.match(closing(), /exit 2 deny \(read `decision` and `reason`\) or a refused receipt store \(`kit: refused:` on stderr\)/);
  });
});

describe('review round 3 fixes', () => {
  const blocks = () => [...review().matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]);
  it('skipped-file wording matches what diff-range prints', () => {
    const r = review();
    assert.match(r, /`too_large` skip names each file on stderr, so report those names/);
    assert.match(r, /`max_untracked` prints only a count \(report the count/);
    assert.match(r, /nested repository is visible only with `diff-range --json` \(`skipped_detail`\)/);
  });
  it('each block guards the temp file and runs diff-range only when it exists', () => {
    const bs = blocks();
    assert.equal(bs.length, 3);
    for (const b of bs) {
      assert.match(b, /D=\$\(mktemp 2>\/dev\/null\) && \[ -n "\$D" \] \|\| \{ echo "mktemp failed: no temp file for the range" >&2; D=; RC=1; \}/);
      assert.ok(b.indexOf('mktemp failed') < b.indexOf('diff-range >') || b.indexOf('mktemp failed') < b.indexOf('diff-range --base "$B" >'));
      assert.match(b, /\[ -z "\$D" \] \|\| rm -f "\$D"/);
      const dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'pt-r3-'));
      try {
        nodeFs.mkdirSync(path.join(dir, '.claude/helpers/kit'), { recursive: true });
        nodeFs.writeFileSync(path.join(dir, '.claude/helpers/kit/cli.js'), 'if (process.argv.includes("--base-only")) { console.log("abc"); process.exit(0); } process.exit(0);');
        const bin = path.join(dir, 'bin');
        nodeFs.mkdirSync(bin);
        for (const t of ['node', 'rm']) {
          const w = spawnSync('sh', ['-c', `command -v ${t}`], { encoding: 'utf-8' }).stdout.trim();
          if (w) nodeFs.symlinkSync(w, path.join(bin, t));
        }
        const res = spawnSync(spawnSync('sh', ['-c', 'command -v bash'], { encoding: 'utf-8' }).stdout.trim(), ['-c', b], { cwd: dir, encoding: 'utf-8', env: { PATH: bin } });
        assert.equal(res.status, 1);
        assert.match(res.stderr, /mktemp failed: no temp file for the range/);
        assert.ok(!/diff-range failed/.test(res.stderr));
      } finally {
        nodeFs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
  it('a catch-all sentence covers other non-zero exits', () => {
    assert.match(review(), /Any other non-zero exit \(for example 127, or a signal\) is a failure of that step: report it, never read it as nothing found\./);
  });
});
