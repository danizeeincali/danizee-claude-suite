import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHORTCUTS_DIR = path.join(__dirname, '..', '.claude', 'commands', '.shortcuts');
const commands = getCommands();
const SIX = ['w-multi-repo', 'w-suite-sync', 'w-compound', 'w-ralph-batch', 'w-swarm', 'w-fix'];

const NO_KIT = (what) => new RegExp(`kit not installed \\(\\.claude/helpers/kit/cli\\.js missing\\): ${what} skipped, advisory`);
const section = (name, from, to) => {
  const c = commands[name].content;
  const a = c.indexOf(from);
  assert.ok(a >= 0, `${name}: missing ${from}`);
  const b = to ? c.indexOf(to, a + from.length) : c.length;
  assert.ok(b > a, `${name}: missing ${to}`);
  return c.slice(a, b);
};

// Lenses only (no impact): the guard, the diff-range exits, every exit code named.
const assertLenses = (s) => {
  assert.match(s, /Code Analysis \(lenses over the change under review\)/);
  assert.match(s, /everything since the merge base with the upstream branch/);
  assert.match(s, /the whole history when there is no upstream/);
  assert.match(s, NO_KIT('step'));
  assert.match(s, /diff-range > "\$D"; RC=\$\?/);
  assert.match(s, /lenses --diff "\$D"; RC=\$\?;; 3\) echo "no change to review"/);
  assert.match(s, /\*\) echo "diff-range failed \(exit \$RC\)/);
  assert.ok(!/impact --diff/.test(s), 'lenses only here');
  assert.match(s, /Exit 3 from `diff-range` means an empty range/);
  assert.match(s, /Exit 1 is wrong input or a broken state/);
  assert.match(s, /Exit 2 is a refusal/);
  assert.match(s, /Any other non-zero exit \(for example 127, or a signal\) is a failure of that step: report it, never read it as nothing found/);
  assert.match(s, /mktemp failed/);
};

const assertCallers = (s) => {
  assert.match(s, /CALLERS/);
  assert.match(s, /callers --symbol src\/file\.js:name/);
  assert.match(s, /`missing` \(each with its reason\), `partial` and `not_read`/);
  assert.match(s, /`partial: true` makes every answer a floor/);
  assert.match(s, /exit 1 is wrong input or a broken state: report it, never read it as "no callers"/);
  assert.match(s, /exit 2 is a refusal: stop that step and report it as printed/);
  assert.match(s, /If `\.claude\/helpers\/kit\/cli\.js` is missing, say so in one line and continue/);
};

const assertSafeGit = (s, top) => {
  assert.match(s, /node \.claude\/helpers\/kit\/cli\.js safe-git --dir <clone top> -- <git args>/);
  assert.match(s, /never plain `git -C <path> \.\.\.`/);
  assert.match(s, /`--dir` must be the clone top itself/);
  assert.match(s, top);
  assert.match(s, /0 git ok \(it prints `\{ stdout, stderr, code, exit \}`/);
  assert.match(s, /1 bad input/);
  assert.match(s, /2 refused/);
  assert.match(s, /`kit: refused:` line on stderr/);
  assert.match(s, /3 git failed or timed out/);
  assert.match(s, /`--timeout <ms>` raises the 60000 ms default/);
  assert.match(s, /Only exit 0 and a git-ran exit 3 print that JSON/);
  assert.match(s, /Any other non-zero exit \(for example 127, or a signal\) is a failure of that step: report it, never read it as nothing found/);
  assert.match(s, NO_KIT('safe-git'));
};

const assertRedactBlock = (s) => {
  assert.match(s, /Write the .* to a temp file `\$E` outside the repository/);
  assert.match(s, /never `echo "<(text|body)>"` or a heredoc/);
  assert.match(s, NO_KIT('redact'));
  assert.match(s, /no \.claude\/kit\/secrets: text used as is, nothing to redact/);
  assert.match(s, /\[ ! -e "\$S" \] && \[ ! -L "\$S" \] && \[ ! -e "\$M" \] && \[ ! -L "\$M" \]/);
  assert.match(s, /J=\$\(mktemp 2>\/dev\/null\) && R=\$\(mktemp 2>\/dev\/null\)/);
  assert.match(s, /mktemp failed: text not redacted/);
  assert.match(s, /trap 'rm -f "\$J"; \[ -n "\$KEEP" \] \|\| rm -f "\$R"' EXIT INT TERM/);
  assert.match(s, /redact --keep-lines < "\$E" > "\$J"; RC=\$\?/);
  assert.match(s, /console\.error\("replaced="\+j\.replaced\)/);
  assert.match(s, /console\.log\("file="\+process\.argv\[2\]\)/);
  assert.match(s, /Exit 1 is bad input or a broken state/);
  assert.match(s, /never read it as "nothing to redact"/);
  assert.match(s, /Any other non-zero exit \(for example 127, or a signal\) is a failure of that step/);
  assert.ok(!s.includes('\\`'), 'no backslash-backtick in the rendered text');
};

describe('repo copies of the six swept shortcuts equal the generator output', () => {
  // The repo's w-swarm.md is the RuFlo variant (test/ruflo-integration.test.js pins it), a deliberate divergence
  // from the generator's plain swarm entry; it carries the same wired blocks, checked below.
  for (const name of SIX.filter((n) => n !== 'w-swarm')) {
    it(`${name}.md equals getCommands()`, async () => {
      const md = await fs.readFile(path.join(SHORTCUTS_DIR, `${name}.md`), 'utf-8');
      assert.equal(md, commands[name].content);
    });
  }
  it('w-swarm.md (RuFlo variant) carries the generator\'s callers and lenses blocks verbatim', async () => {
    const md = await fs.readFile(path.join(SHORTCUTS_DIR, 'w-swarm.md'), 'utf-8');
    const g = commands['w-swarm'].content;
    const callers = g.slice(g.indexOf('**🔗 CALLERS'), g.indexOf('**REQUIRED OUTPUT:**\n- Callers of'));
    const lenses = g.slice(g.indexOf('- Lens findings: _____'), g.indexOf('**RETRY LOGIC'));
    assert.ok(callers.length > 500 && lenses.length > 500);
    assert.ok(md.includes(callers), 'callers block');
    assert.ok(md.includes(lenses), 'lenses block');
    assert.ok(md.indexOf('**🔗 CALLERS') > md.indexOf('### ⛔ CHECKPOINT 1: Task Decomposition'));
    assert.ok(md.indexOf('Code Analysis (lenses') > md.indexOf('### ✅ VERIFICATION CHECKPOINT'));
    assert.match(md, /RuFlo Swarm Build/);
  });
});

describe('generator-wide: no quadruple-backslash line continuation, no triple-escaped backtick', () => {
  it('the source has no line ending in four backslashes', async () => {
    const src = await fs.readFile(path.join(__dirname, '..', 'src', 'plugins', 'dot-shortcuts.js'), 'utf-8');
    assert.ok(!/\\\\\\\\$/m.test(src));
    assert.ok(!src.includes('\\\\\\`'), 'no triple-escaped backtick');
  });
  it('every rendered curl continuation carries one backslash and the Pi Brain blocks pass bash -n', () => {
    for (const name of Object.keys(commands)) {
      const c = commands[name].content;
      assert.ok(!/\\\\$/m.test(c), `${name}: a line ends in two backslashes`);
    }
    const s = section('w-compound', 'R=<printed path>; [ -s "$R" ]', '```\n');
    assert.match(s, /pi\.ruv\.io\/v1\/memories \\\n  -H "Content-Type: application\/json" \\\n  --data-binary @"\$R"/);
    const r = spawnSync('bash', ['-n'], { input: s.replace('<printed path>', '/tmp/x') });
    assert.equal(r.status, 0, r.stderr.toString());
  });
});

describe('w-swarm and w-fix: callers at the start, lenses at the verification checkpoint', () => {
  for (const [name, from, to] of [
    ['w-swarm', '### ⛔ CHECKPOINT 1: Agent Spawn', '### ⛔ CHECKPOINT 2'],
    ['w-fix', '### ⛔ CHECKPOINT 1: Investigation', '### ⛔ CHECKPOINT 2'],
  ]) {
    it(`${name}: callers step before the required output`, () => {
      const s = section(name, from, to);
      assertCallers(s);
      assert.ok(s.indexOf('callers --symbol') < s.indexOf('**REQUIRED OUTPUT:**'));
      assert.ok(!s.includes('\\`'));
    });
    it(`${name}: lenses inside the verification checkpoint, before the retry logic`, () => {
      const s = section(name, '### ✅ VERIFICATION CHECKPOINT', '### ⛔ CHECKPOINT 3');
      assertLenses(s);
      assert.ok(s.indexOf('Code Analysis') < s.indexOf('**RETRY LOGIC'));
      assert.ok(!s.includes('\\`'));
    });
  }
});

describe('w-multi-repo', () => {
  it('git reads of a repository you did not write go through safe-git at the top of that checkout', () => {
    const s = section('w-multi-repo', '### ⛔ CHECKPOINT 1: Repos Analyzed', '**REQUIRED OUTPUT:**');
    assertSafeGit(s, /the top directory of that checkout \(the directory that holds its `\.git`\)/);
    assert.match(s, /a repository you did not write/);
  });
  it('lenses at CHECKPOINT 3 Sync Complete, run in each changed repo', () => {
    const s = section('w-multi-repo', '### ⛔ CHECKPOINT 3: Sync Complete', '### ⛔ CHECKPOINT 4');
    assertLenses(s);
    assert.match(s, /in each repository you changed, from its top/);
  });
  it('does not grow a verification checkpoint', () => {
    assert.ok(!commands['w-multi-repo'].content.includes('VERIFICATION CHECKPOINT'));
  });
});

describe('w-suite-sync', () => {
  it('git reads of /tmp/suite-upstream go through safe-git with the clone top as --dir', () => {
    const s = section('w-suite-sync', '### ⛔ CHECKPOINT 0: Fetch Upstream', '### ⛔ CHECKPOINT 1');
    assertSafeGit(s, /`\/tmp\/suite-upstream` itself \(the directory the `git clone` above created, not `\/tmp\/suite-upstream\/src`\)/);
    assert.match(s, /git clone --depth 1 https:\/\/github\.com\/danizeeincali\/danizee-claude-suite \/tmp\/suite-upstream/);
    assert.match(s, /safe-git --dir \/tmp\/suite-upstream -- rev-parse HEAD/);
    assert.match(s, /only HEAD and its tree are readable/);
    assert.ok(s.indexOf('git clone --depth 1') < s.indexOf('safe-git --dir'));
  });
  it('lenses at CHECKPOINT 4 Verify No Regressions', () => {
    const s = section('w-suite-sync', '### ⛔ CHECKPOINT 4: Verify No Regressions', '### ⛔ CHECKPOINT 6');
    assertLenses(s);
    assert.ok(s.indexOf('npm test') < s.indexOf('Code Analysis'));
    assert.ok(s.indexOf('Code Analysis') < s.indexOf('**USER GATE:**'));
  });
});

describe('w-compound: redact to a file before the doc and before the Pi Brain POST', () => {
  it('CHECKPOINT 1 redacts the doc text into a file before the doc is written', () => {
    const s = section('w-compound', '### ⛔ CHECKPOINT 1: Storage Complete', '### ⛔ CHECKPOINT 2');
    assert.match(s, /Redact before the solution doc is written/);
    assert.match(s, /When `\.claude\/kit\/secrets` exists/);
    assertRedactBlock(s);
    assert.match(s, /do \*\*not\*\* write the unredacted text into the solution doc/);
    assert.match(s, /Write the solution doc from the file named by `file=`/);
    assert.ok(s.indexOf('redact --keep-lines < "$E"') < s.indexOf('Write the solution doc from the file'));
    assert.ok(s.indexOf('Write the solution doc from the file') < s.indexOf('**AUTO-PROCEED:**'));
  });
  it('CHECKPOINT 7 redacts the body into a file, then POSTs the file with --data-binary', () => {
    const s = section('w-compound', '### 🧠 CHECKPOINT 7', '## Completion Checklist');
    assert.match(s, /Redact before the POST/);
    assertRedactBlock(s);
    assert.match(s, /do \*\*not\*\* POST the unredacted body/);
    const iRedact = s.indexOf('redact --keep-lines < "$E"');
    const iPost = s.indexOf('curl -X POST https://pi.ruv.io/v1/memories');
    assert.ok(iRedact >= 0 && iPost > iRedact, 'redact before the POST');
    assert.equal(s.split('--data-binary @"$R"').length - 1, 2, 'both POSTs send the file');
    assert.ok(!/ -d '/.test(s), 'no inline -d body');
    assert.match(s, /unset `\$R` posts an empty body/);
    assert.match(s, /\[ -s "\$R" \] \|\| \{ echo "body file missing or empty" >&2; exit 1; \}/);
    assert.match(s, /rm -f -- "\$E" "\$R"/);
  });
});

describe('w-ralph-batch: the generated log pipe runs through redact', () => {
  const gen = () => section('w-ralph-batch', 'set -e\nLOG_FILE=', 'log "╔');
  it('has a runtime guard on the kit and the secrets file, plain tee otherwise', () => {
    const s = gen();
    assert.match(s, /KIT=\.claude\/helpers\/kit\/cli\.js/);
    assert.match(s, /if \[ -f "\$KIT" \] && \{ \[ -e "\$SECRETS" \] \|\| \[ -L "\$SECRETS" \] \|\| \[ -e "\$MAIN_SECRETS" \] \|\| \[ -L "\$MAIN_SECRETS" \]; \}; then/);
    assert.match(s, /node "\$KIT" redact --keep-lines/);
    assert.match(s, /\[redact failed exit %s\]/);
    assert.match(s, /printf '%s\\n' "\$line" \| tee -a "\$LOG_FILE"/);
    assert.ok(!s.includes('echo "[$(date'), 'the bare echo | tee pipe is gone');
    const r = spawnSync('bash', ['-n'], { input: s });
    assert.equal(r.status, 0, r.stderr.toString());
  });
  it('names the redact exit codes and the marker', () => {
    const s = section('w-ralph-batch', '**Log redaction (inside the generated script):**', '**For Multi-Project Script:**');
    assert.match(s, /at run time, `\.claude\/helpers\/kit\/cli\.js` exists and so does a secrets file/);
    assert.match(s, /`redact` exit 0 is the redacted line/);
    assert.match(s, /Exit 1 is bad input or an unreadable secrets file, never "nothing to redact"/);
    assert.match(s, /still written to the log, with the marker `\[redact failed exit 1\]`/);
    assert.match(s, /Any other non-zero exit \(for example 127, or a signal\) is a failure of that step/);
  });

  // Run the generated function in a temp dir with a fake kit.
  const run = async ({ kit, secrets, exit, line = 'ran SECRET job' }) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-log-'));
    try {
      if (kit) {
        await fs.mkdir(path.join(dir, '.claude/helpers/kit'), { recursive: true });
        await fs.writeFile(path.join(dir, '.claude/helpers/kit/cli.js'), `
          let s = ''; process.stdin.on('data', d => { s += d; }).on('end', () => {
            if (process.env.FAKE_EXIT && process.env.FAKE_EXIT !== '0') { console.error('kit: fake failure'); process.exit(Number(process.env.FAKE_EXIT)); }
            console.log(JSON.stringify({ text: s.split('SECRET').join('[REDACTED]'), replaced: 1 }));
          });`);
      }
      if (secrets) {
        await fs.mkdir(path.join(dir, '.claude/kit'), { recursive: true });
        await fs.writeFile(path.join(dir, '.claude/kit/secrets'), 'SECRET\n');
      }
      const fn = gen().replace(/LOG_FILE="[^\n]*\n/, 'LOG_FILE=out.log\n');
      const r = spawnSync('bash', ['-c', `${fn}\nlog "$1"\nlog "second line"`, 'x', line], {
        cwd: dir, env: { ...process.env, FAKE_EXIT: String(exit ?? 0), GIT_CEILING_DIRECTORIES: path.dirname(dir) }, encoding: 'utf-8',
      });
      const log = await fs.readFile(path.join(dir, 'out.log'), 'utf-8');
      return { r, log };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
  it('redacts each line when the kit and a secrets file exist', async () => {
    const { r, log } = await run({ kit: true, secrets: true });
    assert.equal(r.status, 0, r.stderr);
    assert.match(log, /\] ran \[REDACTED\] job\n/);
    assert.ok(!log.includes('SECRET'));
    assert.match(log, /\] second line\n/);
    assert.equal(r.stdout, log, 'the console shows what the log holds');
  });
  it('a failed redact (exit 1) still writes the line, with the marker, and the script continues', async () => {
    const { r, log } = await run({ kit: true, secrets: true, exit: 1 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(log, /\] ran SECRET job \[redact failed exit 1\]\n/);
    assert.match(log, /\] second line \[redact failed exit 1\]\n/);
  });
  it('any other non-zero exit is marked with its own status', async () => {
    const { log } = await run({ kit: true, secrets: true, exit: 127 });
    assert.match(log, /\[redact failed exit 127\]/);
  });
  it('is a plain tee with no secrets file, and with no kit', async () => {
    for (const o of [{ kit: true, secrets: false }, { kit: false, secrets: true }, { kit: false, secrets: false }]) {
      const { r, log } = await run({ ...o, exit: 1 });
      assert.equal(r.status, 0, r.stderr);
      assert.match(log, /\] ran SECRET job\n/);
      assert.ok(!log.includes('redact failed'));
    }
  });
});
