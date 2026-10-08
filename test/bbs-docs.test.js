/**
 * Contract for the /w-bbs documentation — stream `command-docs` of marathon 2026-10-07-bbs.
 * WORKFLOW-SHORTCUTS.md is generated from src/utils/shortcuts.js; README.md is hand-written but checked here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { writeWorkflowShortcuts } from '../src/utils/shortcuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

describe('docs — WORKFLOW-SHORTCUTS.md', () => {
  let md;
  it('the generator output has the /w-bbs table row and a Beg, borrow, steal section with Say/Slash/What it does/Enforcement/Example', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-docs-'));
    try {
      await writeWorkflowShortcuts(dir);
      md = await fs.readFile(path.join(dir, 'WORKFLOW-SHORTCUTS.md'), 'utf-8');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
    assert.match(md, /^\| `\/w-bbs \[source\]` \|.*\(alias `\/bbs`\) \|$/m);
    assert.match(md, /### Beg, borrow, steal/);
    const section = md.slice(md.indexOf('### Beg, borrow, steal'), md.indexOf('---', md.indexOf('### Beg, borrow, steal')));
    for (const h of ['**Say:**', '**Slash:**', '**What it does:**', '**Enforcement:**', '**Example:**']) assert.ok(section.includes(h), `${h} in section`);
    assert.match(section, /\/w-bbs <source>/);
    assert.match(section, /rebuild.*use.*buy.*skip/s);
    assert.match(section, /GET only/i);
    assert.match(section, /never execute/i);
    assert.match(section, /JSON only/);
    assert.match(section, /one approval|only approval/i);
    assert.match(section, /\/w-marathon --resume/);
    assert.match(section, /cli\.js intake/);
    assert.match(section, /openqodex/i);
    assert.ok(!section.includes('undefined'));
  });

  it('the committed WORKFLOW-SHORTCUTS.md equals the generator output', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-docs2-'));
    try {
      await writeWorkflowShortcuts(dir);
      const generated = await fs.readFile(path.join(dir, 'WORKFLOW-SHORTCUTS.md'), 'utf-8');
      const committed = await fs.readFile(path.join(ROOT, 'WORKFLOW-SHORTCUTS.md'), 'utf-8');
      assert.equal(committed, generated);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('docs — README.md', () => {
  let readme;
  it('quick reference has /w-bbs and /bbs rows next to the marathon rows', async () => {
    readme = await fs.readFile(path.join(ROOT, 'README.md'), 'utf-8');
    assert.match(readme, /^\| `\/w-bbs` \| .*(absorb|outside source|beg).* \|$/mi);
    assert.match(readme, /^\| `\/bbs` \| Alias for `\/w-bbs`.* \|$/m);
    assert.match(readme, /^\| `\/mt` \| Alias for `\/w-marathon`/m);
  });

  it('has a section explaining the command: the four verdicts table, the fetch guards, the run dir tree, the CLI verbs and OpenQodex as the worked example', () => {
    const start = readme.indexOf('### Beg, borrow, steal');
    assert.ok(start > 0, 'section heading present');
    const section = readme.slice(start, readme.indexOf('\n### ', start + 10));
    assert.match(section, /\| Verdict \| Meaning \|/);
    for (const v of ['`rebuild`', '`use`', '`buy`', '`skip`']) assert.ok(section.includes(v), v);
    assert.match(section, /GET only/i);
    assert.match(section, /private hosts/i);
    assert.match(section, /25 URLs/);
    assert.match(section, /20 MB/);
    assert.match(section, /\.claude\/bbs\/runs\/<run-id>\//);
    for (const f of ['source.json', 'egress.jsonl', 'powers.json', 'map.json', 'verdicts.json', 'labels.jsonl', 'handoff.json', 'briefs/', 'status.md']) assert.ok(section.includes(f), `${f} in the tree`);
    assert.match(section, /\.claude\/bbs\/registry\.jsonl/);
    assert.match(section, /node \.claude\/helpers\/bbs\/cli\.js/);
    for (const verb of ['`intake`', '`fetch`', '`inventory', '`map', '`verdict', '`handoff', '`status', '`report`']) assert.ok(section.includes(verb), `${verb} named`);
    assert.match(section, /JSON on stdout, except `status`, `report` and the `--brief`\/`--table` views, which print text\./);
    assert.ok(!/\. JSON on stdout; exit 1/.test(section), 'the old blanket JSON claim is gone');
    assert.match(section, /openqodex/i);
    assert.match(section, /never execute/i);
    assert.match(section, /sandbox/i);
    assert.match(section, /safety first/i);
    assert.ok(!section.includes('undefined'));
  });

  it('the project tree and the plugin table mention the bbs helpers, config, run dir and plugin', () => {
    assert.match(readme, /helpers\/bbs\//);
    assert.match(readme, /bbs\.json/);
    assert.match(readme, /^\| \*\*BBS\*\* \|/m);
    assert.match(readme, /^\| \*\*Marathon\*\* \|/m);
  });
});

describe('docs — package.json', () => {
  it('keywords include beg-borrow-steal; the version is not bumped by this stream', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf-8'));
    assert.ok(pkg.keywords.includes('beg-borrow-steal'));
    assert.equal(pkg.version, '4.3.0', 'version bumps need the owner\'s go');
  });
});
