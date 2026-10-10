/**
 * Contract for the /w-bbs and /bbs command content — stream `command-docs` of marathon 2026-10-07-bbs.
 * Pattern: test/w-marathon-command.test.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
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

describe('/w-bbs — the usage step (marathon 2026-10-10-bbs-integration)', () => {
  const c = () => commands['w-bbs'].content;
  it('counts the owner\'s workflows before the verdict and never assumes them', () => {
    assert.match(c(), /CHECKPOINT 3a: Usage/);
    assert.ok(c().indexOf('CHECKPOINT 3a: Usage') < c().indexOf('CHECKPOINT 4: Verdict'));
    assert.match(c(), /cli\.js usage/);
    assert.match(c(), /Never assume which workflows the owner uses/);
    assert.match(c(), /evidence: none/);
    assert.match(c(), /--workflows <a,b>/);
    assert.match(c(), /5\. Usage: which workflows the owner actually runs/);
  });
});

describe('/w-bbs — the targets step (marathon 2026-10-10-bbs-integration)', () => {
  const c = () => commands['w-bbs'].content;
  it('every power names where it lands before the verdict, and the one question approves it', () => {
    assert.match(c(), /CHECKPOINT 3b: Targets/);
    assert.ok(c().indexOf('CHECKPOINT 3a: Usage') < c().indexOf('CHECKPOINT 3b: Targets'));
    assert.ok(c().indexOf('CHECKPOINT 3b: Targets') < c().indexOf('CHECKPOINT 4: Verdict'));
    assert.match(c(), /cli\.js targets --brief/);
    assert.match(c(), /cli\.js targets --from <file>/);
    assert.match(c(), /\*\*Lands in\*\* column/);
    assert.match(c(), /<power>@<workflow>\[,<workflow>\]/);
    assert.match(c(), /cli\.js targets --set <power>@<workflows>/);
    assert.match(c(), /workflows=a,b/);
    assert.match(c(), /6\. Targets: where each power lands/);
    assert.match(c(), /Building a power is not the deliverable/);
  });

  it('the hand-off queues an integration stream that is gated on wiring and on telling the owner', () => {
    const h = c().slice(c().indexOf('CHECKPOINT 5: Hand-off'), c().indexOf('CHECKPOINT 6'));
    assert.match(h, /one \`integration\` stream queued after them|one `integration` stream queued after them/);
    assert.match(h, /integration\.md/);
    assert.match(h, /wired_<power>/);
    assert.match(h, /delivered\.md/);
    assert.match(h, /never evidence of integration/);
    assert.match(h, /integration plan path/);
  });
});
