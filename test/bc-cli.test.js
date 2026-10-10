/**
 * Integration tests for /bc compaction support: the bc helper CLI, the PreCompact and
 * SessionStart(compact) hook scripts, and the user-level install. They run against throwaway git
 * projects and a throwaway HOME, and cover the five checks in the /bc spec:
 *   1. a project with a config file and no copy of the command gets the prune step;
 *   2. under 50%, 50–80% and over 80% give three different outcomes;
 *   3. the keep-list never names a finished stream or holds file contents;
 *   4. after a forced compaction the first turn is told the active stream and phase;
 *   5. every compaction, manual or automatic, has a row in the results file.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as bc from '../src/plugins/bc.js';
import { checkShadowing } from '../src/lib/marathon/shadow.js';
import { readSettings } from '../src/utils/settings.js';
import { DaniZeeSuiteInstaller } from '../src/installer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const CLI = path.join(ROOT, 'src', 'lib', 'bc', 'cli.js');
const MARATHON_CLI = path.join(ROOT, 'src', 'lib', 'marathon', 'cli.js');
const TEMPLATES = path.join(ROOT, 'src', 'templates', 'bc');

const TMP = path.join(os.tmpdir(), `bc-cli-${process.pid}-${Date.now()}`);
after(async () => { await fs.rm(TMP, { recursive: true, force: true }); });

// Never inherit the real session's project dir or home: every run names its own.
function env(extra = {}) {
  const e = { ...process.env, ...extra };
  if (!('CLAUDE_PROJECT_DIR' in extra)) delete e.CLAUDE_PROJECT_DIR;
  return e;
}

function run(cwd, args, { input, cli = CLI, home } = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf-8', input, env: env(home ? { HOME: home } : {}) });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, json };
}

function hook(script, project, { input = '', home } = {}) {
  const r = spawnSync('bash', [script], { cwd: project, encoding: 'utf-8', input, env: env({ CLAUDE_PROJECT_DIR: project, HOME: home || path.join(TMP, 'nohome') }) });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const STATUS = `# Work streams

| Stream | Where | Plan | State | Next | Phase | Skill | Tasks |
|---|---|---|---|---|---|---|---|
| XP bar | feat/xp | plans/xp.md | active | owner plays | 3 | pt | bj5160aec |
| Intro | feat/intro | plans/intro.md | done | — | — | — | — |
| Replit launch | — | — | blocked | waiting on Dani | — | — | — |
`;
const KICKOFF_SECRET = 'KICKOFF-BODY-SHOULD-NEVER-APPEAR';

let n = 0;
async function makeProject({ bcJson = true, status = STATUS } = {}) {
  const dir = path.join(TMP, `p${++n}`);
  await fs.mkdir(path.join(dir, '.claude', 'plans'), { recursive: true });
  await fs.mkdir(path.join(dir, 'docs', 'build'), { recursive: true });
  spawnSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  await fs.writeFile(path.join(dir, 'docs', 'build', 'KICKOFF.md'), `Goal: ship.\n${KICKOFF_SECRET}\n`);
  await fs.writeFile(path.join(dir, 'docs', 'build', 'RULES.md'), 'Never weaken an assertion.\n');
  if (status !== null) await fs.writeFile(path.join(dir, 'docs', 'build', 'STATUS.md'), status);
  if (bcJson) {
    await fs.writeFile(path.join(dir, '.claude', 'bc.json'), JSON.stringify({
      status: 'docs/build/STATUS.md', kickoff: 'docs/build/KICKOFF.md', rules: 'docs/build/RULES.md',
      memory: 'docs/solutions', db: '.claude/bc/compactions.jsonl', context_window: 1000
    }));
  }
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

async function transcript(dir, tokens) {
  const file = path.join(dir, `t-${tokens}.jsonl`);
  const lines = [
    { type: 'user', message: { content: 'hi' } },
    { type: 'assistant', message: { usage: { input_tokens: 5, cache_read_input_tokens: 5, output_tokens: 3 } } },
    { type: 'assistant', message: { usage: { input_tokens: tokens - 100, cache_read_input_tokens: 60, cache_creation_input_tokens: 40, output_tokens: 9 } } },
    'not json'
  ];
  await fs.writeFile(file, lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return file;
}

async function rows(dir, rel = '.claude/bc/compactions.jsonl') {
  try {
    return (await fs.readFile(path.join(dir, rel), 'utf-8')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

describe('bc cli — config', () => {
  it('reports the resolved files, thresholds and that no marathon run is active', async () => {
    const dir = await makeProject();
    const r = run(dir, ['config']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.json.configured, true);
    assert.equal(r.json.marathonRun, null);
    assert.equal(r.json.config.status, 'docs/build/STATUS.md');
    assert.equal(r.json.files.kickoff.exists, true);
    assert.equal(r.json.config.prune_below_pct, 50);
  });

  it('fails clearly on a broken bc.json', async () => {
    const dir = await makeProject({ bcJson: false });
    await fs.writeFile(path.join(dir, '.claude', 'bc.json'), JSON.stringify({ status: '../outside.md' }));
    const r = run(dir, ['config']);
    assert.equal(r.code, 1);
    assert.match(r.err, /status must be a path inside the project/);
  });
});

describe('bc cli — check 2: three outcomes by context size', () => {
  let dir;
  before(async () => { dir = await makeProject(); });

  for (const [tokens, decision] of [[300, 'none'], [499, 'none'], [500, 'compact'], [650, 'compact'], [799, 'compact'], [800, 'clear'], [968, 'clear']]) {
    it(`${tokens / 10}% → ${decision}`, async () => {
      const r = run(dir, ['context', '--transcript', await transcript(dir, tokens)]);
      assert.equal(r.code, 0, r.err);
      assert.equal(r.json.tokens, tokens, 'size is the last assistant record: input + cache read + cache creation');
      assert.equal(r.json.pct, tokens / 10);
      assert.equal(r.json.decision, decision);
    });
  }

  it('a finished stream means clear at any size', async () => {
    const r = run(dir, ['context', '--transcript', await transcript(dir, 300), '--stream-finished']);
    assert.equal(r.json.decision, 'clear');
  });

  it('fails when the transcript is missing or has no usage', async () => {
    assert.equal(run(dir, ['context', '--transcript', path.join(dir, 'nope.jsonl')]).code, 1);
    await fs.writeFile(path.join(dir, 'empty.jsonl'), '{"type":"user"}\n');
    assert.match(run(dir, ['context', '--transcript', path.join(dir, 'empty.jsonl')]).err, /no assistant usage/);
  });
});

describe('bc cli — check 3: keep-list', () => {
  it('names the kickoff, open streams, rules, last commit and tasks; never a finished stream or file contents', async () => {
    const dir = await makeProject();
    const r = run(dir, ['keeplist']);
    assert.equal(r.code, 0, r.err);
    const line = r.out.trim();
    assert.ok(line.startsWith('/compact '));
    assert.ok(!line.includes('\n'));
    for (const s of ['docs/build/KICKOFF.md', 'docs/build/STATUS.md', 'docs/build/RULES.md', 'XP bar', 'Replit launch', 'bj5160aec', 'last commit ']) {
      assert.ok(line.includes(s), `missing ${s}: ${line}`);
    }
    assert.ok(!line.includes('Intro'), 'finished stream named');
    assert.ok(!line.includes(KICKOFF_SECRET), 'file contents copied into the keep-list');
    assert.ok(!line.includes('Never weaken'), 'rules file contents copied into the keep-list');
  });

  it('leaves out a configured kickoff that does not exist, and copes with no status file', async () => {
    const dir = await makeProject({ status: null });
    await fs.unlink(path.join(dir, 'docs', 'build', 'KICKOFF.md'));
    const line = run(dir, ['keeplist']).out.trim();
    assert.ok(line.startsWith('/compact '));
    assert.ok(!line.includes('KICKOFF'));
    assert.match(line, /No status file at docs\/build\/STATUS\.md/);
  });
});

describe('bc cli — resume and record', () => {
  it('resume --plain is one line naming the files, the active stream, skill and phase', async () => {
    const dir = await makeProject();
    const r = run(dir, ['resume', '--plain']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.trim().split('\n').length, 1);
    assert.match(r.out, /docs\/build\/KICKOFF\.md, docs\/build\/STATUS\.md, docs\/build\/RULES\.md/);
    assert.match(r.out, /stream "XP bar"/);
    assert.match(r.out, /\/pt at phase 3/);
  });

  it('record compaction appends a validated row with the active stream', async () => {
    const dir = await makeProject();
    const r = run(dir, ['record', 'compaction', 'trigger=bc', 'tokens=650', 'pct=65', 'decision=compact']);
    assert.equal(r.code, 0, r.err);
    const [row] = await rows(dir);
    assert.equal(row.trigger, 'bc');
    assert.equal(row.tokens, 650);
    assert.equal(row.decision, 'compact');
    assert.equal(row.stream, 'XP bar');
    assert.ok(row.ts);
    assert.equal(run(dir, ['record', 'compaction', 'decision=maybe']).code, 1);
    assert.equal(run(dir, ['record', 'compaction', 'tokens=-1']).code, 1);
    assert.equal(run(dir, ['record', 'other']).code, 1);
  });
});

describe('bc hooks — checks 4 and 5', () => {
  const pre = path.join(TEMPLATES, 'bc-precompact.sh');
  const start = path.join(TEMPLATES, 'bc-session-start.sh');

  async function installed() {
    const dir = await makeProject();
    await bc.install(path.join(dir, '.claude'), { targetDir: dir });
    // The project install puts the marathon library beside the helper; mirror that here.
    await fs.cp(path.join(ROOT, 'src', 'lib', 'marathon'), path.join(dir, '.claude', 'helpers', 'marathon'), { recursive: true });
    return dir;
  }

  it('check 5: an automatic and a manual compaction each get a row; the status file is stamped', async () => {
    const dir = await installed();
    const t = await transcript(dir, 968);
    const auto = hook(path.join(dir, '.claude', 'hooks', 'bc-precompact.sh'), dir, { input: JSON.stringify({ trigger: 'auto', transcript_path: t }) });
    assert.equal(auto.code, 0, auto.err);
    assert.equal(auto.out, '', 'PreCompact prints nothing');
    const manual = hook(path.join(dir, '.claude', 'hooks', 'bc-precompact.sh'), dir, { input: JSON.stringify({ trigger: 'manual' }) });
    assert.equal(manual.code, 0);

    const r = await rows(dir);
    assert.deepEqual(r.map(x => x.trigger), ['auto', 'manual']);
    assert.equal(r[0].tokens, 968);
    assert.equal(r[0].pct, 96.8);
    assert.equal(r[0].stream, 'XP bar');
    assert.equal(r[0].branch, 'main');

    const status = await fs.readFile(path.join(dir, 'docs', 'build', 'STATUS.md'), 'utf-8');
    assert.ok(status.startsWith(STATUS), 'the table is left as it was');
    assert.match(status, /Last handoff .* · trigger manual · branch main · commit [0-9a-f]+ · \d+ uncommitted files? · running tasks: bj5160aec/);
    assert.equal(status.match(/<!-- bc:handoff -->/g).length, 1, 'one stamp, replaced each time');
  });

  it('check 4: after a compaction the SessionStart hook names the active stream and phase', async () => {
    const dir = await installed();
    const r = hook(path.join(dir, '.claude', 'hooks', 'bc-session-start.sh'), dir);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^Read docs\/build\/KICKOFF\.md, docs\/build\/STATUS\.md, docs\/build\/RULES\.md/);
    assert.match(r.out, /continue stream "XP bar" \(next: owner plays\)/);
    assert.match(r.out, /mid-run in \/pt at phase 3: reload that skill/);
    assert.match(r.out, /\n\| XP bar \| active \| 3 \| owner plays \|/);
  });

  it('both hooks are silent and write nothing in a project without a /bc handoff', async () => {
    const dir = await makeProject({ bcJson: false });
    await bc.install(path.join(dir, '.claude'), { targetDir: dir });
    await fs.rm(path.join(dir, '.claude', 'bc.json'));
    await fs.cp(path.join(ROOT, 'src', 'lib', 'marathon'), path.join(dir, '.claude', 'helpers', 'marathon'), { recursive: true });
    assert.equal(hook(path.join(dir, '.claude', 'hooks', 'bc-precompact.sh'), dir, { input: '{"trigger":"auto"}' }).code, 0);
    assert.equal(hook(path.join(dir, '.claude', 'hooks', 'bc-session-start.sh'), dir).out, '');
    assert.deepEqual(await rows(dir), []);
    await assert.rejects(fs.access(path.join(dir, '.claude', 'plans', 'STATUS.md')));
  });

  it('the hooks exit 0 even when no helper is installed anywhere', async () => {
    const dir = await makeProject();
    assert.equal(hook(pre, dir, { input: '{}' }).code, 0);
    assert.equal(hook(start, dir).code, 0);
  });
});

describe('bc — check 1: one user-level copy, a project only adds bc.json', () => {
  let home;
  before(async () => {
    home = path.join(TMP, 'home');
    await fs.mkdir(home, { recursive: true });
    await bc.installUser(home);
  });

  it('installs the commands, helper, marathon library, hooks and settings entries', async () => {
    const c = path.join(home, '.claude');
    for (const f of ['commands/bc.md', 'commands/bcp.md', 'commands/w-background-compound.md', 'helpers/bc/cli.js',
      'helpers/marathon/context.js', 'hooks/bc-precompact.sh', 'hooks/bc-session-start.sh']) {
      await fs.access(path.join(c, f));
    }
    const settings = await readSettings(c);
    assert.match(settings.hooks.PreCompact[0].hooks[0].command, /\$HOME\/\.claude\/hooks\/bc-precompact\.sh/);
    assert.equal(settings.hooks.SessionStart[0].matcher, 'compact');
    assert.ok(settings.permissions.allow.includes('Bash(node ~/.claude/helpers/bc/cli.js:*)'));
  });

  it('the user-level command carries the prune step and calls the user helper', async () => {
    const cmd = await fs.readFile(path.join(home, '.claude', 'commands', 'w-background-compound.md'), 'utf-8');
    assert.match(cmd, /~\/\.claude\/helpers\/bc\/cli\.js/);
    assert.match(cmd, /bc context/);
    assert.match(cmd, /bc keeplist/);
    assert.match(cmd, /\/compact/);
    assert.match(cmd, /\/clear/);
    assert.match(cmd, /\.claude\/bc\.json/);
    const alias = await fs.readFile(path.join(home, '.claude', 'commands', 'bc.md'), 'utf-8');
    assert.match(alias, /`w-background-compound` skill/);
    assert.ok(!alias.includes('.shortcuts:'), 'no project namespace at user level');
  });

  it('a project with only bc.json gets the prune step from the user-level helper', async () => {
    const dir = await makeProject();
    await fs.access(path.join(dir, '.claude', 'bc.json'));
    await assert.rejects(fs.access(path.join(dir, '.claude', 'commands')), 'no copy of the command in the project');
    const userCli = path.join(home, '.claude', 'helpers', 'bc', 'cli.js');
    const ctx = run(dir, ['context', '--transcript', await transcript(dir, 650)], { cli: userCli, home });
    assert.equal(ctx.code, 0, ctx.err);
    assert.equal(ctx.json.decision, 'compact');
    const kl = run(dir, ['keeplist'], { cli: userCli, home });
    assert.match(kl.out, /^\/compact Keep only: docs\/build\/KICKOFF\.md is the finish line/);
  });

  it('the user-level hooks serve a project that installed nothing', async () => {
    const dir = await makeProject();
    const pre = hook(path.join(home, '.claude', 'hooks', 'bc-precompact.sh'), dir, { input: '{"trigger":"auto"}', home });
    assert.equal(pre.code, 0);
    assert.deepEqual((await rows(dir)).map(r => r.trigger), ['auto']);
    const start = hook(path.join(home, '.claude', 'hooks', 'bc-session-start.sh'), dir, { home });
    assert.match(start.out, /continue stream "XP bar"/);
  });

  it('the user-level hooks step aside when the project has its own, so nothing runs twice', async () => {
    const dir = await makeProject();
    await bc.install(path.join(dir, '.claude'), { targetDir: dir });
    const start = hook(path.join(home, '.claude', 'hooks', 'bc-session-start.sh'), dir, { home });
    assert.equal(start.out, '');
    hook(path.join(home, '.claude', 'hooks', 'bc-precompact.sh'), dir, { input: '{"trigger":"auto"}', home });
    assert.deepEqual(await rows(dir), []);
  });

  it('the suite\'s own user-level copy is not reported as shadowing; a user\'s own command is', async () => {
    const commandsDir = path.join(home, '.claude', 'commands');
    assert.deepEqual(await checkShadowing(commandsDir, ['bc', 'bcp', 'w-background-compound']), []);
    const other = path.join(TMP, 'home2');
    await fs.mkdir(path.join(other, '.claude', 'commands'), { recursive: true });
    await fs.writeFile(path.join(other, '.claude', 'commands', 'bc.md'), '# my old bc, no prune step\n');
    assert.deepEqual(await checkShadowing(path.join(other, '.claude', 'commands'), ['bc']), ['bc']);
  });

  it('refuses to overwrite a user\'s own /bc unless forced, and keeps a backup', async () => {
    const other = path.join(TMP, 'home3');
    await fs.mkdir(path.join(other, '.claude', 'commands'), { recursive: true });
    await fs.writeFile(path.join(other, '.claude', 'commands', 'bc.md'), '# mine\n');
    await assert.rejects(bc.installUser(other), /your own command/);
    const r = await bc.installUser(other, { force: true });
    assert.deepEqual(r.replaced, ['bc']);
    assert.equal(await fs.readFile(path.join(other, '.claude', 'commands', 'bc.md.bak'), 'utf-8'), '# mine\n');
    // Reinstalling over the suite's own copy needs no force.
    await bc.installUser(other);
  });

  it('a second install keeps one hook entry each; uninstall-user removes only the suite\'s pieces', async () => {
    await bc.installUser(home);
    let settings = await readSettings(path.join(home, '.claude'));
    assert.equal(settings.hooks.PreCompact.length, 1);
    assert.equal(settings.hooks.SessionStart.length, 1);
    await fs.writeFile(path.join(home, '.claude', 'commands', 'mine.md'), '# keep me\n');
    await bc.uninstallUser(home);
    await assert.rejects(fs.access(path.join(home, '.claude', 'commands', 'bc.md')));
    await assert.rejects(fs.access(path.join(home, '.claude', 'helpers', 'bc')));
    await fs.access(path.join(home, '.claude', 'commands', 'mine.md'));
    settings = await readSettings(path.join(home, '.claude'));
    assert.ok(!settings.hooks);
    assert.ok(!settings.permissions.allow.includes('Bash(node ~/.claude/helpers/bc/cli.js:*)'));
  });
});

describe('bc — with an active marathon run', () => {
  async function marathonProject() {
    const dir = await makeProject();
    const init = spawnSync(process.execPath, [MARATHON_CLI, 'init', 'one', '--run', 'run-one'], { cwd: dir, encoding: 'utf-8', env: env() });
    assert.equal(init.status, 0, init.stderr);
    return dir;
  }

  it('hands the verbs to the marathon run', async () => {
    const dir = await marathonProject();
    const cfg = run(dir, ['config']);
    assert.equal(cfg.json.marathonRun, 'run-one');
    const kl = run(dir, ['keeplist']);
    assert.equal(kl.code, 0, kl.err);
    assert.match(kl.out, /Keep: run run-one/, 'the run owns the keep-list');
    const rec = run(dir, ['record', 'compaction', 'trigger=bc', 'tokens=650', 'pct=65', 'decision=compact']);
    assert.equal(rec.code, 0, rec.err);
    assert.deepEqual(await rows(dir), [], 'not written to the /bc results file while the run owns it');
  });

  it('the hooks stay silent when the project has marathon\'s own hooks', async () => {
    const dir = await marathonProject();
    await bc.install(path.join(dir, '.claude'), { targetDir: dir });
    await fs.cp(path.join(ROOT, 'src', 'lib', 'marathon'), path.join(dir, '.claude', 'helpers', 'marathon'), { recursive: true });
    await fs.writeFile(path.join(dir, '.claude', 'hooks', 'marathon-precompact.sh'), '#!/usr/bin/env bash\n');
    const before = await fs.readFile(path.join(dir, 'docs', 'build', 'STATUS.md'), 'utf-8');
    hook(path.join(dir, '.claude', 'hooks', 'bc-precompact.sh'), dir, { input: '{"trigger":"auto"}' });
    assert.equal(hook(path.join(dir, '.claude', 'hooks', 'bc-session-start.sh'), dir).out, '');
    assert.equal(await fs.readFile(path.join(dir, 'docs', 'build', 'STATUS.md'), 'utf-8'), before);
    assert.deepEqual(await rows(dir), []);
  });
});

describe('bc plugin — project install through the installer', () => {
  it('init installs the helper, hooks, bc.json once, and registers both hook pairs', async () => {
    const dir = path.join(TMP, 'init');
    await fs.mkdir(dir, { recursive: true });
    const home = path.join(TMP, 'init-home');
    const installer = new DaniZeeSuiteInstaller({ path: dir, homeDir: home });
    await installer.install();
    const c = path.join(dir, '.claude');
    for (const f of ['helpers/bc/cli.js', 'helpers/bc/config.js', 'helpers/bc/statusfile.js', 'hooks/bc-precompact.sh', 'hooks/bc-session-start.sh', 'bc.json']) {
      await fs.access(path.join(c, f));
    }
    const settings = await readSettings(c);
    const pre = settings.hooks.PreCompact.flatMap(e => e.hooks.map(h => h.command)).join('\n');
    assert.match(pre, /bc-precompact\.sh/);
    assert.match(pre, /marathon-precompact\.sh/);
    assert.ok(settings.hooks.SessionStart.every(e => e.matcher === 'compact'));
    assert.ok(settings.permissions.allow.includes('Bash(node .claude/helpers/bc/cli.js:*)'));

    await fs.writeFile(path.join(c, 'bc.json'), '{"status":"mine.md"}');
    await new DaniZeeSuiteInstaller({ path: dir, homeDir: home, force: true }).install(); // what `update` runs
    assert.equal(await fs.readFile(path.join(c, 'bc.json'), 'utf-8'), '{"status":"mine.md"}', 'bc.json is the project\'s, never overwritten');
    assert.equal((await installer.check()).plugins.bc, true);

    const helper = run(dir, ['config'], { cli: path.join(c, 'helpers', 'bc', 'cli.js') });
    assert.equal(helper.code, 0, helper.err);
    assert.equal(helper.json.config.status, 'mine.md');

    await installer.uninstall();
    await assert.rejects(fs.access(path.join(c, 'helpers', 'bc')));
  });
});
