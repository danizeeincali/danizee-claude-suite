/**
 * Contract for the /w-bbs and /bbs command content — stream `command-docs` of marathon 2026-10-07-bbs.
 * Pattern: test/w-marathon-command.test.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { inventoryBrief } from '../src/lib/bbs/inventory.js';
import { mapBrief } from '../src/lib/bbs/harness-map.js';
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
    const b = inventoryBrief({ source: { type: 'git', ref: 'x', identity: 'y' }, files: { root: 'fetched/x', files: [{ path: 'a.js', size: 1 }], total: 1 }, maxPowers: 12 });
    assert.match(b, /node \.claude\/helpers\/kit\/cli\.js safe-git --dir <clone top> -- <git args>/);
    assert.match(b, /Plain `git -C fetched\/\.\.\.` is never used/);
    for (const code of ['0 git ran', '1 bad input', '2 refused', '3 git itself failed']) assert.ok(b.includes(code), code);
    assert.match(b, /never "nothing found"/);
    assert.match(b, /missing, read the files directly and never run git on the clone/);
    assert.match(b, /JSON/);
    assert.match(b, /Do not execute/);
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

  it('CHECKPOINT 4 redacts probe evidence before recording, with kit guard, mktemp, trap and every exit named', () => {
    const s = section('### ⛔ CHECKPOINT 4', '3. **Show the verdict table');
    assert.match(s, NOKIT);
    assert.match(s, /\.claude\/kit\/secrets/);
    assert.match(s, /recorded as is, nothing to redact/);
    assert.match(s, /redact --keep-lines/);
    assert.match(s, /mktemp/);
    assert.match(s, /trap 'rm -f "\$J"' EXIT INT TERM/);
    assert.match(s, /Exit 0: redacted/);
    assert.match(s, /Exit 1 is bad input/);
    assert.match(s, /never read exit 1 as "nothing to redact"/);
    assert.ok(s.indexOf('redact --keep-lines') < s.indexOf('verdict --probe'));
  });

  it('CHECKPOINT 6 stages without fetched/ and scrubs before /bc, naming exits 0, 1, 2 and configured: false', () => {
    const s = section('### ⛔ CHECKPOINT 6', '## `--resume');
    assert.match(s, NOKIT);
    assert.match(s, /git add -A -- \. ':!fetched'/);
    assert.match(s, /scrub --worktree/);
    assert.match(s, /Exit 0 clean/);
    assert.match(s, /configured: false/);
    assert.match(s, /Exit 2 means hits[^]*do \*\*not\*\* run `\/bc` until they are removed/);
    assert.match(s, /Exit 1 is wrong input/);
    assert.match(s, /never read a non-zero exit as clean/);
    assert.ok(s.indexOf('scrub --worktree') < s.indexOf('Then `/bc`'));
  });

  it('the closing checklist carries the kit line', () => {
    assert.match(section('## Completion Checklist', '## Example'), /Kit steps \(safe-git[^)]*redact[^)]*scrub[^)]*\)/);
  });
});
