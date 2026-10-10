/**
 * Tests for the /w-marathon and /mt command content — AC 34–35.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const SHORTCUTS_DIR = path.join(PROJECT_ROOT, '.claude', 'commands', '.shortcuts');

const commands = getCommands();

describe('/w-marathon command content', () => {
  const c = () => commands['w-marathon'].content;

  it('is registered with the right header and description', () => {
    assert.ok(commands['w-marathon'], 'w-marathon missing from getCommands()');
    assert.ok(c().includes('# /w-marathon'));
    assert.match(commands['w-marathon'].description, /finish line|marathon/i);
  });

  it('uses TaskCreate first, never TodoWrite', () => {
    assert.match(c(), /TaskCreate/);
    assert.ok(!c().includes('TodoWrite'));
  });

  it('has the seven phases', () => {
    for (const phase of ['Search', 'Interview', 'Kickoff', 'Arm', 'Loop', 'Stop', 'Compound']) {
      assert.match(c(), new RegExp(`CHECKPOINT[^\\n]*${phase}`), `phase ${phase} missing`);
    }
  });

  it('interview asks the four kickoff lines and ends with "Nothing, go."', () => {
    assert.match(c(), /Done means/);
    assert.match(c(), /decide on your own|may decide alone/i);
    assert.match(c(), /Ask me before/);
    assert.match(c(), /Never:/);
    assert.match(c(), /Nothing, go/);
    assert.match(c(), /AskUserQuestion/);
  });

  it('names every cli.js verb it depends on', () => {
    for (const verb of ['budget', 'gate --stream', 'record', 'record finding-fixed', 'status', 'wake', 'resume', 'seen-twice', 'review-brief', 'review-writeup', 'promote', 'init', 'stream', 'route', 'model-stats', 'finish']) {
      assert.match(c(), new RegExp(`cli\\.js ${verb}`), `verb ${verb} missing`);
    }
    assert.match(c(), /\.claude\/helpers\/marathon\/cli\.js/);
  });

  it('enforces the budget stop rule and the waitingOnHuman rule', () => {
    assert.match(c(), /exit (code )?2/);
    assert.match(c(), /any non-zero exit/i, 'f9: a crash (exit 1) must also stop spawning');
    assert.match(c(), /cli\.js repair/, 'g4: the protocol names the repair verb for corrupt rows');
    assert.match(c(), /streak began|start of the streak|same code/i, 'g6: the diff rule for a streak');
    assert.match(c(), /never (spawn|start) (a|any) helper/i);
    assert.match(c(), /waitingOnHuman/);
    assert.match(c(), /never retr/i);
    assert.match(c(), /never weaken an assertion/i);
  });

  it('has resume and status modes and a worktree per stream', () => {
    assert.match(c(), /--resume/);
    assert.match(c(), /--status/);
    assert.match(c(), /worktree/i);
    assert.match(c(), /status\.md/);
    assert.match(c(), /finish-line\.json/);
    assert.match(c(), /checklist\.md/);
  });

  it('carries the model policy (sonnet builds, opus reviews, haiku routines) and no premium name', () => {
    assert.match(c(), /Model Policy/);
    assert.match(c(), /sonnet/);
    assert.match(c(), /opus/);
    assert.match(c(), /haiku/);
    assert.ok(!/fable/i.test(c()));
  });

  it('wires the review loop: diff since the last certified point, two clean reviews, promote seen-twice, /bc per stream', () => {
    assert.match(c(), /certified point/i, 'k10: a single clean round does not move the base');
    assert.match(c(), /two clean reviews|clean reviews in a row|passes_in_a_row/i);
    assert.match(c(), /seen twice|seen-twice/i);
    assert.match(c(), /\/bc\b/);
  });

  it('arms the wake-up and prints the fallback', () => {
    assert.match(c(), /CronCreate|cron/i);
    assert.match(c(), /launchd|crontab/i);
    assert.match(c(), /get_usage/);
  });

  it('has no literal backtick escaping artifacts', () => {
    assert.ok(!c().includes('\\`'), 'rendered content must not contain escaped backticks');
  });
});

describe('kit wiring', () => {
  const c = () => commands['w-marathon'].content;
  const section = (from, to) => {
    const a = c().indexOf(from);
    assert.ok(a >= 0, `${from} missing`);
    const b = to ? c().indexOf(to, a + from.length) : c().length;
    assert.ok(b > a, `${to} missing after ${from}`);
    return c().slice(a, b);
  };
  const review = () => section('**4.5 Review round', '**4.5a');
  const gate = () => section('**4.8 Gate.**', '**4.9 Escapes');
  const compound = () => section('### ⛔ CHECKPOINT 6', '## `--resume');
  const FALLBACK = 'If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.';
  const OTHER = 'Any other non-zero exit (for example 127, or a signal) is a failure of that step: report it, never read it as nothing found.';

  it('4.5 appends lenses and impact over the stream range with --base and handles every diff-range exit', () => {
    const r = review();
    assert.match(r, /cli\.js stream <name>/, 'says how to read the stream base');
    assert.match(r, /`base` field/);
    assert.match(r, /diff-range --dir "\$W" --base "\$BASE" > "\$D"; RC=\$\?/);
    assert.match(r, /lenses --diff "\$D"/);
    assert.match(r, /impact --diff "\$D" --base "\$BASE"/);
    assert.match(r, /if \[ ! -f \.claude\/helpers\/kit\/cli\.js \]; then echo "kit not installed/);
    assert.match(r, /D=\$\(mktemp 2>\/dev\/null\) && \[ -n "\$D" \] \|\| \{[^}]*D=;/);
    assert.match(r, /\(trap 'rm -f/);
    assert.match(r, /case \$RC in 0\)/);
    assert.match(r, /3\) echo "no change to review"; RC=0;;/);
    assert.match(r, /2\) echo "diff-range refused/);
    assert.match(r, /\*\) echo "diff-range failed \(exit \$RC\)/);
    assert.ok(r.includes(FALLBACK));
    assert.ok(r.includes(OTHER));
  });

  it('4.5 says skipped files make every result a floor', () => {
    const r = review();
    assert.match(r, /too_large/);
    assert.match(r, /max_untracked/);
    assert.match(r, /nested repositor/i);
    assert.match(r, /--json/);
    assert.match(r, /floor/);
  });

  it('4.5 says what the reviewer gets and that both the brief and the JSON are redacted', () => {
    const r = review();
    assert.match(r, /"Kit analysis"/);
    assert.match(r, /brief text/);
    assert.match(r, /already redacts the diff/);
    assert.match(r, /\.claude\/kit\/secrets/);
    assert.match(r, /fails closed/);
    assert.match(r, /redact --keep-lines/);
    assert.match(r, /`text`/);
    assert.match(r, /raw diff/);
  });

  it('4.5 records a receipt after the review with a concrete pass and fail command', () => {
    const r = review();
    assert.match(r, /cli\.js record review[\s\S]*push-gate receipt/);
    assert.match(r, /push-gate receipt --verdict pass --high 0 --medium 1 --low 3 --base [0-9a-f]{7,40}/);
    assert.match(r, /push-gate receipt --verdict fail --high 1 --medium 2 --low 0 --base [0-9a-f]{7,40}/);
    assert.match(r, /cd "\$W"/);
    assert.match(r, /exit 0[^.]*written/i);
    assert.match(r, /exit 1[^.]*wrong input/i);
    assert.match(r, /exit 2[^.]*refused receipt store/i);
    for (const line of r.split('\n').filter(l => /push-gate receipt --verdict/.test(l))) {
      assert.ok(!/<[A-Za-z]+>/.test(line), `no placeholder in command line: ${line}`);
    }
  });

  it('4.8 runs scrub --history before the gate and records a finding on exit 2', () => {
    const g = gate();
    assert.ok(g.indexOf('scrub --history "$BASE"') < g.indexOf('cli.js gate --stream'), 'scrub comes before the gate call');
    assert.match(g, /exit 0[^.]*clean/i);
    assert.match(g, /exit 2[^.]*(hits|incomplete)/i);
    assert.match(g, /exit 1[^.]*wrong input/i);
    assert.match(g, /cli\.js record finding [^\n]*severity=high category=security/);
    assert.match(g, /do not close the stream|not close the stream/i);
    assert.match(g, /gate still runs/i);
    assert.ok(g.includes(FALLBACK));
    assert.ok(g.includes(OTHER));
  });

  it('CHECKPOINT 6 runs push-gate check --base before any /bcp with the abstain/ask/deny semantics', () => {
    const k = compound();
    assert.match(k, /push-gate check --base "\$BASE"/);
    assert.match(k, /cd "\$W"/);
    assert.match(k, /abstain/);
    assert.match(k, /no review recorded for this change/);
    assert.match(k, /any other `ask`/i);
    assert.match(k, /not pushed/);
    assert.match(k, /exit 2[^.]*deny[^.]*refused/i);
    assert.match(k, /exit 1[^.]*error/i);
    assert.match(k, /never skips or answers the owner's own permission prompt/);
    assert.match(k, /Before any `\/bcp`/);
    assert.ok(k.includes(FALLBACK));
    assert.ok(k.includes(OTHER));
  });

  it('every extracted bash block passes bash -n', () => {
    const blocks = [...c().matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]);
    assert.ok(blocks.length >= 5, 'the wired steps carry bash blocks');
    for (const b of blocks) {
      const r = spawnSync('bash', ['-n'], { input: b, encoding: 'utf-8' });
      assert.equal(r.status, 0, `bash -n failed: ${r.stderr}\n${b}`);
    }
  });
});

describe('/mt alias', () => {
  it('invokes .shortcuts:w-marathon with verbatim args', () => {
    assert.ok(commands.mt, 'mt alias missing');
    assert.match(commands.mt.content, /\.shortcuts:w-marathon/);
    assert.match(commands.mt.content, /verbatim/);
    assert.match(commands.mt.content, /TaskCreate/);
  });
});

describe('repo copy of the shortcuts is regenerated', () => {
  it('w-marathon.md, mt.md and bcp.md exist in .claude/commands/.shortcuts', async () => {
    for (const f of ['w-marathon.md', 'mt.md', 'bcp.md']) {
      const st = await fs.stat(path.join(SHORTCUTS_DIR, f));
      assert.ok(st.isFile(), `${f} missing`);
    }
    const md = await fs.readFile(path.join(SHORTCUTS_DIR, 'w-marathon.md'), 'utf-8');
    assert.equal(md, commands['w-marathon'].content);
  });
});
