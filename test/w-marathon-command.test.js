/**
 * Tests for the /w-marathon and /mt command content — AC 34–35.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import os from 'os';
import { writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, existsSync, readFileSync } from 'fs';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const SHORTCUTS_DIR = path.join(PROJECT_ROOT, '.claude', 'commands', '.shortcuts');
const KIT_SRC = path.join(PROJECT_ROOT, 'src', 'lib', 'kit');

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
    assert.match(r, /streams\.json/, 'says how to read the stream base (read-only, from streams.json)');
    assert.match(r, /`base` field/);
    assert.match(r, /diff-range --base "\$BASE" > "\$D"; RC=\$\?/);
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
    assert.match(r, /push-gate receipt --verdict pass --high 0 --medium 1 --low 3 --base "\$BASE"/);
    assert.match(r, /push-gate receipt --verdict fail --high 1 --medium 2 --low 0 --base "\$BASE"/);
    const receipts = [...r.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]).filter(b => /push-gate receipt --verdict/.test(b));
    assert.equal(receipts.length, 2);
    for (const b of receipts) assert.match(b, /^W=[^\n]*; BASE=[0-9a-f]{7,40}\n/, `a concrete base on the first line: ${b}`);
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

  it('r1 fix 1: every 4.5 kit block enters the worktree first, with no --dir, and impact resolves from the worktree', () => {
    const r = review();
    const blocks = [...r.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]).filter(b => /lenses --diff|impact --diff/.test(b));
    assert.equal(blocks.length, 2, 'the lenses and impact blocks');
    for (const b of blocks) {
      const cd = b.indexOf('(cd "$W" || {');
      assert.ok(cd >= 0, `enters the worktree: ${b}`);
      assert.ok(cd < b.indexOf('if [ ! -f .claude/helpers/kit/cli.js ]'), 'the kit guard runs inside the worktree');
      assert.ok(!b.includes('--dir'), 'no --dir: the worktree is the cwd');
    }
    assert.match(r, /Every kit block runs from inside the worktree/);
    assert.match(r, /builds its symbol graph from the files of the folder it runs in, the worktree/);
    assert.ok(!/`impact` takes `--diff` and the same `--base`\./.test(r), 'the old prose (impact needs only --diff and --base) is gone');
  });

  it('r1 fix 2: 4.2 copies the private scrub patterns; 4.8 and CHECKPOINT 6 fail when they are missing from the worktree', () => {
    const iso = section('**4.2 Isolate', '**4.3 Build');
    assert.match(iso, /mkdir -p "\$W\/\.claude\/kit" && cp \.claude\/kit\/scrub-patterns\.local "\$W\/\.claude\/kit\/scrub-patterns\.local"/);
    assert.match(iso, /git-ignores `\.claude\/kit\/scrub-patterns\.local`/);
    const g = gate();
    assert.match(g, /"configured": \*false/);
    assert.match(g, /scrub patterns missing from the worktree[^\n]*RC=2/);
    assert.match(g, /treat it exactly like a scrub exit 2/);
    assert.match(g, /copied in as in 4\.2/, 'the next stream gets the copy too');
    const k = compound();
    assert.match(k, /for P in \.claude\/kit\/scrub-patterns \.claude\/kit\/scrub-patterns\.local; do if \[ -f "\$M\/\$P" \] && \[ ! -f "\$P" \]/);
    assert.match(k, /scrub patterns missing from the worktree[^\n]*not pushed[^\n]*exit 2/);
    assert.ok(k.indexOf('scrub patterns missing') < k.indexOf('push-gate receipt'), 'checked before the receipt and the check');
  });

  it('r1 fix 3: CHECKPOINT 6 runs /bc, re-records the receipt, then checks, then /bcp, and explains the shared store', () => {
    const k = compound();
    assert.match(k, /\*\*`\/bc` first\*\*[\s\S]*\*\*then re-record the stream's receipt\*\*[\s\S]*\*\*then `push-gate check`\*\*[\s\S]*\*\*then `\/bcp`\*\*/);
    const b = [...k.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1])[0];
    assert.ok(b.indexOf('push-gate receipt --verdict pass') >= 0 && b.indexOf('push-gate receipt --verdict pass') < b.indexOf('push-gate check --base "$BASE"'), 'receipt before check in the block');
    assert.match(b, /push-gate receipt --verdict pass --high \d+ --medium \d+ --low \d+ --base "\$BASE"/);
    assert.match(k, /shared by every worktree/);
    assert.match(k, /one latest receipt per repository/);
    assert.match(k, /"only an earlier review exists" usually means another stream recorded its receipt after this one/);
    assert.match(k, /run the block again \(it re-records, then checks\) before putting it to the owner/);
  });

  it('r1 fix 4: the base is read from streams.json, never with cli.js stream <name>', () => {
    const r = review();
    assert.match(r, /BASE=\$\(node -e '[^\n]*streams[^\n]*' \.claude\/marathon\/[^ ]+\/streams\.json [a-z-]+\)/);
    assert.match(r, /with no key=value it still rewrites the stream row/);
    assert.match(r, /misspelled name silently creates a new stream/);
    assert.ok(!/the `base` field of `cli\.js stream <name>`/.test(c()), 'no step reads the base through cli.js stream');
  });

  const kitBlocks = () => [...c().matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]);
  const gateBlocks = () => kitBlocks().filter(b => /push-gate receipt --verdict|push-gate check --base/.test(b));

  it('r2 fix 1: CHECKPOINT 6 and both receipt blocks enter the worktree before the kit test, which uses the relative path', () => {
    const bs = gateBlocks();
    assert.equal(bs.length, 3, 'two receipt blocks and the CHECKPOINT 6 block');
    for (const b of bs) {
      const word = b.includes('push-gate check') ? 'not pushed' : 'receipt not recorded';
      const cd = b.indexOf(`cd "$W" || { echo "cannot enter the stream worktree $W: ${word}" >&2; exit 1; }`);
      assert.ok(cd >= 0, `enters the worktree first: ${b}`);
      assert.ok(cd < b.indexOf('if [ ! -f .claude/helpers/kit/cli.js ]'), 'the kit test runs inside the worktree');
      assert.ok(!b.includes('"$W/.claude/helpers/kit/cli.js"'), 'no kit test against $W from outside');
    }
    assert.match(compound(), /a missing or wrong `W` prints "cannot enter the stream worktree"/);
    assert.match(review(), /a missing or wrong `W` prints "cannot enter the stream worktree"/);
  });

  it('r2 fix 2: 4.8 checks each pattern file before the scrub and keeps the configured: false check', () => {
    const b = kitBlocks().find(x => x.includes('scrub --history'));
    const loop = b.indexOf('for P in .claude/kit/scrub-patterns .claude/kit/scrub-patterns.local; do if [ -f "$M/$P" ] && [ ! -f "$P" ]; then echo "scrub patterns missing from the worktree');
    assert.ok(loop >= 0 && loop < b.indexOf('scrub --history'), 'the loop runs before the scrub');
    assert.match(b, /scrub patterns missing from the worktree[^\n]*exit 2; fi; done/);
    assert.match(b, /"configured": \*false/);
    assert.match(gate(), /checks each pattern file on its own[\s\S]*treat it exactly like a scrub exit 2/);
  });

  it('r2 fix 3: a scrub exit 1 or any other non-zero exit keeps the stream open until a scrub exits 0', () => {
    const g = gate();
    assert.match(g, /A scrub exit 1, or any other non-zero exit, also keeps the stream open[^.]*no `state=done` until a scrub exits 0/);
    assert.match(g, /exit 0 \(`buildGateMet`\) and the scrub above exited 0 → `cli\.js stream <name> state=done`/);
  });

  it('r2 fix 4: "kit not installed" only when the main checkout has no kit either; otherwise "kit missing from the worktree", exit 1', () => {
    const bs = kitBlocks().filter(b => b.includes('cd "$W"') && b.includes('kit not installed'));
    assert.equal(bs.length, 6, 'lenses, impact, two receipts, the 4.8 scrub and CHECKPOINT 6');
    for (const b of bs) {
      assert.match(b, /^M=\$PWD; \(/m, `M is set before the subshell: ${b}`);
      const miss = b.indexOf('[ -f "$M/.claude/helpers/kit/cli.js" ]');
      assert.ok(miss >= 0 && miss < b.indexOf('kit not installed'), `the main checkout is tested before the advisory skip: ${b}`);
      assert.match(b, /kit missing from the worktree: commit it or copy it[^\n]*>&2; exit 1; fi/);
    }
    assert.match(review(), /"kit not installed" \(the advisory skip\) only when the main checkout has no `\.claude\/helpers\/kit\/cli\.js` either/);
  });

  it('r2 fix 5: the base reader catches a missing or invalid streams.json and the prose names it', () => {
    const r = review();
    assert.match(r, /try\{d=JSON\.parse\(require\("fs"\)\.readFileSync\(f,"utf8"\)\)\}catch\(e\)\{console\.error\("cannot read "\+f\+": "\+e\.message\);process\.exit\(1\)\}/);
    assert.match(r, /or the run folder or streams\.json is wrong/);
  });

  it('r2 fix 6: CHECKPOINT 6 and the receipt blocks refuse an empty BASE first', () => {
    for (const b of gateBlocks()) {
      const word = b.includes('push-gate check') ? 'not pushed' : 'receipt not recorded';
      const g = b.indexOf(`[ -n "$BASE" ] || { echo "BASE is empty: read it from streams.json first: ${word}" >&2; exit 1; }`);
      assert.ok(g >= 0 && g < b.indexOf('cd "$W"'), `the BASE check is at the top: ${b}`);
    }
    assert.match(compound(), /refuses an empty `BASE` \("BASE is empty"/);
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

// A throwaway main checkout with the real kit committed at .claude/helpers/kit, plus one stream worktree.
const gitIn = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf-8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
function worktreeRepo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mt-kit-'));
  const main = path.join(root, 'repo');
  mkdirSync(main);
  gitIn(main, 'init', '-q', '-b', 'main', '.');
  writeFileSync(path.join(main, '.gitignore'), '.claude/kit/secrets\n.claude/kit/cache/\n.claude/kit/scrub-patterns.local\n');
  writeFileSync(path.join(main, 'a.js'), 'export function base(x) {\n  return x + 1;\n}\n');
  cpSync(KIT_SRC, path.join(main, '.claude', 'helpers', 'kit'), { recursive: true });
  gitIn(main, 'add', '.');
  gitIn(main, 'commit', '-q', '-m', 'init');
  const BASE = gitIn(main, 'rev-parse', 'HEAD').trim();
  gitIn(main, 'worktree', 'add', '-q', '../repo-s', '-b', 'marathon/run/s');
  const W = path.join(root, 'repo-s');
  const tmp = path.join(root, 'tmp');
  mkdirSync(tmp);
  const env = { ...process.env, HOME: root, TMPDIR: tmp, KIT_RECEIPTS_DIR: path.join(root, 'receipts'), GIT_CONFIG_NOSYSTEM: '1' };
  // Each block's first line sets the placeholder W (and BASE); replace it with the fixture's.
  const run = (block, w = '../repo-s', base = BASE) => spawnSync('bash', ['-c', `W=${w}; BASE=${base}\n${block.replace(/^W=[^\n]*\n/, '')}`], { cwd: main, encoding: 'utf-8', env });
  return { root, main, W, BASE, run, env };
}

describe('kit blocks run against the real kit in a stream worktree', () => {
  const c = () => commands['w-marathon'].content;
  const blocks = () => [...c().matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]);
  const lensesBlock = () => blocks().find(b => b.includes('lenses --diff'));
  const impactBlock = () => blocks().find(b => b.includes('impact --diff'));
  const copyBlock = () => blocks().find(b => b.includes('cp .claude/kit/scrub-patterns.local'));
  const scrubBlock = () => blocks().find(b => b.includes('scrub --history'));

  it('an empty stream range: lenses and impact exit 0 with "no change to review"', () => {
    const fx = worktreeRepo();
    try {
      for (const b of [lensesBlock(), impactBlock()]) {
        const r = fx.run(b);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /no change to review/);
      }
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('a stream commit: impact reads the worktree files, not the main checkout', () => {
    const fx = worktreeRepo();
    try {
      writeFileSync(path.join(fx.W, 'a.js'), 'export function base(x) {\n  return x + 2;\n}\nexport function added(y) {\n  return base(y) * 2;\n}\n');
      gitIn(fx.W, 'commit', '-q', '-am', 'stream change');
      const r = fx.run(impactBlock());
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /a\.js/);
      assert.match(r.stdout, /\badded\b/, `the symbol that exists only in the worktree is touched: ${r.stdout}`);
      const l = fx.run(lensesBlock());
      assert.equal(l.status, 0, l.stderr);
      assert.ok(!/no change to review/.test(l.stdout));
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('private scrub patterns: missing from the worktree fails the 4.8 scrub; after the 4.2 copy it reports configured: true', () => {
    const fx = worktreeRepo();
    try {
      mkdirSync(path.join(fx.main, '.claude', 'kit'), { recursive: true });
      writeFileSync(path.join(fx.main, '.claude', 'kit', 'scrub-patterns.local'), 'ZQXJ-PRIVATE-[0-9]+\n');
      const before = fx.run(scrubBlock());
      assert.equal(before.status, 2, before.stdout + before.stderr);
      assert.match(before.stderr, /scrub patterns missing from the worktree/);
      const cp = fx.run(copyBlock());
      assert.equal(cp.status, 0, cp.stderr);
      assert.ok(existsSync(path.join(fx.W, '.claude', 'kit', 'scrub-patterns.local')), 'the pattern file is in the worktree');
      assert.equal(readFileSync(path.join(fx.W, '.claude', 'kit', 'scrub-patterns.local'), 'utf-8'), 'ZQXJ-PRIVATE-[0-9]+\n');
      assert.equal(gitIn(fx.W, 'status', '--porcelain'), '', 'the copy is git-ignored, never committed');
      const after = fx.run(scrubBlock());
      assert.equal(after.status, 0, after.stdout + after.stderr);
      assert.match(after.stdout, /"configured": true/);
      assert.ok(!/scrub patterns missing/.test(after.stderr));
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  const cp6Block = () => blocks().find(b => b.includes('push-gate check --base'));
  const receiptBlocks = () => blocks().filter(b => b.includes('push-gate receipt --verdict') && !b.includes('push-gate check'));
  const readerLine = () => c().split('\n').find(l => l.startsWith("BASE=$(node -e '"));

  it('r2: W pointing at a missing folder: CHECKPOINT 6 and the receipt blocks exit 1 with "cannot enter"', () => {
    const fx = worktreeRepo();
    try {
      for (const b of [cp6Block(), ...receiptBlocks()]) {
        const r = fx.run(b, '../no-such-worktree');
        assert.equal(r.status, 1, r.stdout + r.stderr);
        assert.match(r.stderr, /cannot enter the stream worktree/);
        assert.ok(!/kit not installed/.test(r.stdout));
      }
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('r2: main has both pattern files, the worktree only the public one: 4.8 exits 2 with "scrub patterns missing"', () => {
    const fx = worktreeRepo();
    try {
      for (const d of [fx.main, fx.W]) {
        mkdirSync(path.join(d, '.claude', 'kit'), { recursive: true });
        writeFileSync(path.join(d, '.claude', 'kit', 'scrub-patterns'), 'ZQXJ-PUBLIC-[0-9]+\n');
      }
      writeFileSync(path.join(fx.main, '.claude', 'kit', 'scrub-patterns.local'), 'ZQXJ-PRIVATE-[0-9]+\n');
      const r = fx.run(scrubBlock());
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /scrub patterns missing from the worktree: \.claude\/kit\/scrub-patterns\.local/);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('r2: the kit in main but not in W: every worktree block exits 1 with "kit missing from the worktree"; with no kit anywhere it is advisory', () => {
    const fx = worktreeRepo();
    try {
      rmSync(path.join(fx.W, '.claude', 'helpers', 'kit'), { recursive: true, force: true });
      const bs = [lensesBlock(), impactBlock(), scrubBlock(), cp6Block(), ...receiptBlocks()];
      assert.equal(bs.length, 6);
      for (const b of bs) {
        const r = fx.run(b);
        assert.equal(r.status, 1, r.stdout + r.stderr);
        assert.match(r.stderr, /kit missing from the worktree: commit it or copy it/);
        assert.ok(!/kit not installed/.test(r.stdout));
      }
      rmSync(path.join(fx.main, '.claude', 'helpers', 'kit'), { recursive: true, force: true });
      for (const b of bs) {
        const r = fx.run(b);
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.match(r.stdout, /kit not installed/);
      }
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('r2: an empty BASE: CHECKPOINT 6 and the receipt blocks exit 1 with "BASE is empty"', () => {
    const fx = worktreeRepo();
    try {
      for (const b of [cp6Block(), ...receiptBlocks()]) {
        const r = fx.run(b, '../repo-s', '');
        assert.equal(r.status, 1, r.stdout + r.stderr);
        assert.match(r.stderr, /BASE is empty: read it from streams\.json first/);
      }
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it('r2: the base reader: a missing streams.json exits 1 with "cannot read"; a real row prints its base', () => {
    const fx = worktreeRepo();
    try {
      const line = readerLine();
      assert.ok(line, 'the base reader line');
      const missing = spawnSync('bash', ['-c', line], { cwd: fx.main, encoding: 'utf-8', env: fx.env });
      assert.equal(missing.status, 1, missing.stdout + missing.stderr);
      assert.match(missing.stderr, /cannot read \.claude\/marathon\/[^ ]+\/streams\.json: /);
      assert.ok(!/\n\s+at /.test(missing.stderr), 'no stack trace');
      const f = line.match(/' (\.claude\/marathon\/[^ ]+\/streams\.json) ([a-z-]+)\)/);
      mkdirSync(path.dirname(path.join(fx.main, f[1])), { recursive: true });
      writeFileSync(path.join(fx.main, f[1]), 'not json');
      const bad = spawnSync('bash', ['-c', line], { cwd: fx.main, encoding: 'utf-8', env: fx.env });
      assert.equal(bad.status, 1);
      assert.match(bad.stderr, /cannot read /);
      writeFileSync(path.join(fx.main, f[1]), JSON.stringify({ streams: [{ name: f[2], base: fx.BASE }] }));
      const ok = spawnSync('bash', ['-c', line], { cwd: fx.main, encoding: 'utf-8', env: fx.env });
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(ok.stdout.trim(), fx.BASE);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
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
