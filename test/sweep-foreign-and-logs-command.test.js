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
    const iBuild = s.indexOf('JSON.stringify(b)');
    const iSearch = s.indexOf('curl -sS -G "https://pi.ruv.io/v1/memories/search" --data-urlencode "q@$Q" --data top_k=3');
    const iPost = s.indexOf('curl -sS --fail-with-body -X POST https://pi.ruv.io/v1/memories');
    assert.ok(iRedact >= 0 && iSearch > iRedact && iBuild > iSearch && iPost > iBuild, 'redact the raw fields, then search with the redacted title, then encode, then POST');
    assert.equal(s.split('pi.ruv.io/v1/memories/search').length - 1, 1, 'one search, after the redact fence');
    assert.ok(!s.includes('[recipe title]') && !s.includes('"q='), 'the title is never pasted into the search command');
    assert.match(s, /node -e '[^']*\/\^@title\\s\*\$\/[^']*' "\$R" "\$Q" \|\| \{ echo "no @title in the field file: search skipped" >&2; exit 1; \}/);
    assert.match(s, /trap 'rm -f "\$Q"' EXIT INT TERM/);
    assert.match(s, /with no kit or no secrets file that is `\$E` itself, so the title is read from `\$E`/);
    assert.match(s, /treat the fork check as not done, never as "no similar recipe"/);
    assert.match(s, /append the `@forked_from` block with the matched recipe id to the file `\$R` with the Edit tool/);
    assert.match(s, /const m=\/\^@\(\[A-Za-z_-\]\+\)\\s\*\$\/\.exec\(l\);if\(m\)\{if\(!K\.includes\(m\[1\]\)\)\{console\.error\("unknown label @"\+m\[1\]\);process\.exit\(1\)\}/);
    assert.match(s, /refused as "unknown label @x" rather than read as text of the previous field/);
    assert.match(s, /N=\$\(node -e '[^']*' "\$B\.chk"\) \|\| \{ echo "redact check unreadable: body not sent" >&2; exit 1; \}/);
    assert.match(s, /a check whose output cannot be read \("redact check unreadable: body not sent"\)/);
    assert.match(s, /Exit 22 is an HTTP error from the registry, printed with its body: not submitted, files kept/);
    assert.match(s, /Any other non-zero exit \(for example 6 or 7, no connection, or 127\) is a failure of that step: not submitted, files kept/);
    assert.match(s, /Never read a non-zero exit as submitted/);
    assert.match(s, /never on the JSON body/);
    assert.match(s, /`JSON\.stringify` escapes a quote, a backslash, a tab or another control character/);
    assert.match(s, /```text\n@title\n[\s\S]*\n@description\n[\s\S]*\n@tags\n[\s\S]*\n@steps\n[\s\S]*\n@forked_from\n/);
    assert.match(s, /node \.claude\/helpers\/kit\/cli\.js redact < "\$B" > "\$B\.chk"; RC=\$\?/);
    assert.match(s, /echo "body still holds a secret after encoding: not sent \(replaced=\$N\)" >&2; exit 2;/);
    assert.equal(s.split('--data-binary @"$B"').length - 1, 1, 'one POST, of the encoded body file');
    assert.ok(!s.includes('--data-binary @"$R"'), 'the redacted text file is never posted as the body');
    assert.ok(!/ -d '/.test(s), 'no inline -d body');
    assert.match(s, /unset `\$B` posts an empty body/);
    assert.match(s, /\[ -s "\$B" \] \|\| \{ echo "body file missing or empty" >&2; exit 1; \}/);
    assert.match(s, /rm -f -- "\$E" "\$R"/);
    for (const f of cp7Fences()) assert.ok((f.match(/curl [^\n]*-X POST/g) || []).length <= 1, 'at most one POST per fence');
    assert.ok(!/curl -X POST/.test(s), 'the POST always carries --fail-with-body');
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
    assert.ok(!s.includes('echo "[$(date'), 'the bare echo | tee pipe is gone');
    const all = script();
    assert.ok(!/^echo .*\| tee/m.test(all), 'no line of the script writes the log with a bare echo | tee');
    assert.ok(!/2>&1 \| tee/.test(all), 'claude output does not bypass log()');
    assert.equal(all.split('2>&1 | while IFS= read -r out || [ -n "$out" ]; do log "$out"; done').length - 1, 2, 'each claude -p is streamed through log()');
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
    assert.match(s, /the script's own lines and, one by one, every line `claude -p` prints/);
    assert.match(s, /at run time, `\.claude\/helpers\/kit\/cli\.js` exists and so does a secrets file/);
    assert.match(s, /`redact` exit 0 is the redacted line/);
    assert.match(s, /Exit 1 is bad input or an unreadable secrets file, never "nothing to redact"/);
    assert.match(s, /still written to the log, with the marker `\[redact failed exit 1\]`/);
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

  const bash = (code, cwd) => new Promise((ok) => {
    const ch = spawn('bash', ['-c', code], { cwd });
    let stdout = '', stderr = '';
    ch.stdout.on('data', (d) => { stdout += d; });
    ch.stderr.on('data', (d) => { stderr += d; });
    ch.on('close', (status) => ok({ status, stdout, stderr }));
  });
  const withRepo = async ({ kit = true, secrets = `${PW}\nSUPERSECRET123\n${PEM}\n`, fork = true, postStatus = 200 }, fn) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'compound-cp7-'));
    const received = [];
    const queries = [];
    const srv = http.createServer((q, r) => {
      let b = '';
      q.on('data', (d) => { b += d; }).on('end', () => {
        if (q.method === 'GET') { queries.push(q.url); r.end('{"results":[]}'); return; }
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
        search: (R) => bash(fill(search, { R }).replace('https://pi.ruv.io', url), repo),
        build: (R) => bash(fill(build, { R, E }), repo),
        post: (B, R) => bash(fill(post, { B, R, E }).replace('https://pi.ruv.io', url), repo),
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
    for (const o of [{}, { secrets: null }, { kit: false }]) {
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
    for (const o of [{ kit: false }, { secrets: null }]) {
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
    const strip = (t) => t.split('\n').filter((l) => !/^echo ".*" \| tee -a \$LOG_FILE$|^log "|^Max iterations: 50" 2>&1/.test(l)).join('\n');
    const shipped = r.stdout;
    const ported = c();
    const a = ported.indexOf('KIT=.claude/helpers/kit/cli.js');
    const b = ported.indexOf('}\n', ported.indexOf('log() {')) + 2;
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
  it('every line claude -p prints goes through log() and is redacted, and the script carries on', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-claude-'));
    try {
      await fs.mkdir(path.join(dir, '.claude', 'kit'), { recursive: true });
      await fs.cp(path.join(__dirname, '..', '.claude', 'helpers', 'kit'), path.join(dir, '.claude', 'helpers', 'kit'), { recursive: true });
      await fs.writeFile(path.join(dir, '.claude', 'kit', 'secrets'), 'SUPERSECRET123\n');
      spawnSync('git', ['init', '-q'], { cwd: dir });
      const s = section('w-ralph-batch', '#!/bin/bash\n# Ralph Batch - Generated [DATE]', '```\n').replace(/LOG_FILE="[^\n]*\n/, 'LOG_FILE=out.log\n');
      const fake = 'claude() { printf "using SUPERSECRET123\\nsecond SUPERSECRET123 line\\nno newline at end"; return 3; }\n';
      const r = spawnSync('bash', ['-c', fake + s], { cwd: dir, encoding: 'utf-8' });
      assert.equal(r.status, 0, r.stderr);
      const log = await fs.readFile(path.join(dir, 'out.log'), 'utf-8');
      assert.ok(!log.includes('SUPERSECRET123'));
      assert.ok(log.startsWith('log redaction: on\n[') && log.split('log redaction:').length - 1 === 1, 'one status line, before the first log line');
      assert.equal(log.split('] using [REDACTED]\n').length - 1, 2, 'both candidates');
      assert.equal(log.split('] no newline at end\n').length - 1, 2, 'a last line without a newline is kept');
      assert.match(log, /\] Ralph Batch Complete: /);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
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
      assert.match(s, /curl -s -G "https:\/\/pi\.ruv\.io\/v1\/memories\/search" --data-urlencode "q=\[task description\]" --data top_k=3/);
      assert.match(s, /\*\*REQUIRED OUTPUT:\*\*\n- Pi Brain memories found: _____ \(0\+ results\)\n- Applicable patterns: _____/);
      const cl = c.slice(c.indexOf('## Completion Checklist'));
      assert.ok(cl.indexOf('- [ ] Pi Brain discovery completed (CHECKPOINT 0.5)') >= 0);
      assert.ok(cl.indexOf('- [ ] Pi Brain discovery completed (CHECKPOINT 0.5)') < cl.indexOf('- [ ] Callers (Checkpoint 1) and lenses'));
      // The exact block the generator's w-swarm carried before the RuFlo port (94c7f56).
      assert.equal(s, [
        '### 🧠 CHECKPOINT 0.5: Pi Brain — Knowledge Discovery',
        '**Search the Pi Brain network for existing knowledge matching this task:**',
        '',
        '```bash',
        '# curl, query URL-encoded (preferred)',
        'curl -s -G "https://pi.ruv.io/v1/memories/search" --data-urlencode "q=[task description]" --data top_k=3',
        '',
        '# HTTP fallback',
        'curl -s "https://pi.ruv.io/v1/memories/search?q=[task description]&top_k=3"',
        '```',
        '',
        '**If matching memories found:** Review steps for applicable patterns. Adapt proven approaches. Note memory IDs for voting later.',
        '**If no matches:** Proceed normally.',
        '',
        '**REQUIRED OUTPUT:**',
        '- Pi Brain memories found: _____ (0+ results)',
        '- Applicable patterns: _____',
        '',
        '---',
        '',
        '',
      ].join('\n'));
    }
  });
});
