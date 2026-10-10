/**
 * Contract for the /w-bbs and /bbs command content — stream `command-docs` of marathon 2026-10-07-bbs.
 * Pattern: test/w-marathon-command.test.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { inventoryBrief, SAFE_GIT_LINES } from '../src/lib/bbs/inventory.js';
import { mapBrief } from '../src/lib/bbs/harness-map.js';
import { READ_SUBCOMMANDS } from '../.claude/helpers/kit/safe-git.js';
import { getCommands } from '../src/plugins/dot-shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(__dirname);
const SHORTCUTS_DIR = path.join(PROJECT_ROOT, '.claude', 'commands', '.shortcuts');

const commands = getCommands();

describe('/w-bbs command content', () => {
  const c = () => commands['w-bbs'].content;

  it('is registered with the right header and description', () => {
    assert.ok(commands['w-bbs'], 'w-bbs missing from getCommands()');
    assert.ok(c().startsWith('# /w-bbs'));
    assert.match(commands['w-bbs'].description, /beg|borrow|steal|absorb/i);
    assert.match(c(), /\/w-bbs <source>/);
    assert.match(c(), /\/bbs\s+\(alias\)|alias.*\/bbs/i);
  });

  it('uses TaskCreate first, never TodoWrite, and lists the seven phases as todos', () => {
    assert.match(c(), /MANDATORY FIRST ACTION/);
    assert.match(c(), /TaskCreate/);
    assert.ok(!c().includes('TodoWrite'));
    for (const phase of ['Intake', 'Fetch', 'Inventory', 'Map', 'Verdict', 'Hand-off', 'Compound']) {
      assert.match(c(), new RegExp(`CHECKPOINT[^\\n]*${phase}`), `phase ${phase} missing`);
    }
  });

  it('names every helper verb it depends on, with the installed path', () => {
    assert.match(c(), /\.claude\/helpers\/bbs\/cli\.js/);
    for (const verb of ['intake', 'fetch', 'inventory --brief', 'inventory --from', 'map --brief', 'map --from', 'verdict', 'verdict --probe', 'verdict --from', 'handoff --marathon', 'status --next', 'report']) {
      assert.match(c(), new RegExp(`cli\\.js ${verb.replace(/ /g, ' ')}`), `verb ${verb} missing`);
    }
    assert.match(c(), /cli\.js map\b/);
  });

  it('carries the non-negotiables: never execute fetched code, GET only, JSON only, one approval, never crawl, exit 2 = refused', () => {
    assert.match(c(), /never execute/i);
    assert.match(c(), /GET only/i);
    assert.match(c(), /JSON only/);
    assert.match(c(), /one approval|only approval|exactly one AskUserQuestion/i);
    assert.match(c(), /AskUserQuestion/);
    assert.match(c(), /never crawl/i);
    assert.match(c(), /exit 2/);
    assert.match(c(), /refused/i);
    assert.match(c(), /safety first/i);
    assert.match(c(), /our rules always win/i);
  });

  it('states the four verdicts and their order of preference', () => {
    for (const v of ['rebuild', 'use', 'buy', 'skip']) assert.match(c(), new RegExp(`\\b${v}\\b`));
    assert.match(c(), /rebuild.*then.*use.*then.*buy|rebuild > use > buy|rebuild, then use, then buy/i);
    assert.match(c(), /permissive licen[cs]e/i);
    assert.match(c(), /sandbox/i);
    assert.match(c(), /probe/i);
  });

  it('prints the egress line after fetch, shows the verdict table, and ends with the marathon resume line', () => {
    assert.match(c(), /egress line/i);
    assert.match(c(), /requests=/);
    assert.match(c(), /verdict table|cli\.js verdict --table/i);
    assert.match(c(), /\/w-marathon --resume/);
  });

  it('carries the model policy: inventory and map helpers on haiku, probes on sonnet, lead on the session model; no premium name', () => {
    assert.match(c(), /Model Policy/);
    assert.match(c(), /haiku/);
    assert.match(c(), /sonnet/);
    assert.match(c(), /session model/);
    assert.ok(!/fable/i.test(c()));
  });

  it('has --resume and --status modes driven by status --next, and names OpenQodex only as the worked example', () => {
    assert.match(c(), /--resume <run-id>/);
    assert.match(c(), /--status/);
    assert.match(c(), /status --next/);
    assert.match(c(), /openqodex/i);
    assert.ok(!/openqodex\.(js|json)|require\(.*openqodex/i.test(c()), 'no OpenQodex-specific code');
  });

  it('has no literal backtick escaping artifacts and no undefined', () => {
    assert.ok(!c().includes('\\`'));
    assert.ok(!c().includes('undefined'));
  });
});

describe('/bbs alias', () => {
  it('invokes .shortcuts:w-bbs with verbatim args and defers the first action to the parent skill', () => {
    assert.ok(commands.bbs, 'bbs alias missing');
    assert.match(commands.bbs.content, /\.shortcuts:w-bbs/);
    assert.match(commands.bbs.content, /verbatim/);
    assert.match(commands.bbs.content, /TaskCreate/);
    assert.match(commands.bbs.description, /alias for \/w-bbs/);
  });
});

describe('repo copy of the shortcuts is regenerated', () => {
  it('w-bbs.md and bbs.md exist in .claude/commands/.shortcuts and equal the generator output', async () => {
    for (const name of ['w-bbs', 'bbs']) {
      const md = await fs.readFile(path.join(SHORTCUTS_DIR, `${name}.md`), 'utf-8');
      assert.equal(md, commands[name].content, `${name}.md differs from getCommands()`);
    }
  });
});

describe('/w-bbs command — review r1 regressions', () => {
  const c = () => commands['w-bbs'].content;
  const section = (from, to) => { const a = c().indexOf(from); const b = c().indexOf(to, a + 1); assert.ok(a >= 0 && b > a, `${from}..${to}`); return c().slice(a, b); };

  it('known source: CHECKPOINT 0 and CHECKPOINT 1 print the reused run\'s report and status and STOP; nothing is re-audited, no jump to the hand-off', () => {
    for (const [from, to] of [['### ⛔ CHECKPOINT 0', '### ⛔ CHECKPOINT 1'], ['### ⛔ CHECKPOINT 1', '### ⛔ CHECKPOINT 2']]) {
      const s = section(from, to);
      assert.match(s, /`known`\s*(is|:)?\s*(true|`true`)|known: true/, `${from} checks known`);
      assert.match(s, /cli\.js report --run <reuse_from>/);
      assert.match(s, /cli\.js status --run <reuse_from>/);
      assert.match(s, /this source at this identity was audited in run <reuse_from>; nothing is re-audited/);
      assert.match(s, /STOP/);
    }
    assert.ok(!/jump to CHECKPOINT 5/.test(c()), 'a known source never jumps to the hand-off of an empty run');
    assert.match(section('### ⛔ CHECKPOINT 0', '### ⛔ CHECKPOINT 1'), /no fetch/i);
  });

  it('--resume appends --run <run-id> to every cli.js verb from then on', () => {
    const s = section('## `--resume <run-id>`', '## `--status`');
    assert.match(s, /append `--run <run-id>` to every `cli\.js` verb/);
    assert.match(s, /ACTIVE run, which may be another intake/);
    for (const cp of ['CHECKPOINT 2', 'CHECKPOINT 3', 'CHECKPOINT 4', 'CHECKPOINT 5']) {
      const i = c().indexOf(`### ⛔ ${cp}`);
      const next = c().indexOf('### ⛔ CHECKPOINT', i + 5);
      assert.match(c().slice(i, next), /\[--run <id>\]/, `${cp} shows [--run <id>]`);
    }
  });

  it('the verdict question: three options, changes answered via Other as <power>=<verdict> pairs, the decisions JSON shape stated, never a second question', () => {
    const s = section('### ⛔ CHECKPOINT 4', '**The four verdicts');
    assert.match(s, /"Approve as shown \(defaults\)"/);
    assert.match(s, /"Approve with changes — I will type them"/);
    assert.match(s, /"Stop here \(skip everything\)"/);
    assert.ok(!/Change some verdicts/.test(c()));
    assert.match(s, /Other/);
    assert.match(s, /<power>=<verdict>/);
    assert.match(s, /separated by spaces/);
    assert.match(s, /\{ "<power>": "rebuild\|use\|buy\|skip" \}/);
    assert.match(s, /verdict --from <file>/);
    assert.match(s, /unparsable/i);
    assert.match(s, /print(s)? the table again with the resume line/i);
    assert.match(s, /no second question/i);
  });
});

describe('/w-bbs command — review r2 regressions', () => {
  const c = () => commands['w-bbs'].content;
  const section = (from, to) => { const a = c().indexOf(from); const b = c().indexOf(to, a + 1); assert.ok(a >= 0 && b > a, `${from}..${to}`); return c().slice(a, b); };

  it('a refusal is never routed around: a verdict outside the row\'s legal list is unparsable, exit 2 is reported verbatim with the resume line, an owner\'s choice is never edited', () => {
    const s = section('### ⛔ CHECKPOINT 4', '**The four verdicts');
    assert.match(s, /legal/);
    assert.match(s, /not in that row's `legal` list/);
    assert.match(s, /exit 2/);
    assert.match(s, /verbatim/);
    assert.match(s, /never edit an owner's choice/i);
    assert.ok(!c().includes('fix the file'));
    assert.ok(!/rerun/i.test(s));
  });

  it('zero approved powers: the hand-off prints the note and the buy memos when resume_line is null; no marathon run is expected', () => {
    const s = section('### ⛔ CHECKPOINT 5', '### ⛔ CHECKPOINT 6');
    assert.match(s, /resume_line is null/);
    assert.match(s, /no marathon run is expected/i);
    assert.match(c(), /Marathon run created and resume line printed — or, with no approved power, the note and memos printed/);
  });

  it('an empty inventory (every helper none_found) passes one powers [] object, reports no powers found and stops before map', () => {
    const s = section('### ⛔ CHECKPOINT 2', '### ⛔ CHECKPOINT 3');
    assert.match(s, /every helper returns `?none_found`?/);
    assert.match(s, /\{ "powers": \[\], "none_found": "<reason>" \}/);
    assert.match(s, /no powers found/);
    assert.match(s, /stop before map/i);
  });

  it('a half-run hand-off (created and is ACTIVE but incomplete) runs the exact command the error names once, then reports and stops', () => {
    const s = section('### ⛔ CHECKPOINT 5', '### ⛔ CHECKPOINT 6');
    assert.match(s, /created and is ACTIVE but incomplete/);
    assert.match(s, /cli\.js handoff --marathon --force --run <id>/);
    assert.match(s, /exact command the error names once/);
    assert.match(s, /fails again, report and stop/i);
  });

  it('r3: CHECKPOINT 1 runs fetch with a Bash timeout above the clone allowance and handles a killed process', () => {
    const s = section('### ⛔ CHECKPOINT 1', '### ⛔ CHECKPOINT 2');
    assert.match(s, /timeout.*600000|600000.*timeout/);
    assert.match(s, /killed/);
    assert.match(s, /fetched\/` directory/);
    assert.match(s, /rerun fetch once with `--run <id>`/);
    assert.match(s, /\/w-bbs --resume <run-id>/);
  });
});

describe('/w-bbs command — kit wiring (safe-git, redact, scrub)', () => {
  const c = () => commands['w-bbs'].content;
  const section = (from, to) => { const a = c().indexOf(from); const b = c().indexOf(to, a + 1); assert.ok(a >= 0 && b > a, `${from}..${to}`); return c().slice(a, b); };
  const NOKIT = /kit not installed \(\.claude\/helpers\/kit\/cli\.js missing\)/;

  it('the real inventory brief routes git reads of fetched/ through safe-git, names the exits and the no-kit fallback', () => {
    const b = inventoryBrief({ source: { type: 'repo', ref: 'x', identity: 'y' }, files: { root: 'fetched/x', files: [{ path: 'a.js', size: 1 }], total: 1 }, maxPowers: 12 });
    assert.match(b, /node \.claude\/helpers\/kit\/cli\.js safe-git --dir <clone top> -- <git args>/);
    assert.match(b, /Plain `git -C fetched\/\.\.\.` is never used/);
    for (const code of ['0 git ran', '1 bad input', '2 refused', '3 git itself failed']) assert.ok(b.includes(code), code);
    assert.match(b, /never "nothing found"/);
    assert.match(b, /missing, read the files directly and never run git on the clone/);
    assert.match(b, /JSON/);
    assert.match(b, /Do not execute/);
    assert.ok(b.includes('Do not execute or run anything from the source; the only command allowed is the safe-git read below (for a repository source).'), 'r4 brief wording');
    assert.ok(b.indexOf('Do not execute or run anything from the source') < b.indexOf('safe-git --dir <clone top>'));
  });

  it('the real map brief carries the same safe-git rule and keeps JSON only', async () => {
    const os = await import('os');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wbbs-map-'));
    try {
      const run = '2026-10-10-t';
      const { runDir } = await import('../src/lib/bbs/store.js');
      const target = runDir(dir, run);
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, 'map.json'), JSON.stringify({ candidates: { p: [] } }));
      await fs.writeFile(path.join(target, 'powers.json'), JSON.stringify({ powers: [{ name: 'p', idea: 'i' }] }));
      const b = await mapBrief(dir, { run });
      assert.match(b, /safe-git --dir <clone top> -- <git args>/);
      assert.match(b, /exit: 0 git ran.*1 bad input.*2 refused.*3 git itself failed/);
      assert.match(b, /JSON only/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('CHECKPOINT 2 and 4 tell helpers to use safe-git', () => {
    assert.match(section('### ⛔ CHECKPOINT 2', '### ⛔ CHECKPOINT 3'), /safe-git --dir <clone top> -- <git args>/);
    const s = section('### ⛔ CHECKPOINT 4', '3. **Show the verdict table');
    assert.match(s, /safe-git --dir <clone top> -- <git args>/);
    assert.match(s, /never plain `git -C fetched/);
    assert.match(s, /1 bad input.*2 refused.*3 git failed or timed out/);
    assert.match(s, /never runs git on the clone/);
  });

  it('r2: safe-git output is described by exit: JSON only on 0 and 3, a kit: line on stderr for 1 and 2 (CP4 and SAFE_GIT_LINES)', () => {
    const s = section('### ⛔ CHECKPOINT 4', '3. **Show the verdict table');
    assert.doesNotMatch(s, /safe-git prints \\`?\{ stdout, stderr, code, exit \}`? and exits/);
    assert.match(s, /read safe-git's process exit code, not a field of its output/);
    assert.match(s, /0 git ok \(it prints `\{ stdout, stderr, code, exit \}`/);
    assert.match(s, /1 bad input \(stdout is empty, the reason is a `kit:` line on stderr/);
    assert.match(s, /2 refused \(stdout is empty, the reason is a `kit: refused:` line on stderr/);
    assert.match(s, /only exit 0 and a git-ran exit 3 print that JSON, a timeout, overflow or kill prints only a `kit:` stderr line/);
    assert.match(s, /3 git failed or timed out \(when git ran and failed it prints `\{ stdout, stderr, code, exit \}` with a non-zero `code`; when git timed out, printed over 256 MiB or was killed by a signal it prints nothing on stdout, only a `kit:` line on stderr, and `--timeout <ms>` raises the 60000 ms default/);
    assert.doesNotMatch(s, /only exits 0 and 3 print that JSON/);
    const g = SAFE_GIT_LINES.join('\n');
    assert.doesNotMatch(g, /^It prints `\{ stdout, stderr, code, exit \}`/m);
    assert.match(g, /Read the process exit code, not a field of the output: exit 0 and an exit 3 where git ran and failed print `\{ stdout, stderr, code, exit \}`; exits 1 and 2, and an exit 3 from a timeout, output over 256 MiB or a signal kill, print nothing on stdout, only a `kit:` \(exits 1 and 3\) or `kit: refused:` \(exit 2\) line on stderr/);
    assert.match(g, /3 git itself failed or timed out; `--timeout <ms>` raises the 60000 ms default/);
    assert.match(g, /1 bad input[^;]*: the reason is the `kit:` line on stderr; fix the call and retry once/);
    assert.match(g, /2 refused[^;]*: the reason is the `kit: refused:` line on stderr; do not retry, name it in evidence/);
  });

  it('r5: exit 3 is handled in one place; CP4 returns `incomplete`, SAFE_GIT_LINES carries an inventory-shaped instruction', () => {
    const s = section('### ⛔ CHECKPOINT 4', '3. **Show the verdict table');
    const g = SAFE_GIT_LINES.join('\n');
    assert.match(s, /Exit 3 is handled one way: a timeout, overflow or kill \(no JSON, a `kit:` line on stderr\) returns `incomplete`; git ran and failed \(JSON with a non-zero `code`\) on a wrong call \(a missing path, history beyond HEAD on the depth-1 clone\) means fix the call and retry once, and only a second failure on a correct call returns `incomplete`\./);
    assert.match(g, /Exit 3 is handled one way: a timeout, overflow or kill \(no JSON, a `kit:` line on stderr\) means stop reading that file and name the failed read \(the `kit:` line\) in the `evidence` of the affected power, or in `none_found` when nothing could be read; git ran and failed \(JSON with a non-zero `code`\) on a wrong call \(a missing path, history beyond HEAD on the depth-1 clone\) means fix the call and retry once, and only a second failure on a correct call means the same: stop reading that file and name the failed read \(the JSON `stderr`\) in the `evidence` of the affected power, or in `none_found` when nothing could be read\./);
    assert.doesNotMatch(g, /returns `incomplete`/);
    assert.doesNotMatch(g, /incomplete/);
    for (const t of [s, g]) {
      assert.match(t, /The clone is depth 1 \(a single commit\), so only HEAD and its tree are readable: asking for history beyond HEAD \(`HEAD~1`, `log` ranges, `rev-list` ranges, `diff` against an older commit\) is a wrong call\./);
      assert.doesNotMatch(t, /it does not make the source `?incomplete`?/);
    }
    assert.doesNotMatch(s, /raises the 60000 ms default: return `incomplete`/);
    assert.equal((s.match(/return(s)? `incomplete`/g) || []).length >= 2, true);
  });

  it('r6: the real brief prints an absolute Clone top ending in fetched/repo, and says listed files start with repo/', () => {
    const root = '/abs/proj/.claude/bbs/runs/r1/fetched';
    const files = { root, files: [{ path: 'repo/a.js', size: 1 }], total: 1 };
    const r = inventoryBrief({ source: { type: 'repo', ref: 'x', identity: 'y' }, files, maxPowers: 12 });
    const line = r.split('\n').find(l => l.startsWith('Clone top (for safe-git --dir): '));
    assert.ok(line, 'clone top line');
    assert.equal(line, `Clone top (for safe-git --dir): ${root}/repo`);
    assert.ok(line.slice('Clone top (for safe-git --dir): '.length).startsWith('/'));
    assert.ok(line.endsWith('fetched/repo'));
    assert.match(r, /listed files start with `repo\/`; drop that prefix in git args/);
    assert.match(r, /the absolute path of `\.claude\/bbs\/runs\/<run-id>\/fetched\/repo`/);
  });

  it('r5: the clone top is defined: the brief prints it for a repo source only, and CP2, CP4 and SAFE_GIT_LINES say what it is', () => {
    const files = { root: '.claude/bbs/runs/r1/fetched', files: [{ path: 'repo/a.js', size: 1 }], total: 1 };
    const r = inventoryBrief({ source: { type: 'repo', ref: 'x', identity: 'y' }, files, maxPowers: 12 });
    const line = r.split('\n').find(l => l.startsWith('Clone top (for safe-git --dir): '));
    assert.ok(line, 'clone top line');
    assert.ok(line.endsWith('fetched/repo'));
    assert.equal(line, 'Clone top (for safe-git --dir): .claude/bbs/runs/r1/fetched/repo');
    assert.ok(r.indexOf('Root: .claude/bbs/runs/r1/fetched') < r.indexOf(line));
    for (const type of ['url', 'local', 'paste']) {
      const b = inventoryBrief({ source: { type, ref: 'x', identity: 'y' }, files, maxPowers: 12 });
      assert.doesNotMatch(b, /Clone top/, type);
    }
    assert.match(SAFE_GIT_LINES.join('\n'), /`--dir` takes the clone top: the `Clone top` line the inventory brief prints \(the absolute path of `\.claude\/bbs\/runs\/<run-id>\/fetched\/repo`, the clone itself, not `fetched`\), and paths in git args are relative to it; listed files start with `repo\/`; drop that prefix in git args\./);
    const def = /`<clone top>` is the `Clone top` line the brief prints[^`]*the absolute path of `\.claude\/bbs\/runs\/<run-id>\/fetched\/repo`/;
    for (const [a, z] of [['### ⛔ CHECKPOINT 2', '### ⛔ CHECKPOINT 3'], ['### ⛔ CHECKPOINT 4', '3. **Show the verdict table']]) {
      const t = section(a, z);
      assert.match(t, def, a);
      assert.match(t, /paths in git args are relative to it/, a);
      assert.ok(t.search(def) < t.indexOf('safe-git --dir <clone top>') + 400 && t.indexOf('<clone top>') <= t.search(def) + 1000, a);
    }
  });

  it('r5: CP2 limits the safe-git sentence to repository sources', () => {
    const t = section('### ⛔ CHECKPOINT 2', '### ⛔ CHECKPOINT 3');
    assert.match(t, /For a repository source, tell each helper that every git read of the clone under `fetched\/` goes through `node \.claude\/helpers\/kit\/cli\.js safe-git --dir <clone top> -- <git args>` \(the brief says so\)/);
    assert.doesNotMatch(t, /Spawn inventory helpers[^\n]*\. Tell each helper that every git read/);
  });

  it('r5: CP6 tells the reader to replace <id> in the run-as-is block', () => {
    const t = section('### ⛔ CHECKPOINT 6', '## `--resume');
    const i = t.indexOf("Replace every `<id>` in the block with this run's id (the `<run-id>` from intake) before running it.");
    assert.ok(i > 0);
    assert.ok(i < t.indexOf('```bash'));
  });

  it('r3: safe-git --timeout 1 exits 3 with empty stdout and a kit: line (no JSON)', async () => {
    const os = await import('os');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wbbs-r3-'));
    try {
      const g = (...a) => assert.equal(spawnSync('git', a, { cwd: dir, encoding: 'utf8' }).status, 0, a.join(' '));
      g('init', '-q'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'i');
      await fs.mkdir(path.join(dir, '.claude', 'helpers'), { recursive: true });
      await fs.cp(path.join(PROJECT_ROOT, '.claude', 'helpers', 'kit'), path.join(dir, '.claude', 'helpers', 'kit'), { recursive: true });
      const e = { ...process.env }; delete e.NODE_TEST_CONTEXT;
      const r = spawnSync('node', ['.claude/helpers/kit/cli.js', 'safe-git', '--timeout', '1', '--dir', dir, '--', 'log'], { cwd: dir, env: e, encoding: 'utf8' });
      assert.equal(r.status, 3, r.stderr);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /^kit: .*--timeout <ms>/m);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it('every git subcommand the wired text names is one safe-git allows (READ_SUBCOMMANDS)', async () => {
    const naming = /\(((?:[a-z-]+, )+[a-z-]+)\) goes through `node \.claude\/helpers\/kit\/cli\.js safe-git/;
    const texts = { 'CHECKPOINT 4': section('### ⛔ CHECKPOINT 4', '3. **Show the verdict table'), SAFE_GIT_LINES: SAFE_GIT_LINES.join('\n') };
    const { mapBrief: mb } = await import('../src/lib/bbs/harness-map.js');
    assert.ok(READ_SUBCOMMANDS.includes('ls-tree') && !READ_SUBCOMMANDS.includes('blame'));
    for (const [where, t] of Object.entries(texts)) {
      const m = t.match(naming);
      assert.ok(m, `${where} names its safe-git subcommands`);
      const names = m[1].split(', ');
      assert.ok(names.length >= 5, where);
      for (const n of names) assert.ok(READ_SUBCOMMANDS.includes(n), `${where}: "${n}" is not in READ_SUBCOMMANDS`);
      assert.doesNotMatch(t, /\bblame\b/);
    }
    assert.equal(typeof mb, 'function');
  });

  it('SAFE_GIT_LINES is defined once: harness-map imports it from inventory', async () => {
    const hm = await fs.readFile(path.join(PROJECT_ROOT, 'src/lib/bbs/harness-map.js'), 'utf8');
    assert.doesNotMatch(hm, /const SAFE_GIT_LINES/);
    assert.match(hm, /import \{[^}]*SAFE_GIT_LINES[^}]*\} from '\.\/inventory\.js'/);
  });

  it('the inventory brief has the git section for a repo source only', () => {
    const files = { root: 'fetched', files: [{ path: 'a.js', size: 1 }], total: 1 };
    for (const type of ['url', 'local', 'paste']) {
      const b = inventoryBrief({ source: { type, ref: 'x', identity: 'y' }, files, maxPowers: 12 });
      assert.doesNotMatch(b, /safe-git|Reading the clone with git/, type);
      assert.ok(b.includes('Do not execute or run anything from the source; run no command at all.'), type);
    }
    const r = inventoryBrief({ source: { type: 'repo', ref: 'x', identity: 'y' }, files, maxPowers: 12 });
    assert.match(r, /## Reading the clone with git/);
    assert.match(r, /safe-git --dir <clone top>/);
  });

  it('CHECKPOINT 4 redacts probe evidence before recording, with kit guard, mktemp, trap and every exit named', () => {
    const s = section('### ⛔ CHECKPOINT 4', '3. **Show the verdict table');
    assert.match(s, NOKIT);
    assert.match(s, /\.claude\/kit\/secrets/);
    assert.match(s, /recorded as is, nothing to redact/);
    assert.doesNotMatch(s, /\[ ! -f [^\]]*secrets/);
    assert.match(s, /\[ ! -e "\$S" \] && \[ ! -L "\$S" \] && \[ ! -e "\$M" \] && \[ ! -L "\$M" \]; then echo "no \.claude\/kit\/secrets: evidence recorded as is, nothing to redact/);
    assert.match(s, /a dangling symlink or a directory there is a broken state, not "absent"/);
    assert.match(s, /redact --keep-lines/);
    assert.match(s, /mktemp/);
    assert.match(s, /trap 'rm -f "\$J"; \[ -n "\$KEEP" \] \|\| rm -f "\$R"' EXIT INT TERM/);
    assert.match(s, /Exit 0: redacted/);
    assert.match(s, /console\.error\("replaced="\+j\.replaced\)/);
    assert.match(s, /stderr shows `replaced=<n>`/);
    assert.match(s, /Exit 1 is bad input/);
    assert.match(s, /never read exit 1 as "nothing to redact"/);
    assert.ok(s.indexOf('redact --keep-lines') < s.indexOf('verdict --probe'));
  });

  it('r2: CHECKPOINT 4 records evidence from a file, never pasted into a double-quoted argument', () => {
    const s = section('### ⛔ CHECKPOINT 4', '3. **Show the verdict table');
    assert.doesNotMatch(s, /--evidence "<text>"/);
    assert.doesNotMatch(s, /Use the printed `text` as the evidence/);
    assert.match(s, /verdict --probe <power>=<clean\|found\|incomplete> --evidence "\$\(cat -- "\$R"\)" \[--run <id>\] && rm -f -- "\$R" "\$E"/);
    assert.match(s, /fs\.writeFileSync\(process\.argv\[2\],j\.text\)/);
    assert.match(s, /console\.log\("file="\+process\.argv\[2\]\)/);
    assert.match(s, /\[ \$RC -eq 0 \] && KEEP=1/);
    assert.match(s, /with the Write tool \(never `echo "<text>"` or a heredoc in the shell\)/);
    assert.match(s, /backticks and `\$\( \)` would run as commands/);
    assert.match(s, /the shell would evaluate text from the clone/);
    assert.ok(s.indexOf('file=<path>') < s.indexOf('--evidence "$(cat -- "$R")"'));
    assert.match(s, /R=<printed path>; \[ -s "\$R" \] \|\| \{ echo "evidence file missing or empty" >&2; exit 1; \}; node \.claude\/helpers\/bbs\/cli\.js verdict/);
    assert.match(s, /E=<the path you wrote>; <block>/);
    assert.match(s, /Shell variables do not persist between Bash calls/);
    assert.match(s, /git missing or not a git repository/);
  });

  describe('r2: the generated blocks, run in a scratch repo', () => {
    const block = (head) => { const c = commands['w-bbs'].content; const m = c.slice(c.indexOf(head)).match(/```bash\n([^]*?)\n```/); assert.ok(m, head); return m[1]; };
    const sh = (cwd, script, env = {}) => { const e = { ...process.env, ...env }; delete e.NODE_TEST_CONTEXT; return spawnSync('bash', ['-c', script], { cwd, env: e, encoding: 'utf8' }); };
    const scratch = async () => {
      const os = await import('os');
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wbbs-r2-'));
      const g = (...a) => assert.equal(spawnSync('git', a, { cwd: dir, encoding: 'utf8' }).status, 0, a.join(' '));
      g('init', '-q'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'i');
      await fs.mkdir(path.join(dir, '.claude', 'helpers'), { recursive: true });
      await fs.mkdir(path.join(dir, '.claude', 'kit'), { recursive: true });
      await fs.cp(path.join(PROJECT_ROOT, '.claude', 'helpers', 'kit'), path.join(dir, '.claude', 'helpers', 'kit'), { recursive: true });
      return dir;
    };

    it('CP4: nothing at the secrets path is "nothing to redact"; a dangling symlink or a directory there surfaces redact exit 1', async () => {
      const dir = await scratch();
      try {
        const E = path.join(dir, 'E.txt');
        await fs.writeFile(E, 'evidence\n');
        const cp4 = block('### ⛔ CHECKPOINT 4');
        let r = sh(dir, cp4, { E });
        assert.equal(r.status, 0);
        assert.match(r.stdout, /nothing to redact: record from file=/);
        const sec = path.join(dir, '.claude', 'kit', 'secrets');
        await fs.symlink(path.join(dir, 'nope'), sec);
        r = sh(dir, cp4, { E });
        assert.equal(r.status, 1, 'dangling symlink');
        assert.doesNotMatch(r.stdout + r.stderr, /nothing to redact/);
        assert.match(r.stderr, /redact failed \(exit 1\)/);
        assert.doesNotMatch(r.stdout, /file=/);
        await fs.rm(sec);
        await fs.mkdir(sec);
        r = sh(dir, cp4, { E });
        assert.equal(r.status, 1, 'directory');
        assert.doesNotMatch(r.stdout + r.stderr, /nothing to redact/);
        assert.match(r.stderr, /redact failed \(exit 1\)/);
      } finally { await fs.rm(dir, { recursive: true, force: true }); }
    });

    it('CP4: redacted evidence lands in a kept file and the documented record form does not evaluate it', async () => {
      const dir = await scratch();
      let R;
      try {
        await fs.writeFile(path.join(dir, '.claude', 'kit', 'secrets'), 'supersecretvalue123\n');
        const E = path.join(dir, 'E.txt');
        const evil = 'fetch(`${BASE}/t`) $(touch PWNED) `touch PWNED2` key=supersecretvalue123\n';
        await fs.writeFile(E, evil);
        const r = sh(dir, block('### ⛔ CHECKPOINT 4'), { E });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stderr, /replaced=1/);
        const m = r.stdout.match(/^file=(.+)$/m);
        assert.ok(m, r.stdout);
        R = m[1];
        const kept = await fs.readFile(R, 'utf8');
        assert.equal(kept, evil.replace('supersecretvalue123', '[REDACTED]'));
        const rec = sh(dir, 'node -e \'process.stdout.write(process.argv[1])\' -- "$(cat -- "$R")"', { R });
        assert.equal(rec.stdout, kept.replace(/\n$/, ''));
        // the documented record shape, with the path bound in the same command: the guard runs before node
        const cp4 = block('### ⛔ CHECKPOINT 4').length && commands['w-bbs'].content;
        const shape = cp4.match(/`(R=<printed path>; \[ -s "\$R" \][^`]*?)node \.claude\/helpers\/bbs\/cli\.js verdict/);
        assert.ok(shape, 'record shape');
        const guard = shape[1].replace('<printed path>', R);
        assert.equal(sh(dir, guard + 'echo bound').stdout, 'bound\n');
        const unset = sh(dir, guard.replace(/^R=[^;]*;/, 'R=;') + 'echo bound');
        assert.equal(unset.status, 1);
        assert.match(unset.stderr, /evidence file missing or empty/);
        assert.doesNotMatch(unset.stdout, /bound/);
        await assert.rejects(fs.access(path.join(dir, 'PWNED')));
        await assert.rejects(fs.access(path.join(dir, 'PWNED2')));
      } finally { await fs.rm(dir, { recursive: true, force: true }); if (R) await fs.rm(R, { force: true }); }
    });

    it('CP6: a refused scrub unstages the run paths; the rerun after the fix re-adds them', async () => {
      const dir = await scratch();
      try {
        const cp6 = block('### ⛔ CHECKPOINT 6: Compound').replaceAll('<id>', 'r1');
        await fs.mkdir(path.join(dir, '.claude', 'bbs', 'runs', 'r1'), { recursive: true });
        await fs.writeFile(path.join(dir, '.claude', 'bbs', 'runs', 'r1', 'notes.md'), 'tok=SECRETHIT\n');
        await fs.writeFile(path.join(dir, '.claude', 'bbs', 'registry.jsonl'), '{}\n');
        await fs.writeFile(path.join(dir, '.claude', 'kit', 'scrub-patterns'), 'SECRETHIT\n');
        const staged = () => spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
        let r = sh(dir, cp6);
        assert.equal(r.status, 2);
        assert.match(r.stderr, /unstaged \.claude\/bbs\/runs\/r1 \.claude\/bbs\/registry\.jsonl/);
        assert.equal(staged(), '');
        await fs.writeFile(path.join(dir, '.claude', 'bbs', 'runs', 'r1', 'notes.md'), 'tok=clean\n');
        r = sh(dir, cp6);
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(staged().split('\n').sort(), ['.claude/bbs/registry.jsonl', '.claude/bbs/runs/r1/notes.md']);
      } finally { await fs.rm(dir, { recursive: true, force: true }); }
    });

    it('r4: CP6 lists a hit in the new run dir behind 60 committed hits in an earlier run dir', async () => {
      const dir = await scratch();
      try {
        const g = (...a) => assert.equal(spawnSync('git', a, { cwd: dir, encoding: 'utf8' }).status, 0, a.join(' '));
        await fs.writeFile(path.join(dir, '.claude', 'kit', 'scrub-patterns'), 'SECRETHIT\n');
        await fs.mkdir(path.join(dir, '.claude', 'bbs', 'runs', 'aaa'), { recursive: true });
        for (let i = 1; i <= 60; i++) await fs.writeFile(path.join(dir, '.claude', 'bbs', 'runs', 'aaa', `f${String(i).padStart(2, '0')}.txt`), 'tok=SECRETHIT\n');
        g('add', '.claude/bbs/runs/aaa');
        g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'aaa');
        await fs.mkdir(path.join(dir, '.claude', 'bbs', 'runs', 'zzz'), { recursive: true });
        await fs.writeFile(path.join(dir, '.claude', 'bbs', 'runs', 'zzz', 'probe.json'), '{"k":"SECRETHIT"}\n');
        const r = sh(dir, block('### ⛔ CHECKPOINT 6: Compound').replaceAll('<id>', 'zzz'));
        assert.equal(r.status, 2, r.stderr);
        const j = JSON.parse(r.stdout);
        assert.equal(j.hit_count, 61);
        assert.equal(j.truncated, false);
        assert.equal(j.hits_not_shown, 0);
        assert.equal(j.hits.length, 61);
        assert.ok(j.hits.some(h => h.file === '.claude/bbs/runs/zzz/probe.json'), 'the new run-path hit is listed');
        assert.match(r.stderr, /unstaged \.claude\/bbs\/runs\/zzz \.claude\/bbs\/registry\.jsonl/);
        assert.equal(spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).stdout.trim(), '');
      } finally { await fs.rm(dir, { recursive: true, force: true }); }
    });

    it('r3: CP6 on a --shared clone: scrub exit 2 with a kit: refused: line and no JSON, run paths unstaged', async () => {
      const src = await scratch();
      const os = await import('os');
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wbbs-r3-shared-'));
      try {
        assert.equal(spawnSync('git', ['clone', '-q', '--shared', src, dir], { encoding: 'utf8' }).status, 0);
        await fs.mkdir(path.join(dir, '.claude', 'helpers'), { recursive: true });
        await fs.mkdir(path.join(dir, '.claude', 'kit'), { recursive: true });
        await fs.cp(path.join(PROJECT_ROOT, '.claude', 'helpers', 'kit'), path.join(dir, '.claude', 'helpers', 'kit'), { recursive: true });
        await fs.mkdir(path.join(dir, '.claude', 'bbs', 'runs', 'r1'), { recursive: true });
        await fs.writeFile(path.join(dir, '.claude', 'bbs', 'runs', 'r1', 'notes.md'), 'tok=SECRETHIT\n');
        await fs.writeFile(path.join(dir, '.claude', 'kit', 'scrub-patterns'), 'SECRETHIT\n');
        const r = sh(dir, block('### ⛔ CHECKPOINT 6: Compound').replaceAll('<id>', 'r1'));
        assert.equal(r.status, 2, r.stderr);
        assert.equal(r.stdout, '');
        assert.match(r.stderr, /kit: refused:/);
        assert.match(r.stderr, /unstaged \.claude\/bbs\/runs\/r1/);
        assert.equal(spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).stdout.trim(), '');
      } finally { await fs.rm(dir, { recursive: true, force: true }); await fs.rm(src, { recursive: true, force: true }); }
    });
  });

  it('r3: CHECKPOINT 6 reads scrub exit 2 with a kit: refused: line and no JSON as nothing scanned, advisory, never as no run-path hits', () => {
    const s = section('### ⛔ CHECKPOINT 6', '## `--resume');
    assert.match(s, /Exit 2 with no JSON and a `kit: refused:` line on stderr \(object alternates from a `--shared` or `--reference` clone, over 100000 loose objects, `\.git` on a network path, over 200000 tracked files\) means nothing was scanned: report the reason verbatim/);
    assert.match(s, /never read as "no hits in this run's paths"/);
    assert.match(s, /the lead is not told to remove hits/);
    assert.match(s, /Treat it as advisory like exit 1: the lead sees the reason before `\/bc`, and the block still unstages as for any non-zero exit/);
    assert.match(s, /git failed or timed out \(raise with `--timeout <ms>`\)/);
  });

  it('CHECKPOINT 6 stages only the own paths of the run and scrubs before /bc, naming exits 0, 1, 2 and configured: false', () => {
    const s = section('### ⛔ CHECKPOINT 6', '## `--resume');
    assert.match(s, NOKIT);
    assert.doesNotMatch(s, /git add -A|git add \.|:!fetched/);
    assert.match(s, /git add -- "\.claude\/bbs\/runs\/<id>"/);
    assert.match(s, /git add -- \.claude\/bbs\/registry\.jsonl/);
    assert.match(s, /rest of the index is left as the user had it/);
    assert.match(s, /a hit in a file outside this run's paths is reported but is not this run's and does not block `\/bc`/);
    assert.match(s, /scrub --worktree/);
    assert.match(s, /Exit 0 clean/);
    assert.match(s, /configured: false/);
    assert.match(s, /Exit 2 means hits[^]*do \*\*not\*\* run `\/bc` until the hits in this run's paths are removed/);
    assert.match(s, /Exit 1 is wrong input/);
    assert.match(s, /never read a non-zero exit as clean/);
    assert.ok(s.indexOf('scrub --worktree') < s.indexOf('Then `/bc`'));
  });

  it('r2: CHECKPOINT 6 unstages the run paths on any non-zero exit, checks the unstage, and says the rerun re-adds them', () => {
    const s = section('### ⛔ CHECKPOINT 6', '## `--resume');
    assert.match(s, /scrub --worktree --json; RC=\$\?; if \[ \$RC -ne 0 \]; then git reset -q -- "\.claude\/bbs\/runs\/<id>" \.claude\/bbs\/registry\.jsonl; U=\$\?;/);
    assert.match(s, /echo "unstage failed \(exit \$U\): still staged: \.claude\/bbs\/runs\/<id> \.claude\/bbs\/registry\.jsonl"/);
    assert.match(s, /\(exit \$RC\); fi/);
    assert.match(s, /On any non-zero exit \(scrub exit 1 or 2, or a failed `git add`\) the block unstages this run's paths/);
    assert.match(s, /as `\/bc` does after a refused scrub/);
    assert.match(s, /owner must unstage those paths before any commit/);
    assert.match(s, /The paths are re-added by the rerun of this block after the hits are removed/);
    assert.ok(s.indexOf('git reset -q') < s.indexOf('Then `/bc`'));
  });

  it('r2: CHECKPOINT 6 exit 2 also blocks on an incomplete scan of a run path or a truncated hit list', () => {
    const s = section('### ⛔ CHECKPOINT 6', '## `--resume');
    assert.match(s, /Exit 2 also blocks `\/bc` when `complete` is `false` and any of this run's paths is listed in `not_scanned`/);
    assert.match(s, /or when `truncated` is `true` \(the hit list was capped, so a hit in this run's paths may be missing from it\)/);
    assert.match(s, /an empty list of run-path hits then does not mean the run is clean/);
  });

  it('r4: CHECKPOINT 6 scrubs with --json, reads run-path hits from the full JSON hits list, and treats hits_not_shown above 0 like truncated', () => {
    const s = section('### ⛔ CHECKPOINT 6', '## `--resume');
    assert.match(s, /node \.claude\/helpers\/kit\/cli\.js scrub --worktree --json; RC=\$\?;/);
    assert.doesNotMatch(s, /scrub --worktree; RC=/);
    assert.match(s, /The block runs it with `--json` so the `hits` list holds every collected hit: without it only the first 50 are listed \(the rest counted in `hits_not_shown`\)/);
    assert.match(s, /read this run's path hits from the JSON `hits` list \(every collected hit, never only the first 50\)/);
    assert.match(s, /`hits_not_shown` must be 0 if it ever appears: a value above 0 means the `hits` list was cut short, so block `\/bc` exactly as for `truncated: true`/);
  });

  it('r4: CHECKPOINT 4 puts the raw evidence file $E outside the repository and removes it on every path', () => {
    const s = section('### ⛔ CHECKPOINT 4', '### ⛔ CHECKPOINT 5');
    assert.match(s, /Write the evidence to a temp file `\$E` outside the repository \(in the session scratchpad or at a `mktemp` path, never under `\.claude\/bbs\/runs\/<id>` or anywhere else in the repository, where CP6's `git add` would stage the unredacted text/);
    assert.match(s, /`\$E` holds the unredacted evidence, so it is removed on every path, recorded or abandoned/);
    assert.match(s, /after a redact exit 1 \(or any other non-zero exit of the block\), a failed record, or evidence the lead decides not to record, run `rm -f -- "\$E" "\$R"` with the literal paths/);
    assert.match(s, /&& rm -f -- "\$R" "\$E"/);
  });

  it('the closing checklist carries the kit line', () => {
    assert.match(section('## Completion Checklist', '## Example'), /Kit steps \(safe-git[^)]*redact[^)]*scrub[^)]*\)/);
  });
});
