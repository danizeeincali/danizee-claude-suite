import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import http from 'http';
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
  assert.match(s, /Exit 1 is wrong input or a broken state, including a git call that ran past the 60000 ms default \(the message names it; rerun with `diff-range --timeout <ms>`\): report it, never skip the step/);
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
  assert.match(s, /Only read-only verbs on safe-git's allow-list are accepted \(for example rev-parse, log, show, ls-tree, cat-file\); any other verb is refused/);
  assert.ok(!s.includes('(rev-parse, rev-list, log, show, diff, ls-files, ls-tree, cat-file)'), 'no fixed list of eight verbs');
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

// CHECKPOINT 0.5 of w-fix and w-swarm: the description goes through a file, redact when a secrets file exists, and a portable, timed curl.
const assertPiSearch = (s, word) => {
  assert.ok(!s.includes('q=[') && !s.includes('# HTTP fallback') && !s.includes('memories/search?q='), 'no pasted or unencoded query');
  assert.match(s, new RegExp(`Write the ${word} description as plain text to a temp file \`\\$D\` outside the repository`));
  assert.match(s, /never into a double-quoted shell argument and never `echo "<text>"` or a heredoc/);
  assert.match(s, /W=\$\(mktemp -d 2>\/dev\/null\) && \[ -n "\$W" \] \|\| \{ echo "mktemp failed: search skipped" >&2; exit 1; \}\n  trap 'rm -rf -- "\$W"' EXIT INT TERM\n  Q="\$W\/q"/);
  assert.match(s, /T=\$\(git rev-parse --show-toplevel 2>\/dev\/null\)/);
  assert.match(s, /\[ -f "\$K" \] \|\| \{ echo "secrets file present but kit missing: not sent \(file kept: \$D\)" >&2; exit 2; \}/);
  assert.match(s, /node "\$K" redact --keep-lines < "\$D" > "\$W\/j"; RC=\$\?/);
  assert.match(s, NO_KIT('redact'));
  assert.equal((s.match(/curl -/g) || []).length, 1, 'one curl call');
  assert.ok(s.includes(`C=$(curl -sS --connect-timeout 10 --max-time 30 -o "$Q.resp" -w '%{http_code}' -G "https://pi.ruv.io/v1/memories/search" --data-urlencode "q@$Q" --data top_k=3); RC=$?`));
  assert.match(s, /case "\$C" in 2\?\?\) cat "\$Q\.resp";; \*\) echo "search failed \(HTTP \$C\): Pi Brain not searched" >&2; cat "\$Q\.resp" >&2; exit 22;; esac/);
  for (const e of [/Exit 0 means a 2xx status/, /Exit 1 is a missing or empty description file/, /Exit 2 is the refusal "secrets file present but kit missing: not sent"/, /Exit 22 is curl exit 0 with a status that is not 2xx/, /Exit 28 is a timeout, 6 or 7 is no connection, and any other non-zero exit is curl's own/, /never as "no matches"/, /the kit is advisory and never blocks a workflow that worked before/]) assert.match(s, e);
};

// CHECKPOINT 7 of w-compound: its bash fences, in order (redact, search, build, post), and a filler for the placeholders.
const cp7Fences = () => [...section('w-compound', '### 🧠 CHECKPOINT 7', '## Completion Checklist').matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]);
const fill = (f, v = {}) => f.replace('<printed body path>', v.B ?? '/tmp/b').replace('<printed path>', v.R ?? '/tmp/r').replace('<the path you wrote>', v.E ?? '/tmp/e').replace('[recipe title]', 't');

describe('repo copies of the six swept shortcuts equal the generator output', () => {
  for (const name of SIX) {
    it(`${name}.md equals getCommands()`, async () => {
      const md = await fs.readFile(path.join(SHORTCUTS_DIR, `${name}.md`), 'utf-8');
      assert.equal(md, commands[name].content);
    });
  }
  it('w-swarm.md (RuFlo variant, generator-ported) carries the callers and lenses blocks verbatim', async () => {
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
    const s = section('w-compound', 'B=<printed body path>; R=<printed path>; E=<the path you wrote>; [ -s "$B" ]', '```\n');
    assert.match(s, /pi\.ruv\.io\/v1\/memories \\\n  -H "Content-Type: application\/json" \\\n  --data-binary @"\$B"/);
    for (const f of cp7Fences()) {
      const r = spawnSync('bash', ['-n'], { input: fill(f) });
      assert.equal(r.status, 0, r.stderr.toString());
    }
  });
});

describe('w-swarm and w-fix: callers at the start, lenses at the verification checkpoint', () => {
  for (const [name, from, to, after] of [
    ['w-swarm', '### ⛔ CHECKPOINT 1: Task Decomposition', '### ⛔ CHECKPOINT 2', '### ⛔ CHECKPOINT 4'],
    ['w-fix', '### ⛔ CHECKPOINT 1: Investigation', '### ⛔ CHECKPOINT 2', '### ⛔ CHECKPOINT 3'],
  ]) {
    it(`${name}: callers step before the required output`, () => {
      const s = section(name, from, to);
      assertCallers(s);
      assert.ok(s.indexOf('callers --symbol') < s.indexOf('**REQUIRED OUTPUT:**'));
      assert.ok(!s.includes('\\`'));
    });
    it(`${name}: lenses inside the verification checkpoint, before the retry logic`, () => {
      const s = section(name, '### ✅ VERIFICATION CHECKPOINT', after);
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
  it('git reads of the mktemp upstream clone go through safe-git with the printed clone top as --dir', () => {
    const s = section('w-suite-sync', '### ⛔ CHECKPOINT 0: Fetch Upstream', '### ⛔ CHECKPOINT 1');
    assertSafeGit(s, /the printed path `\$U` itself \(the directory the `git clone` above created, not `\$U\/src`\)/);
    assert.match(s, /git clone --depth 1 https:\/\/github\.com\/danizeeincali\/danizee-claude-suite "\$U"/);
    assert.match(s, /safe-git --dir "\$U" -- rev-parse HEAD/);
    assert.match(s, /only HEAD and its tree are readable/);
    assert.ok(s.indexOf('git clone --depth 1') < s.indexOf('safe-git --dir'));
  });
  it('clones into a fresh mktemp -d directory, stops on a failed clone, uses the printed path everywhere and removes it by its literal path', async () => {
    const c = commands['w-suite-sync'].content;
    assert.ok(!c.includes('/tmp/suite-upstream'), 'no fixed shared /tmp path');
    const s = section('w-suite-sync', '### ⛔ CHECKPOINT 0: Fetch Upstream', '### ⛔ CHECKPOINT 1');
    assert.match(s, /U=\$\(mktemp -d 2>\/dev\/null\) && \[ -n "\$U" \] \|\| \{ echo "mktemp failed: upstream not fetched, sync stopped" >&2; exit 1; \}/);
    assert.match(s, /\|\| \{ RC=\$\?; echo "git clone failed \(exit \$RC\): upstream not fetched, sync stopped" >&2; rm -rf -- "\$U"; exit \$RC; \}/);
    assert.match(s, /On a non-zero exit stop this workflow there and report it as printed/);
    assert.match(s, /use it for every safe-git `--dir`, `ls` and copy below/);
    for (const d of ['src/plugins/', 'src/lib/', 'src/templates/', 'docs/']) assert.ok(s.includes(`ls "$U/${d}"`), d);
    const cp3 = section('w-suite-sync', '### ⛔ CHECKPOINT 3: Build Additive Changes', '### ⛔ CHECKPOINT 4');
    assert.match(cp3, /from the printed clone path `\$U` only/);
    assert.match(cp3, /remove the clone with `rm -rf -- <printed path>`, writing the literal path printed in CHECKPOINT 0 \(never a pathless, variable-only or wildcard `rm`\)/);
    const block = /```bash\n# Clone upstream[^\n]*\n([\s\S]*?)```/.exec(s)[1];
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'suite-sync-'));
    try {
      const bin = path.join(dir, 'bin');
      const tmp = path.join(dir, 'tmp');
      await fs.mkdir(bin); await fs.mkdir(tmp);
      for (const [code, body] of [[128, 'echo "fatal: unable to access" >&2; exit 128'], [0, 'mkdir -p "$5/src"; exit 0']]) {
        await fs.writeFile(path.join(bin, 'git'), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
        const r = spawnSync('bash', ['-c', block], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp }, encoding: 'utf-8' });
        assert.equal(r.status, code, r.stderr);
        if (code) {
          assert.match(r.stderr, /git clone failed \(exit 128\): upstream not fetched, sync stopped/);
          assert.ok(!/upstream clone:/.test(r.stdout), 'no path printed');
          assert.deepEqual(await fs.readdir(tmp), [], 'the failed clone directory is removed');
        } else {
          const U = /^upstream clone: (\S+)$/m.exec(r.stdout)[1];
          assert.equal(path.dirname(U), tmp, 'a fresh directory under TMPDIR');
          assert.equal((await fs.stat(U)).mode & 0o077, 0, 'private');
        }
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
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
    const iBuild = s.indexOf('JSON.stringify(b)');
    const iSearch = s.indexOf(`curl -sS --connect-timeout 10 --max-time 30 -o "$Q.resp" -w '%{http_code}' -G "https://pi.ruv.io/v1/memories/search" --data-urlencode "q@$Q" --data top_k=3`);
    const iPost = s.indexOf(`curl -sS --connect-timeout 10 --max-time 30 -o "$B.resp" -w '%{http_code}' -X POST https://pi.ruv.io/v1/memories`);
    assert.ok(iRedact >= 0 && iSearch > iRedact && iBuild > iSearch && iPost > iBuild, 'redact the raw fields, then search with the redacted title, then encode, then POST');
    assert.equal(s.split('pi.ruv.io/v1/memories/search').length - 1, 1, 'one search, after the redact fence');
    assert.ok(!s.includes('[recipe title]') && !s.includes('"q='), 'the title is never pasted into the search command');
    assert.match(s, /node -e '[^']*\/\^@title\\s\*\$\/[^']*' "\$R" "\$Q" \|\| \{ echo "no @title in the field file: search skipped" >&2; exit 1; \}/);
    assert.match(s, /W=\$\(mktemp -d 2>\/dev\/null\) && \[ -n "\$W" \] \|\| \{ echo "mktemp failed: search skipped" >&2; exit 1; \}\n  trap 'rm -rf -- "\$W"' EXIT INT TERM\n  Q="\$W\/q"/);
    assert.match(s, /trap '\[ -n "\$KEEP" \] \|\| rm -rf -- "\$W"; rm -f -- "\$B\.chk"' EXIT INT TERM/);
    assert.match(s, /B="\$W\/body\.json"/);
    assert.ok(!/(Q|B)=\$\(mktemp 2>/.test(s), 'no bare mktemp file whose siblings are written');
    assert.match(s, /T=\$\(git rev-parse --show-toplevel 2>\/dev\/null\); \[ -n "\$T" \] \|\| T=\.; K="\$T\/\.claude\/helpers\/kit\/cli\.js"; S="\$T\/\.claude\/kit\/secrets"/);
    assert.equal(s.split('secrets file present but kit missing: not sent').length - 1 >= 3, true, 'redact, search and build each refuse');
    assert.match(s, /case "\$C" in 2\?\?\) cat "\$Q\.resp";; \*\) echo "search failed \(HTTP \$C\): fork check not done" >&2; cat "\$Q\.resp" >&2; exit 22;; esac/);
    assert.match(s, /\[ \$RC -eq 0 \] \|\| \{ echo "search failed \(curl exit \$RC\): fork check not done" >&2; exit \$RC; \}/);
    assert.match(s, /Exit 22 is curl exit 0 with a status that is not 2xx \(a 404, a 502 or 503, a proxy or captive-portal page\): it prints "search failed \(HTTP <code>\): fork check not done"/);
    assert.match(s, /Exit 28 is a timeout, 6 or 7 is no connection, and any other non-zero exit is curl's own: "search failed \(curl exit N\): fork check not done"/);
    assert.match(s, /a 10 s connect timeout and a 30 s limit on the whole call; no flag here needs a recent curl/);
    assert.match(s, /with no kit or no secrets file that is `\$E` itself, so the title is read from `\$E`/);
    assert.match(s, /treat the fork check as not done, never as "no similar recipe"/);
    assert.match(s, /append the `@forked_from` block with the matched recipe id to the file `\$R` with the Edit tool/);
    assert.match(s, /const m=\/\^@\(\[A-Za-z_-\]\+\)\\s\*\$\/\.exec\(l\);if\(m\)\{if\(!K\.includes\(m\[1\]\)\)\{console\.error\("unknown label @"\+m\[1\]\);process\.exit\(1\)\}/);
    assert.match(s, /refused as "unknown label @x" rather than read as text of the previous field/);
    assert.match(s, /N=\$\(node -e '[^']*' "\$B\.chk"\) \|\| \{ echo "redact check unreadable: body not sent" >&2; exit 1; \}/);
    assert.match(s, /a check whose output cannot be read \("redact check unreadable: body not sent"\)/);
    assert.match(s, /Exit 22 is curl exit 0 with a status that is not 2xx: it prints the status and the response file, not submitted, files kept/);
    assert.match(s, /Exit 28 is a timeout, 6 or 7 is no connection, and any other non-zero exit \(for example 127\) is curl's own: not submitted, files kept, report it/);
    assert.match(s, /Exit 0 is a 2xx status: submitted .*and the block removes `\$B`, `\$R`, `\$E` and the response file/);
    assert.match(s, /with a 10 s connect timeout and a 30 s limit on the whole call/);
    assert.match(s, /After a timeout or a reset in the middle of the POST \(exit 28, 52 or 56, or the tool being killed\) the registry may already have stored the recipe: before resending, run the search fence above again for the exact title \(`\$R` is kept\) and resend only when that recipe is not already there/);
    assert.match(s, /POST failed \(HTTP \$C\): not submitted, files kept/);
    assert.match(s, /POST failed \(curl exit \$RC\): not submitted, files kept/);
    assert.match(s, /rm -f -- "\$E" "\$R" "\$B" "\$B\.resp"/);
    assert.match(s, /Never read a non-zero exit as submitted/);
    assert.match(s, /never on the JSON body/);
    assert.match(s, /`JSON\.stringify` escapes a quote, a backslash, a tab or another control character/);
    assert.match(s, /```text\n@title\n[\s\S]*\n@description\n[\s\S]*\n@tags\n[\s\S]*\n@steps\n[\s\S]*\n@forked_from\n/);
    assert.match(s, /node "\$K" redact < "\$B" > "\$B\.chk"; RC=\$\?/);
    assert.match(s, /echo "body still holds a secret after encoding: not sent \(replaced=\$N\)" >&2; exit 2;/);
    assert.equal(s.split('--data-binary @"$B"').length - 1, 1, 'one POST, of the encoded body file');
    assert.ok(!s.includes('--data-binary @"$R"'), 'the redacted text file is never posted as the body');
    assert.ok(!/ -d '/.test(s), 'no inline -d body');
    assert.match(s, /unset `\$B` posts an empty body/);
    assert.match(s, /\[ -s "\$B" \] \|\| \{ echo "body file missing or empty" >&2; exit 1; \}/);
    assert.match(s, /rm -f -- "\$E" "\$R"/);
    for (const f of cp7Fences()) assert.ok((f.match(/curl [^\n]*-X POST/g) || []).length <= 1, 'at most one POST per fence');
    assert.ok(!s.includes('--fail-with-body') && !/--fail\b/.test(s), 'no flag newer than curl 7.4x: the status comes from -w');
    for (const f of cp7Fences().filter((x) => x.includes('curl '))) {
      assert.ok((f.match(/curl [^\n]*--connect-timeout 10 --max-time 30 /g) || []).length === 1, 'each curl has both timeouts');
    }
  });
});

describe('w-ralph-batch: the generated log pipe runs through redact', () => {
  const gen = () => section('w-ralph-batch', 'set -e  # Exit on error\nLOG_FILE=', 'log "Starting Ralph Batch Processing..."');
  const script = () => section('w-ralph-batch', '#!/bin/bash\n# Ralph Batch - Generated [DATE]', '```\n');
  it('has a runtime guard on the kit and the secrets file, plain tee otherwise', () => {
    const s = gen();
    assert.match(s, /KIT=\.claude\/helpers\/kit\/cli\.js/);
    assert.match(s, /if \[ -f "\$KIT" \] && \{ \[ -e "\$SECRETS" \] \|\| \[ -L "\$SECRETS" \] \|\| \[ -e "\$MAIN_SECRETS" \] \|\| \[ -L "\$MAIN_SECRETS" \]; \}; then/);
    assert.match(s, /node "\$KIT" redact --keep-lines/);
    assert.match(s, /\[redact failed exit %s\]/);
    assert.match(s, /printf '%s\\n' "\$line" \| tee -a "\$LOG_FILE"/);
    assert.match(s, /log_output\(\) \{/);
    assert.match(s, /json=\$\(node "\$KIT" redact --keep-lines < "\$OUT"\)/);
    assert.match(s, /\{ cat "\$OUT"; \[ -z "\$\(tail -c1 "\$OUT"\)" \] \|\| echo; printf '\[redact failed exit %s\]\\n' "\$rc"; \} \| tee -a "\$LOG_FILE"/);
    assert.match(s, /OUT=\$\(mktemp\) \|\| \{ echo "mktemp failed/);
    assert.match(s, /trap 'rm -f "\$OUT"' EXIT/);
    assert.ok(!s.includes('echo "[$(date'), 'the bare echo | tee pipe is gone');
    const all = script();
    assert.ok(!/^echo .*\| tee/m.test(all), 'no line of the script writes the log with a bare echo | tee');
    assert.ok(!/2>&1 \| tee/.test(all), 'claude output does not bypass redaction');
    assert.ok(!/while IFS= read -r out/.test(all), 'no per-line loop over claude output');
    assert.equal(all.split('Max iterations: 50" > "$OUT" 2>&1 || true\nlog_output\n').length - 1, 2, 'each claude -p is captured in $OUT and redacted once by log_output');
    assert.ok(all.indexOf('log() {') < all.indexOf('log "Starting Ralph Batch Processing..."'));
    assert.ok(all.indexOf('"log redaction: on"') < all.indexOf('log "Starting Ralph Batch Processing..."'), 'the status line comes before the first log call');
    assert.match(s, /printf '%s\\n' "log redaction: on" \| tee -a "\$LOG_FILE"\nelse\n  printf '%s\\n' "log redaction: off \(kit or secrets file not found from \$PWD\)" \| tee -a "\$LOG_FILE"/);
    const rs = spawnSync('bash', ['-n'], { input: all });
    assert.equal(rs.status, 0, rs.stderr.toString());
    const r = spawnSync('bash', ['-n'], { input: s });
    assert.equal(r.status, 0, r.stderr.toString());
  });
  it('names the redact exit codes and the marker', () => {
    const s = section('w-ralph-batch', '**Log redaction (inside the generated script):**', '**Phased Mode - Sequential Priority Execution:**');
    assert.match(s, /pipes each of the script's own one-line messages through/);
    assert.match(s, /`log_output` does the same once for the whole output of each `claude -p` run, which the script captures in a temp file \(`\$OUT`\) instead of piping it line by line \(one `redact` per candidate, not one per line printed\)/);
    assert.match(s, /at run time, `\.claude\/helpers\/kit\/cli\.js` exists and so does a secrets file/);
    assert.match(s, /`redact` exit 0 is the redacted text/);
    assert.match(s, /Exit 1 is bad input or an unreadable secrets file, never "nothing to redact"/);
    assert.match(s, /the unredacted text is still written to the log \(the raw output file for a candidate\), followed by the marker line `\[redact failed exit 1\]`/);
    assert.match(s, /Any other non-zero exit \(for example 127, or a signal\) is a failure of that step/);
    assert.match(s, /writes one line saying which case it is in: `log redaction: on`, or `log redaction: off \(kit or secrets file not found from \$PWD\)`/);
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
      return { r, log, dir };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
  it('redacts each line when the kit and a secrets file exist', async () => {
    const { r, log } = await run({ kit: true, secrets: true });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(log.startsWith('log redaction: on\n['), 'the first log line says redaction is on');
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
      const { r, log, dir } = await run({ ...o, exit: 1 });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(log.startsWith(`log redaction: off (kit or secrets file not found from ${dir})\n[`), `the first log line says redaction is off: ${log.split('\n')[0]}`);
      assert.equal(log.split('log redaction:').length - 1, 1, 'said once');
      assert.match(log, /\] ran SECRET job\n/);
      assert.ok(!log.includes('redact failed'));
    }
  });
});

describe('w-compound CHECKPOINT 7 run as written with the real kit against a local endpoint', () => {
  const KIT = path.join(__dirname, '..', '.claude', 'helpers', 'kit');
  const PW = 'pa"ss\\word99';
  const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nAKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj\n-----END PRIVATE KEY-----';
  const SECRET_BITS = [PW, JSON.stringify(PW).slice(1, -1), 'SUPERSECRET123', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', 'AKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj'];
  const fields = (fork) => `@title\nRotate creds ${PW}\n@description\nUse ${PW} and\tSUPERSECRET123 with:\n${PEM}\n@tags\nsecurity, rotate\n@steps\nexport PW='${PW}' -> env\nload ${PEM.split('\n')[1]} -> agent\n${fork ? '@forked_from\nrec-42\n' : ''}`;

  const bash = (code, cwd, env) => new Promise((ok) => {
    const ch = spawn('bash', ['-c', code], { cwd, env: env ? { ...process.env, ...env } : process.env });
    let stdout = '', stderr = '';
    ch.stdout.on('data', (d) => { stdout += d; });
    ch.stderr.on('data', (d) => { stderr += d; });
    ch.on('close', (status) => ok({ status, stdout, stderr }));
  });
  const withRepo = async ({ kit = true, secrets = `${PW}\nSUPERSECRET123\n${PEM}\n`, fork = true, postStatus = 200, searchStatus = 200, env }, fn) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'compound-cp7-'));
    const received = [];
    const queries = [];
    const srv = http.createServer((q, r) => {
      let b = '';
      q.on('data', (d) => { b += d; }).on('end', () => {
        if (q.method === 'GET') { queries.push(q.url); r.statusCode = searchStatus; r.end(searchStatus === 200 ? '{"results":[]}' : '<html>maintenance, no results here</html>'); return; }
        received.push(b);
        r.statusCode = postStatus;
        r.end(postStatus === 200 ? '{"id":"m1"}' : '{"error":"registry down"}');
      });
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      const repo = path.join(dir, 'repo');
      await fs.mkdir(path.join(repo, '.claude', 'kit'), { recursive: true });
      if (kit) await fs.cp(KIT, path.join(repo, '.claude', 'helpers', 'kit'), { recursive: true });
      if (secrets !== null) await fs.writeFile(path.join(repo, '.claude', 'kit', 'secrets'), secrets);
      spawnSync('git', ['init', '-q'], { cwd: repo });
      const E = path.join(dir, 'fields.txt');
      await fs.writeFile(E, fields(fork));
      const [redact, search, build, post] = cp7Fences();
      const url = `http://127.0.0.1:${srv.address().port}`;
      const steps = {
        redact: () => bash(`E=${E}; ${redact}`, repo),
        search: (R) => bash(fill(search, { R }).replace('https://pi.ruv.io', url), repo, env),
        build: (R) => bash(fill(build, { R, E }), repo),
        post: (B, R) => bash(fill(post, { B, R, E }).replace('https://pi.ruv.io', url), repo, env),
      };
      return await fn({ dir, repo, E, steps, received, queries });
    } finally {
      srv.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
  const exists = (f) => fs.access(f).then(() => true, () => false);

  for (const fork of [true, false]) {
    it(`${fork ? 'a fork' : 'a new recipe'}: one POST, no secret in the received body, temp files removed`, async () => {
      await withRepo({ fork }, async ({ E, steps, received }) => {
        const r1 = await steps.redact();
        assert.equal(r1.status, 0, r1.stderr);
        assert.match(r1.stderr, /replaced=[1-9]/);
        const R = /^file=(\S+)$/m.exec(r1.stdout)[1];
        const r2 = await steps.build(R);
        assert.equal(r2.status, 0, r2.stderr);
        const B = /^body=(\S+)$/m.exec(r2.stdout)[1];
        assert.ok(!(await exists(`${B}.chk`)), 'the check file is gone');
        const r3 = await steps.post(B, R);
        assert.equal(r3.status, 0, r3.stderr);
        assert.equal(received.length, 1, 'exactly one POST from the fence');
        const body = JSON.parse(received[0]);
        for (const bit of SECRET_BITS) assert.ok(!received[0].includes(bit), `the body holds no ${JSON.stringify(bit)}`);
        assert.match(body.title, /^Rotate creds \[REDACTED\]$/);
        assert.deepEqual(body.tags, ['security', 'rotate']);
        assert.equal(body.version, '1.0.0');
        assert.equal(body.steps.length, 2);
        if (fork) assert.equal(body.forked_from, 'rec-42'); else assert.ok(!('forked_from' in body));
        for (const f of [E, R, B]) assert.ok(!(await exists(f)), `${f} removed after the POST`);
      });
    });
  }

  it('refuses with exit 2 when the encoded body still holds a secret, leaving no body file and sending nothing', async () => {
    await withRepo({ secrets: '"version":"1.0.0"\n' }, async ({ steps, received }) => {
      const r1 = await steps.redact();
      assert.equal(r1.status, 0, r1.stderr);
      const R = /^file=(\S+)$/m.exec(r1.stdout)[1];
      const r2 = await steps.build(R);
      assert.equal(r2.status, 2);
      assert.match(r2.stderr, /body still holds a secret after encoding: not sent \(replaced=1\)/);
      assert.ok(!/body=/.test(r2.stdout), 'no body file named');
      assert.equal(received.length, 0);
      await fs.rm(R, { force: true });
    });
  });

  it('a field file the encoder cannot read is exit 1 and names no body', async () => {
    await withRepo({}, async ({ E, steps }) => {
      await fs.writeFile(E, 'stray line\n@title\nx\n');
      const r2 = await steps.build(E);
      assert.equal(r2.status, 1);
      assert.match(r2.stderr, /text before the first @field line/);
      assert.ok(!/body=/.test(r2.stdout));
      const ok = '@title\nx\n@description\nd\n@steps\na\n';
      for (const [bad, label] of [[`${ok}@Tags\nfoo\n@notes\nsecret stuff\n`, '@Tags'], [`${ok}@forked-from\nrec-42\n`, '@forked-from'], [`${ok}@notes  \nsecret stuff\n`, '@notes'], ['@Title\nx\n@description\nd\n@steps\na\n', '@Title']]) {
        await fs.writeFile(E, bad);
        const r = await steps.build(E);
        assert.equal(r.status, 1, `${label}: ${r.stderr}`);
        assert.match(r.stderr, new RegExp(`unknown label ${label}\\n`));
        assert.ok(!/body=/.test(r.stdout));
      }
    });
  });

  const qOf = (u) => new URL(u, 'http://x').searchParams.get('q');
  it('the fork-check search runs after redaction and never receives a secret', async () => {
    await withRepo({}, async ({ steps, queries, received }) => {
      const r1 = await steps.redact();
      assert.equal(r1.status, 0, r1.stderr);
      const R = /^file=(\S+)$/m.exec(r1.stdout)[1];
      const rs = await steps.search(R);
      assert.equal(rs.status, 0, rs.stderr);
      assert.equal(queries.length, 1, 'one search');
      assert.equal(received.length, 0, 'the search posts nothing');
      assert.equal(qOf(queries[0]), 'Rotate creds [REDACTED]');
      assert.equal(new URL(queries[0], 'http://x').searchParams.get('top_k'), '3');
      for (const bit of SECRET_BITS) {
        assert.ok(!queries[0].includes(bit) && !queries[0].includes(encodeURIComponent(bit)) && !qOf(queries[0]).includes(bit), `the search holds no ${JSON.stringify(bit)}`);
      }
      assert.match(rs.stdout, /"results"/);
      await fs.rm(R, { force: true });
    });
  });
  it('a title holding backticks and $( ) is sent as text and runs nothing, with a secrets file and without one', async () => {
    const title = 'Fix `touch PWNED` and $(touch PWNED) "quoted" \'single\' $HOME';
    for (const o of [{}, { secrets: null }, { kit: false, secrets: null }]) {
      await withRepo(o, async ({ dir, repo, E, steps, queries }) => {
        await fs.writeFile(E, `@title\n${title}\n@description\nd\n@steps\na -> b\n`);
        const r1 = await steps.redact();
        assert.equal(r1.status, 0, r1.stderr);
        const R = /file=(\S+)$/m.exec(r1.stdout)[1];
        if (o.secrets === null || o.kit === false) assert.equal(R, E, 'the title is read from $E');
        const rs = await steps.search(R);
        assert.equal(rs.status, 0, rs.stderr);
        assert.equal(queries.length, 1);
        assert.equal(qOf(queries[0]), title, 'the title arrives exactly as written');
        for (const d of [dir, repo]) assert.ok(!(await exists(path.join(d, 'PWNED'))), `no PWNED file in ${d}`);
        const r2 = await steps.build(R);
        assert.equal(r2.status, 0, r2.stderr);
        for (const d of [dir, repo]) assert.ok(!(await exists(path.join(d, 'PWNED'))), `no PWNED file in ${d} after the build`);
      });
    }
  });
  it('a search with no @title is exit 1 and sends nothing', async () => {
    await withRepo({ secrets: null }, async ({ E, steps, queries }) => {
      await fs.writeFile(E, '@description\nd\n@title\n\n@steps\na\n');
      const rs = await steps.search(E);
      assert.equal(rs.status, 1);
      assert.match(rs.stderr, /no @title in the field file: search skipped/);
      assert.equal(queries.length, 0);
    });
  });
  it('a POST answered with HTTP 500 exits 22 and keeps $B, $R and $E for a retry', async () => {
    await withRepo({ postStatus: 500 }, async ({ E, steps, received }) => {
      const r1 = await steps.redact();
      assert.equal(r1.status, 0, r1.stderr);
      const R = /^file=(\S+)$/m.exec(r1.stdout)[1];
      const r2 = await steps.build(R);
      assert.equal(r2.status, 0, r2.stderr);
      const B = /^body=(\S+)$/m.exec(r2.stdout)[1];
      const r3 = await steps.post(B, R);
      assert.equal(r3.status, 22, `curl exit ${r3.status}: ${r3.stderr}`);
      assert.equal(received.length, 1);
      assert.match(r3.stdout + r3.stderr, /registry down/, 'the error body is printed');
      for (const f of [B, R, E]) assert.ok(await exists(f), `${f} kept after the failed POST`);
      await fs.rm(B, { force: true });
      await fs.rm(R, { force: true });
    });
  });
  it('a POST answered with HTTP 500 removes nothing and prints the response file; a 2xx removes the response file too', async () => {
    await withRepo({ postStatus: 500 }, async ({ steps }) => {
      const R = /^file=(\S+)$/m.exec((await steps.redact()).stdout)[1];
      const B = /^body=(\S+)$/m.exec((await steps.build(R)).stdout)[1];
      const r3 = await steps.post(B, R);
      assert.equal(r3.status, 22);
      assert.match(r3.stderr, /POST failed \(HTTP 500\): not submitted, files kept/);
      assert.ok(await exists(`${B}.resp`), 'the response file is kept with the others');
      await fs.rm(`${B}.resp`, { force: true });
      await fs.rm(B, { force: true });
      await fs.rm(R, { force: true });
    });
    await withRepo({}, async ({ steps }) => {
      const R = /^file=(\S+)$/m.exec((await steps.redact()).stdout)[1];
      const B = /^body=(\S+)$/m.exec((await steps.build(R)).stdout)[1];
      const r3 = await steps.post(B, R);
      assert.equal(r3.status, 0, r3.stderr);
      assert.match(r3.stdout, /"id":"m1"/, 'the answer is printed');
      assert.ok(!(await exists(`${B}.resp`)), 'the response file is removed on 2xx');
    });
  });
  // A curl without the newer options: rejects --fail-with-body (7.76+) like 7.64 to 7.74 do, else runs the real one.
  const oldCurl = async (dir, extra = '') => {
    const bin = path.join(dir, 'oldbin');
    await fs.mkdir(bin, { recursive: true });
    const real = spawnSync('bash', ['-c', 'command -v curl'], { encoding: 'utf-8' }).stdout.trim();
    await fs.writeFile(path.join(bin, 'curl'), `#!/bin/bash\nfor a in "$@"; do case "$a" in --fail-with-body) echo "curl: option --fail-with-body: is unknown" >&2; exit 2;; esac; done\n${extra}exec ${real} "$@"\n`, { mode: 0o755 });
    return { PATH: `${bin}:${process.env.PATH}` };
  };
  it('the portable POST works on a curl that lacks --fail-with-body: 2xx submits, 500 keeps the files', async () => {
    for (const postStatus of [200, 500]) {
      const dir0 = await fs.mkdtemp(path.join(os.tmpdir(), 'oldcurl-'));
      try {
        const env = await oldCurl(dir0);
        await withRepo({ postStatus, env }, async ({ E, steps, received }) => {
          const R = /^file=(\S+)$/m.exec((await steps.redact()).stdout)[1];
          const B = /^body=(\S+)$/m.exec((await steps.build(R)).stdout)[1];
          const r3 = await steps.post(B, R);
          assert.equal(received.length, 1);
          assert.ok(!/is unknown/.test(r3.stderr), r3.stderr);
          if (postStatus === 200) {
            assert.equal(r3.status, 0, r3.stderr);
            for (const f of [B, R, E, `${B}.resp`]) assert.ok(!(await exists(f)), `${f} removed`);
          } else {
            assert.equal(r3.status, 22);
            for (const f of [B, R, E]) assert.ok(await exists(f), `${f} kept`);
            for (const f of [B, R, `${B}.resp`]) await fs.rm(f, { force: true });
          }
        });
      } finally {
        await fs.rm(dir0, { recursive: true, force: true });
      }
    }
  });
  it('curl exit 28 (timed out), 6 and 7 (no network) in the POST keep every file and exit with curl\'s own status; the timeouts are passed', async () => {
    for (const code of [28, 6, 7]) {
      const dir0 = await fs.mkdtemp(path.join(os.tmpdir(), 'failcurl-'));
      try {
        const bin = path.join(dir0, 'bin');
        await fs.mkdir(bin);
        await fs.writeFile(path.join(bin, 'curl'), `#!/bin/bash\necho "$@" > "${dir0}/args"\nexit ${code}\n`, { mode: 0o755 });
        await withRepo({ env: { PATH: `${bin}:${process.env.PATH}` } }, async ({ E, steps }) => {
          const R = /^file=(\S+)$/m.exec((await steps.redact()).stdout)[1];
          const B = /^body=(\S+)$/m.exec((await steps.build(R)).stdout)[1];
          const r3 = await steps.post(B, R);
          assert.equal(r3.status, code);
          assert.match(r3.stderr, new RegExp(`POST failed \\(curl exit ${code}\\): not submitted, files kept`));
          for (const f of [B, R, E]) assert.ok(await exists(f), `${f} kept`);
          assert.match(await fs.readFile(`${dir0}/args`, 'utf-8'), /--connect-timeout 10 --max-time 30 /);
          const rs = await steps.search(R);
          assert.equal(rs.status, code);
          assert.match(rs.stderr, new RegExp(`search failed \\(curl exit ${code}\\): fork check not done`));
          assert.ok(!/no similar recipe/.test(rs.stdout));
          for (const f of [B, R]) await fs.rm(f, { force: true });
        });
      } finally {
        await fs.rm(dir0, { recursive: true, force: true });
      }
    }
  });
  it('a search answered with HTTP 503 is "search failed (HTTP 503): fork check not done", never an answer', async () => {
    for (const searchStatus of [503, 404]) {
      await withRepo({ searchStatus }, async ({ steps }) => {
        const R = /^file=(\S+)$/m.exec((await steps.redact()).stdout)[1];
        const rs = await steps.search(R);
        assert.equal(rs.status, 22);
        assert.match(rs.stderr, new RegExp(`search failed \\(HTTP ${searchStatus}\\): fork check not done`));
        assert.equal(rs.stdout, '', 'the error body is not printed as the answer');
        await fs.rm(R, { force: true });
      });
    }
  });
  it('the search also works on a curl without the newer options, and leaves no $Q file behind', async () => {
    const dir0 = await fs.mkdtemp(path.join(os.tmpdir(), 'oldcurl-'));
    try {
      const env = await oldCurl(dir0);
      await withRepo({ env }, async ({ steps }) => {
        const R = /^file=(\S+)$/m.exec((await steps.redact()).stdout)[1];
        const rs = await steps.search(R);
        assert.equal(rs.status, 0, rs.stderr);
        assert.match(rs.stdout, /"results"/);
        await fs.rm(R, { force: true });
      });
    } finally {
      await fs.rm(dir0, { recursive: true, force: true });
    }
  });
  it('a redact check whose output cannot be read is exit 1, not the exit-2 secret refusal, and leaves no body', async () => {
    await withRepo({}, async ({ repo, E, steps, received }) => {
      await fs.writeFile(path.join(repo, '.claude', 'helpers', 'kit', 'cli.js'), "process.stdin.resume().on('end', () => { console.log('not json'); });\n");
      const r2 = await steps.build(E);
      assert.equal(r2.status, 1, r2.stderr);
      assert.match(r2.stderr, /redact check unreadable: body not sent/);
      assert.ok(!/body still holds a secret/.test(r2.stderr));
      assert.ok(!/body=/.test(r2.stdout));
      assert.equal(received.length, 0);
    });
  });

  it('with no kit, and with no secrets file, the redact fence names file=$E in one line and the text is used as is', async () => {
    for (const o of [{ kit: false, secrets: null }, { secrets: null }]) {
      await withRepo(o, async ({ E, steps, received }) => {
        const r1 = await steps.redact();
        assert.equal(r1.status, 0, r1.stderr);
        assert.equal(r1.stdout.trim().split('\n').length, 1, 'one line');
        assert.match(r1.stdout, o.kit === false
          ? /^kit not installed \(\.claude\/helpers\/kit\/cli\.js missing\): redact skipped, advisory: use the text from file=/
          : /^no \.claude\/kit\/secrets: text used as is, nothing to redact: use the text from file=/);
        assert.ok(r1.stdout.trim().endsWith(`file=${E}`), 'names the field file itself');
        const r2 = await steps.build(E);
        assert.equal(r2.status, 0, r2.stderr);
        const B = /^body=(\S+)$/m.exec(r2.stdout)[1];
        const r3 = await steps.post(B, E);
        assert.equal(r3.status, 0, r3.stderr);
        assert.equal(received.length, 1);
        assert.equal(JSON.parse(received[0]).title, `Rotate creds ${PW}`, 'advisory path sends the text as written');
      });
    }
  });
  it('a secrets file with no kit: redact, search and build each refuse with exit 2, send nothing and keep the files', async () => {
    await withRepo({ kit: false }, async ({ E, steps, received, queries }) => {
      const r1 = await steps.redact();
      assert.equal(r1.status, 2, r1.stderr);
      assert.match(r1.stderr, /secrets file present but kit missing: not sent \(files kept: /);
      assert.ok(!/file=/.test(r1.stdout), 'no file named for the search or the body');
      const rs = await steps.search(E);
      assert.equal(rs.status, 2, rs.stderr);
      assert.match(rs.stderr, /secrets file present but kit missing: not sent/);
      const r2 = await steps.build(E);
      assert.equal(r2.status, 2, r2.stderr);
      assert.match(r2.stderr, /secrets file present but kit missing: not sent/);
      assert.ok(!/body=/.test(r2.stdout));
      assert.equal(queries.length, 0, 'no search sent');
      assert.equal(received.length, 0, 'no POST sent');
      assert.ok(await exists(E), '$E kept');
    });
  });
  it('the kit and secrets are found from the repository top when the fences run from a subdirectory', async () => {
    await withRepo({}, async ({ repo, E, received, queries }) => {
      const sub = path.join(repo, 'src', 'deep');
      await fs.mkdir(sub, { recursive: true });
      const [redact, , build] = cp7Fences();
      const run = (code) => new Promise((ok) => { const ch = spawn('bash', ['-c', code], { cwd: sub }); let o = '', e = ''; ch.stdout.on('data', (d) => { o += d; }); ch.stderr.on('data', (d) => { e += d; }); ch.on('close', (status) => ok({ status, stdout: o, stderr: e })); });
      const rr = await run(`E=${E}; ${redact}`);
      assert.equal(rr.status, 0, rr.stderr);
      assert.match(rr.stderr, /replaced=[1-9]/, 'redacted from a subdirectory, not "kit not installed"');
      const R2 = /^file=(\S+)$/m.exec(rr.stdout)[1];
      const rb = await run(fill(build, { R: R2, E }));
      assert.equal(rb.status, 0, rb.stderr);
      assert.match(rb.stdout, /^body=\S+$/m);
      const B = /^body=(\S+)$/m.exec(rb.stdout)[1];
      await fs.rm(path.dirname(B), { recursive: true, force: true });
      await fs.rm(R2, { force: true });
      assert.equal(queries.length + received.length, 0);
    });
  });
  it('the search and the body use a private mktemp -d directory: gone after the search, emptied and removed after a 2xx POST, named when kept', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cp7-tmpdir-'));
    try {
      await withRepo({ env: { TMPDIR: tmp } }, async ({ steps }) => {
        const R = /^file=(\S+)$/m.exec((await steps.redact()).stdout)[1];
        const rs = await steps.search(R);
        assert.equal(rs.status, 0, rs.stderr);
        assert.deepEqual(await fs.readdir(tmp), [], 'the search used a directory under TMPDIR and left nothing there');
        await fs.rm(R, { force: true });
      });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
    await withRepo({}, async ({ steps }) => {
      const R = /^file=(\S+)$/m.exec((await steps.redact()).stdout)[1];
      const B = /^body=(\S+)$/m.exec((await steps.build(R)).stdout)[1];
      const W = path.dirname(B);
      assert.equal(path.basename(B), 'body.json');
      assert.equal((await fs.stat(W)).mode & 0o077, 0, 'the directory is private');
      assert.ok(!(await exists(`${B}.chk`)));
      const r3 = await steps.post(B, R);
      assert.equal(r3.status, 0, r3.stderr);
      assert.ok(!(await exists(W)), 'the emptied directory is removed after a 2xx');
    });
    await withRepo({ postStatus: 500 }, async ({ steps }) => {
      const R = /^file=(\S+)$/m.exec((await steps.redact()).stdout)[1];
      const B = /^body=(\S+)$/m.exec((await steps.build(R)).stdout)[1];
      const r3 = await steps.post(B, R);
      assert.equal(r3.status, 22);
      assert.ok(r3.stderr.includes(`not submitted, files kept in ${path.dirname(B)}`), r3.stderr);
      assert.ok(await exists(B) && await exists(`${B}.resp`));
      await fs.rm(path.dirname(B), { recursive: true, force: true });
      await fs.rm(R, { force: true });
    });
  });
});

describe('w-ralph-batch: the shipped copy is ported into the generator, not replaced by it', () => {
  const c = () => commands['w-ralph-batch'].content;
  it('keeps the shipped modes, rules, per-candidate execution, summary report and diagnostic format', () => {
    const s = c();
    for (const usage of ['/w-ralph-batch --priority P1      # Only process P1 candidates', '/w-ralph-batch --all              # Process all ready candidates sequentially', '/w-ralph-batch --phased           # Execute by priority (P1 → P2 → P3)', '/w-ralph-batch --diagnostics      # Run all diagnostics first, then fixes if needed']) {
      assert.ok(s.includes(usage), usage);
    }
    assert.match(s, /## Rules\n\n- NEVER skip checkpoints - each requires user confirmation\n[\s\S]*- For diagnostics: ALWAYS run RC-D### before paired RC-F###/);
    assert.match(s, /\*\*Interactive Mode - Per Candidate:\*\*\n1\. Load candidate spec\n[\s\S]*5\. Update status \(complete\/in-progress\/blocked\)\n6\. Move to next candidate/);
    assert.match(s, /### ⛔ CHECKPOINT 3: Summary Report/);
    assert.match(s, /\*\*Status Updates:\*\*\n- Candidates marked complete: \[IDs\][\s\S]*- Archived: \[IDs\]/);
    assert.match(s, /\*\*Diagnostic Output Format:\*\*\n```\nDIAGNOSTIC: \[NAME\]\nPATTERN_FOUND: YES\|NO\nLOCATION: \[file:line\] or NONE\nSTATUS: PASS\|FAIL\nACTION: VERIFIED\|RESTORED\|FAILED\n```/);
    assert.match(s, /\*\*Phased Mode - Sequential Priority Execution:\*\*/);
    assert.match(s, /- \[ \] All candidate statuses updated in \.claude\/ralph-candidates\.md\n- \[ \] Successful candidates archived/);
  });
  it('differs from the shipped copy at base 38552ec only by the log() redaction wiring', () => {
    const r = spawnSync('git', ['show', '38552ec:.claude/commands/.shortcuts/w-ralph-batch.md'], { cwd: path.join(__dirname, '..'), encoding: 'utf-8' });
    if (r.status !== 0) return; // shallow clone without the base: the pins above still hold
    const strip = (t) => t.split('\n').filter((l) => !/^echo ".*" \| tee -a \$LOG_FILE$|^log "|^log_output$|^Max iterations: 50" (2>&1|> "\$OUT" 2>&1 \|\| true)/.test(l)).join('\n');
    const shipped = r.stdout;
    const ported = c();
    const a = ported.indexOf('OUT=$(mktemp)');
    const b = ported.indexOf('\n}\n', ported.indexOf('log_output() {')) + 3;
    const p = ported.indexOf('\n**Log redaction (inside the generated script):**');
    const q = ported.indexOf('\n', p + 1) + 1;
    const core = ported.slice(0, a) + ported.slice(b, p) + ported.slice(q);
    assert.equal(strip(core).replace(/\n\n\n/g, '\n\n'), strip(shipped).replace(/\n\n\n/g, '\n\n'));
  });
});

describe('w-ralph-batch log() runs: claude output streamed, and a linked worktree with secrets only in the main checkout', () => {
  const block = () => section('w-ralph-batch', 'set -e  # Exit on error\nLOG_FILE=', 'log "Starting Ralph Batch Processing..."').replace(/LOG_FILE="[^\n]*\n/, 'LOG_FILE=out.log\n');
  const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf-8' }); assert.equal(r.status, 0, r.stderr); return r; };
  it('redacts with the real kit in a linked worktree whose secrets file is only in the main checkout', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-wt-'));
    try {
      const main = path.join(dir, 'main');
      const wt = path.join(dir, 'wt');
      await fs.mkdir(path.join(main, '.claude', 'kit'), { recursive: true });
      await fs.cp(path.join(__dirname, '..', '.claude', 'helpers', 'kit'), path.join(main, '.claude', 'helpers', 'kit'), { recursive: true });
      await fs.writeFile(path.join(main, '.gitignore'), '.claude/kit/\n');
      git(main, 'init', '-q');
      git(main, 'add', '.');
      git(main, 'commit', '-q', '-m', 'kit');
      await fs.writeFile(path.join(main, '.claude', 'kit', 'secrets'), 'pa"ss\\word99\n');
      git(main, 'worktree', 'add', '-q', wt);
      assert.ok(!(await fs.access(path.join(wt, '.claude', 'kit', 'secrets')).then(() => true, () => false)), 'no secrets file in the worktree');
      const env = { ...process.env };
      delete env.GIT_CEILING_DIRECTORIES;
      const r = spawnSync('bash', ['-c', `${block()}\nlog "$1"`, 'x', 'token pa"ss\\word99 used'], { cwd: wt, env, encoding: 'utf-8' });
      assert.equal(r.status, 0, r.stderr);
      const log = await fs.readFile(path.join(wt, 'out.log'), 'utf-8');
      assert.match(log, /\] token \[REDACTED\] used\n$/);
      assert.ok(!log.includes('word99'));
      assert.ok(!log.includes('redact failed'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  // The script with a recording shim as the kit: every redact call's stdin is appended to calls.log between markers.
  const runScript = async (shimExit) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-claude-'));
    try {
      await fs.mkdir(path.join(dir, '.claude', 'kit'), { recursive: true });
      await fs.mkdir(path.join(dir, '.claude', 'helpers', 'kit'), { recursive: true });
      await fs.writeFile(path.join(dir, '.claude', 'kit', 'secrets'), 'SUPERSECRET123\n');
      await fs.writeFile(path.join(dir, '.claude', 'helpers', 'kit', 'cli.js'), `
        const fs = require('fs'); let s = '';
        process.stdin.on('data', d => { s += d; }).on('end', () => {
          fs.appendFileSync('calls.log', '<<' + s + '>>\\n');
          if (${shimExit}) process.exit(${shimExit});
          console.log(JSON.stringify({ text: s.split('SUPERSECRET123').join('[REDACTED]'), replaced: 1 }));
        });`);
      spawnSync('git', ['init', '-q'], { cwd: dir });
      const s = section('w-ralph-batch', '#!/bin/bash\n# Ralph Batch - Generated [DATE]', '```\n').replace(/LOG_FILE="[^\n]*\n/, 'LOG_FILE=out.log\n');
      const fake = 'claude() { printf "using SUPERSECRET123\\nsecond SUPERSECRET123 line\\nno newline at end"; return 3; }\n';
      const r = spawnSync('bash', ['-c', fake + s], { cwd: dir, encoding: 'utf-8' });
      const log = await fs.readFile(path.join(dir, 'out.log'), 'utf-8');
      const calls = await fs.readFile(path.join(dir, 'calls.log'), 'utf-8');
      return { r, log, calls };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
  it('each claude -p output is redacted once as a whole, fully, nothing dropped, status line once, and the script carries on', async () => {
    const { r, log, calls } = await runScript(0);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!log.includes('SUPERSECRET123'));
    assert.ok(log.startsWith('log redaction: on\n[') && log.split('log redaction:').length - 1 === 1, 'one status line, before the first log line');
    assert.equal(log.split('using [REDACTED]\nsecond [REDACTED] line\nno newline at end\n').length - 1, 2, 'both candidates, all three lines each, a last line without a newline kept');
    assert.match(log, /\] Ralph Batch Complete: /);
    const whole = '<<using SUPERSECRET123\nsecond SUPERSECRET123 line\nno newline at end>>\n';
    assert.equal(calls.split(whole).length - 1, 2, 'one redact call per candidate holding the whole output');
    assert.equal(calls.split('<<using ').length - 1, 2, 'never one call per line');
    assert.ok(!log.includes('redact failed'));
    assert.ok(r.stdout.startsWith(log), 'the console shows what the log holds');
  });
  it('a failed redact appends the raw output with the marker once per candidate, drops nothing and carries on', async () => {
    const { r, log } = await runScript(1);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(log.split('using SUPERSECRET123\nsecond SUPERSECRET123 line\nno newline at end\n[redact failed exit 1]\n').length - 1, 2, 'raw text then the marker, both candidates');
    assert.match(log, /\] Starting Ralph Batch Processing\.\.\. \[redact failed exit 1\]\n/, 'the script own lines keep log() and its marker');
    assert.match(log, /\] Ralph Batch Complete: /);
  });
});

describe('w-swarm: Pi Brain CHECKPOINT 0.5 kept in the ported RuFlo variant', () => {
  it('sits after CHECKPOINT 0 Search and before CHECKPOINT 1, as in w-fix, with its checklist line', async () => {
    for (const c of [commands['w-swarm'].content, await fs.readFile(path.join(SHORTCUTS_DIR, 'w-swarm.md'), 'utf-8')]) {
      const i0 = c.indexOf('### ⛔ CHECKPOINT 0: Search');
      const i05 = c.indexOf('### 🧠 CHECKPOINT 0.5: Pi Brain — Knowledge Discovery');
      const i1 = c.indexOf('### ⛔ CHECKPOINT 1: Task Decomposition');
      assert.ok(i0 >= 0 && i05 > i0 && i1 > i05);
      const s = c.slice(i05, i1);
      assertPiSearch(s, 'task');
      assert.match(s, /\*\*REQUIRED OUTPUT:\*\*\n- Pi Brain memories found: _____ \(0\+ results\)\n- Applicable patterns: _____/);
      const cl = c.slice(c.indexOf('## Completion Checklist'));
      assert.ok(cl.indexOf('- [ ] Pi Brain discovery completed (CHECKPOINT 0.5)') >= 0);
      assert.ok(cl.indexOf('- [ ] Pi Brain discovery completed (CHECKPOINT 0.5)') < cl.indexOf('- [ ] Callers (Checkpoint 1) and lenses'));
      // The block the generator's w-swarm carried before the RuFlo port (94c7f56), now with the redacted file-fed search: the same as w-fix's but for the noun.
      const f = section('w-fix', '### 🧠 CHECKPOINT 0.5: Pi Brain — Knowledge Discovery', '### ⛔ CHECKPOINT 1');
      assert.equal(s, f.replaceAll('bug', 'task').replace('applicable fix patterns', 'applicable patterns'));
      assert.ok(s.startsWith('### 🧠 CHECKPOINT 0.5: Pi Brain — Knowledge Discovery\n**Search the Pi Brain network for existing knowledge matching this task:**\n'));
      assert.ok(s.endsWith('**If matching memories found:** Review steps for applicable patterns. Adapt proven approaches. Note memory IDs for voting later.\n**If no matches:** Proceed normally.\n\n**REQUIRED OUTPUT:**\n- Pi Brain memories found: _____ (0+ results)\n- Applicable patterns: _____\n\n---\n\n'));
    }
  });
});

describe('w-fix and w-swarm CHECKPOINT 0.5: the Pi Brain search run as written against a local endpoint', () => {
  const KIT = path.join(__dirname, '..', '.claude', 'helpers', 'kit');
  const fence = (name) => /```bash\n([\s\S]*?)```/.exec(section(name, '### 🧠 CHECKPOINT 0.5', '### ⛔ CHECKPOINT 1'))[1];
  const run = (code, cwd, env) => new Promise((ok) => {
    const ch = spawn('bash', ['-c', code], { cwd, env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    ch.stdout.on('data', (d) => { stdout += d; });
    ch.stderr.on('data', (d) => { stderr += d; });
    ch.on('close', (status) => ok({ status, stdout, stderr }));
  });
  const DESC = 'TypeError at db.connect(postgres://app:SUPERSECRET123@db/x) `touch PWNED` $(touch PWNED) "q" \'s\' & top_k=99';
  const withSearch = async ({ kit = true, secrets = 'SUPERSECRET123\n', status = 200, env = {} }, fn) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-search-'));
    const queries = [];
    const srv = http.createServer((q, r) => { queries.push(q.url); r.statusCode = status; r.end(status === 200 ? '{"results":[]}' : 'down'); });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      const repo = path.join(dir, 'repo');
      await fs.mkdir(path.join(repo, 'sub'), { recursive: true });
      if (kit) await fs.cp(KIT, path.join(repo, '.claude', 'helpers', 'kit'), { recursive: true });
      if (secrets !== null) { await fs.mkdir(path.join(repo, '.claude', 'kit'), { recursive: true }); await fs.writeFile(path.join(repo, '.claude', 'kit', 'secrets'), secrets); }
      spawnSync('git', ['init', '-q'], { cwd: repo });
      const D = path.join(dir, 'desc.txt');
      await fs.writeFile(D, DESC);
      const url = `http://127.0.0.1:${srv.address().port}`;
      const search = (name) => run(fence(name).replace('<the path you wrote>', D).replace('https://pi.ruv.io', url), path.join(repo, 'sub'), { TMPDIR: dir, ...env });
      return await fn({ dir, repo, D, search, queries });
    } finally {
      srv.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
  const exists = (f) => fs.access(f).then(() => true, () => false);
  const qOf = (u) => new URL(u, 'http://x').searchParams;

  for (const name of ['w-fix', 'w-swarm']) {
    it(`${name}: with a secrets file the query is redacted, sent URL-encoded from the file, and nothing in it runs`, async () => {
      await withSearch({}, async ({ dir, repo, search, queries }) => {
        const r = await search(name);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stderr, /replaced=1/);
        assert.equal(queries.length, 1);
        const p = qOf(queries[0]);
        assert.ok(!queries[0].includes('SUPERSECRET123') && !p.get('q').includes('SUPERSECRET123'), 'the secret never leaves');
        assert.equal(p.get('q'), DESC.replace('SUPERSECRET123', '[REDACTED]'));
        assert.equal(p.get('top_k'), '3');
        for (const d of [dir, repo, path.join(repo, 'sub')]) assert.ok(!(await exists(path.join(d, 'PWNED'))), `nothing ran in ${d}`);
        assert.deepEqual((await fs.readdir(dir)).sort(), ['desc.txt', 'repo'], 'the private temp directory is gone');
      });
    });
    it(`${name}: a secrets file with no kit is the exit-2 refusal and sends nothing; no secrets file is advisory and sends the text as written`, async () => {
      await withSearch({ kit: false }, async ({ D, search, queries }) => {
        const r = await search(name);
        assert.equal(r.status, 2, r.stderr);
        assert.match(r.stderr, /secrets file present but kit missing: not sent \(file kept: /);
        assert.equal(queries.length, 0);
        assert.ok(await exists(D), 'the description file is kept');
      });
      for (const kit of [false, true]) {
        await withSearch({ kit, secrets: null }, async ({ search, queries }) => {
          const r = await search(name);
          assert.equal(r.status, 0, r.stderr);
          assert.match(r.stdout, kit ? /^no \.claude\/kit\/secrets: nothing to redact/ : /^kit not installed \(\.claude\/helpers\/kit\/cli\.js missing\): redact skipped, advisory/);
          assert.equal(qOf(queries[0]).get('q'), DESC);
        });
      }
    });
    it(`${name}: a non-2xx answer is exit 22 and a curl failure is curl's own exit, never "no matches"`, async () => {
      await withSearch({ status: 503 }, async ({ search }) => {
        const r = await search(name);
        assert.equal(r.status, 22);
        assert.match(r.stderr, /search failed \(HTTP 503\): Pi Brain not searched/);
        assert.equal(r.stdout.replace(/^.*\n/, ''), '', 'the error body is not printed as the answer');
      });
      const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-curl-'));
      try {
        await fs.writeFile(path.join(bin, 'curl'), '#!/bin/bash\nexit 28\n', { mode: 0o755 });
        await withSearch({ secrets: null, env: { PATH: `${bin}:${process.env.PATH}` } }, async ({ search }) => {
          const r = await search(name);
          assert.equal(r.status, 28);
          assert.match(r.stderr, /search failed \(curl exit 28\): Pi Brain not searched/);
        });
      } finally {
        await fs.rm(bin, { recursive: true, force: true });
      }
    });
  }
  it('w-fix carries the same checks as w-swarm', () => {
    assertPiSearch(section('w-fix', '### 🧠 CHECKPOINT 0.5', '### ⛔ CHECKPOINT 1'), 'bug');
  });
});
