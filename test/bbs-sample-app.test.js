/**
 * The integration proof — marathon 2026-10-10-bbs-integration.
 * A power built by /bbs is delivered only when a user can reach it. Installs the suite into a copy of a small app
 * (test/fixtures/bbs-app: a settings page, two API routers, a model step, a cron job, a flag file) and drives the
 * INSTALLED bbs CLI: the surfaces are found in the code, one power is approved to land on a UI page, an API endpoint
 * and the model step, and it counts as wired only once each place calls it and a reach test that goes in through that
 * place passes. Nothing is written outside the temp project; nothing touches the network.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { DaniZeeSuiteInstaller } from '../src/installer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const APP = path.join(ROOT, 'test', 'fixtures', 'bbs-app');
const SOURCE = path.join(ROOT, 'test', 'fixtures', 'bbs', 'sample-source');

const POWERS = [
  { name: 'secret-mask', what: 'Masks API keys and tokens in text before it is shown, stored or sent', evidence: 'src/a.js:2', dependencies: [], data_needed: 'none', network: 'none', size: 'small', licence: 'MIT', idea: 'Find strings shaped like keys or tokens and replace all but their last four characters.' },
  { name: 'drift-monitor', what: 'Detects config drift between runs', evidence: 'src/b.js:2', dependencies: [], data_needed: 'none', network: 'none', size: 'small', licence: 'MIT', idea: 'Hash the config at the start of each run and compare it with the last run.' },
  { name: 'usage-exporter', what: 'Uploads run counts to a vendor dashboard', evidence: 'src/c.js:2', dependencies: [], data_needed: 'uploads run counts to the vendor cloud', network: 'outbound', size: 'small', licence: 'MIT', idea: 'Send per-run counters to an external dashboard.' }
];

const TARGETS = {
  'secret-mask': [
    { surface: 'ui:app/settings/security/page.js', at: '/settings/security', reach: 'Settings › Security, the session list', how: 'session notes are masked before they are shown', mode: 'advisory' },
    { surface: 'api:app/api/scan/route.js', at: '/api/scan', reach: 'POST /api/scan', how: 'uploaded text is masked before it is stored', mode: 'blocking' },
    { surface: 'model:lib/summarize.js', at: 'summarizeTicket', reach: 'the ticket summary a support agent asks for', how: 'the ticket is masked before it is sent to the model', mode: 'blocking' }
  ],
  'drift-monitor': [],
  'usage-exporter': []
};

const MASK = `export function maskSecrets(text) {
  return String(text).replace(/\\b(sk|pk|ghp)[-_][A-Za-z0-9_-]{8,}/g, (m) => '*'.repeat(m.length - 4) + m.slice(-4));
}
`;
const KEY = 'sk-live-0123456789abcdef';

describe('bbs sample app — a power is delivered only when a user can reach it', () => {
  let dir, cli, marathonRun;
  const tmpFiles = [];

  function run(args, input) {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf-8', input, env: { ...process.env, BBS_SANDBOX: 'absent', BBS_NO_NETWORK: '1' } });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch {}
    return { code: r.status, out: r.stdout, err: r.stderr, json };
  }
  const write = async (rel, text) => { await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true }); await fs.writeFile(path.join(dir, rel), text); };
  const json = async (name, obj) => { const f = path.join(dir, '.tmp-' + name); await fs.writeFile(f, JSON.stringify(obj)); tmpFiles.push(f); return f; };

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bbs-app-'));
    await fs.cp(APP, dir, { recursive: true });
    spawnSync('git', ['init', '-q', '.'], { cwd: dir });
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'app'], { cwd: dir });
    const result = await new DaniZeeSuiteInstaller({ path: dir, force: true, withoutCookbook: true }).install();
    assert.ok(result.success, 'suite installed into the app');
    cli = path.join(dir, '.claude', 'helpers', 'bbs', 'cli.js');
  });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('1 the source is audited up to the usage step: no transcripts on this machine', async () => {
    assert.equal(run(['intake', SOURCE, '--slug', 'app']).code, 0);
    assert.equal(run(['fetch']).code, 0);
    const inv = run(['inventory', '--from', await json('inv.json', { powers: POWERS })]);
    assert.equal(inv.code, 0, inv.err);
    assert.equal(run(['map']).code, 0);
    assert.equal(run(['map', '--from', await json('j.json', { 'secret-mask': 'missing', 'drift-monitor': 'missing', 'usage-exporter': 'missing' })]).code, 0);
    const u = run(['usage', '--root', path.join(dir, 'no-transcripts')]);
    assert.equal(u.code, 0, u.err);
    assert.equal(u.json.evidence, 'none');
    assert.equal(run(['status', '--next']).out.trim(), 'surfaces');
  });

  it('2 surfaces: the page, both routers, the job, the model step and the flags are found in the code', () => {
    const s = run(['surfaces']);
    assert.equal(s.code, 0, s.err);
    assert.equal(s.json.kinds.ui, 1);
    assert.equal(s.json.kinds.api, 2);
    assert.equal(s.json.kinds.job, 1);
    assert.equal(s.json.kinds.model, 1);
    assert.equal(s.json.kinds.feature, 1);
    assert.equal(s.json.note, undefined);
    assert.equal(run(['status', '--next']).out.trim(), 'targets');
    const b = run(['targets', '--brief']);
    assert.equal(b.code, 0, b.err);
    assert.match(b.out, /- ui:app\/settings\/security\/page\.js \(1 commit lately\) — at: "\/settings\/security"/);
    assert.match(b.out, /- api:server\/routes\.js \(1 commit lately\) — at: "\/api\/upload", "\/api\/health"/);
    assert.match(b.out, /- model:lib\/summarize\.js \(1 commit lately\) — at: "summarizeTicket"/);
    assert.ok(!b.out.includes('test-only'), 'the app\'s tests are not surfaces');
  });

  it('3 targets: a place that is not a surface or an anchor is refused; the three landings are recorded', async () => {
    const bad = run(['targets', '--from', await json('bad.json', { 'secret-mask': [{ ...TARGETS['secret-mask'][1], at: '/api/nope' }] })]);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /"\/api\/nope" is not an anchor of api:app\/api\/scan\/route\.js/);
    const t = run(['targets', '--from', await json('t.json', TARGETS)]);
    assert.equal(t.code, 0, t.err);
    assert.deepEqual(t.json.no_target, ['drift-monitor', 'usage-exporter']);
    assert.equal(t.json.next, 'verdict');
  });

  it('4 verdict: with no transcripts the code landings still stand; a power that lands nowhere defaults away from rebuild', async () => {
    assert.equal(run(['verdict']).code, 0);
    const table = run(['verdict', '--table']);
    assert.equal(table.code, 0, table.err);
    assert.match(table.out, /ui:app\/settings\/security\/page\.js · \/settings\/security · advisory; api:app\/api\/scan\/route\.js · \/api\/scan · blocking; model:lib\/summarize\.js · summarizeTicket · blocking/);
    assert.match(table.out, /\| drift-monitor \|[^\n]*\| skip \| nowhere \|[^\n]*default rebuild → skip: its targets are empty: it lands nowhere/);
    const d = run(['verdict', '--from', await json('d.json', { 'secret-mask': 'rebuild', 'drift-monitor': 'skip', 'usage-exporter': 'buy' })]);
    assert.equal(d.code, 0, d.err);
    assert.equal(d.json.next, 'handoff');
  });

  it('5 hand-off: the integration stream is queued with a plan per surface kind; the finish line counts three reached targets', async () => {
    const h = run(['handoff', '--marathon']);
    assert.equal(h.code, 0, h.err);
    marathonRun = h.json.marathonRun;
    assert.ok(marathonRun);
    assert.equal(h.json.integration.stream, 'integration');
    const plan = await fs.readFile(path.join(dir, h.json.integration.plan), 'utf-8');
    assert.match(plan, /secret-mask → ui `ui:app\/settings\/security\/page\.js` · \/settings\/security · advisory — reached by: Settings › Security, the session list/);
    assert.match(plan, /- ui: render or call the power from the page/);
    assert.match(plan, /- api: call the power inside the handler/);
    assert.match(plan, /- model: put the power in the model or prompt step/);
    assert.ok(!plan.includes('- workflow:'), 'only the kinds this run lands on are explained');
    const fl = JSON.parse(await fs.readFile(path.join(dir, '.claude', 'marathon', marathonRun, 'finish-line.json'), 'utf-8'));
    const wired = fl.lines.find(l => l.id === 'wired_secret-mask');
    assert.deepEqual([wired.op, wired.value, wired.source, wired.stream], ['at_least', 3, 'measure:wired_secret-mask', 'integration']);
    assert.ok(fl.lines.some(l => l.id === 'delivered' && l.source === 'measure:delivered'));
  });

  it('6 built but not integrated: nothing counts, and the note says what is missing', async () => {
    await write('lib/mask.js', MASK);
    // a test of the power alone proves it works, not that a user reaches it
    await write('test/reach/mask-only.test.js', `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { maskSecrets } from '../../lib/mask.js';\ntest('masks', () => assert.ok(!maskSecrets('${KEY}').includes('0123')));\n`);
    const i = run(['integrate', '--power', 'secret-mask', '--entry', 'lib/mask.js#maskSecrets', '--reach', 'ui:app/settings/security/page.js=test/reach/mask-only.test.js::node --test test/reach/mask-only.test.js']);
    assert.equal(i.code, 0, i.err);
    const w = run(['wired', '--power', 'secret-mask']);
    assert.equal(w.code, 0, w.err);
    assert.equal(w.json.wired, 0);
    assert.deepEqual(w.json.targets.map(t => t.why), [
      'app/settings/security/page.js never imports mask',
      'app/api/scan/route.js never imports mask',
      'lib/summarize.js never imports mask'
    ]);
    const d = run(['delivered']);
    assert.equal(d.code, 0, d.err);
    assert.equal(d.json.all_wired, false);
  });

  it('7 linked but reached only by a test that never goes through the page: still not wired', async () => {
    await write('app/settings/security/page.js', `import { maskSecrets } from '../../../lib/mask.js';\n\n// Settings › Security: lists the user's active sessions.\nexport default function SecuritySettingsPage({ sessions = [] } = {}) {\n  const rows = sessions.map(s => \`<li>\${s.device}: \${maskSecrets(s.note)}</li>\`).join('');\n  return \`<section><h1>Security</h1><ul>\${rows}</ul></section>\`;\n}\n`);
    const w = run(['wired', '--power', 'secret-mask']);
    assert.equal(w.json.targets[0].why, 'reach test test/reach/mask-only.test.js never goes through app/settings/security/page.js or "/settings/security"');
  });

  it('8 wired everywhere with reach tests through each place: three of three, recorded, and delivered.md gives the owner the keys', async () => {
    await write('app/api/scan/route.js', `import { maskSecrets } from '../../../lib/mask.js';\n\n// POST /api/scan: accepts uploaded text and returns what was stored.\nexport async function POST(req) {\n  const body = await req.json();\n  return Response.json({ stored: maskSecrets(body.text ?? '') });\n}\n`);
    await write('lib/summarize.js', `import { maskSecrets } from './mask.js';\n\n// The model step: summarizes a support ticket with the LLM client the app passes in.\nexport async function summarizeTicket(text, client) {\n  const msg = await client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 400, messages: [{ role: 'user', content: maskSecrets(text) }] });\n  return msg.content;\n}\n`);
    const t = (name, body) => write(`test/reach/${name}.test.js`, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${body}`);
    await t('security-page', `import Page from '../../app/settings/security/page.js';\ntest('Settings › Security masks a key in a session note', () => {\n  const html = Page({ sessions: [{ device: 'laptop', note: 'used ${KEY}' }] });\n  assert.ok(html.includes('cdef') && !html.includes('0123'));\n});\n`);
    await t('scan-api', `import { POST } from '../../app/api/scan/route.js';\ntest('POST /api/scan stores masked text', async () => {\n  const res = await POST(new Request('http://app.test/api/scan', { method: 'POST', body: JSON.stringify({ text: 'key ${KEY}' }) }));\n  const body = await res.json();\n  assert.ok(!body.stored.includes('0123') && body.stored.endsWith('cdef'));\n});\n`);
    await t('summarize', `import { summarizeTicket } from '../../lib/summarize.js';\ntest('the model never receives the key', async () => {\n  let sent;\n  const client = { messages: { create: async (req) => { sent = req.messages[0].content; return { content: 'ok' }; } } };\n  await summarizeTicket('ticket with ${KEY}', client);\n  assert.ok(!sent.includes('0123'));\n});\n`);
    const reach = [
      'ui:app/settings/security/page.js@/settings/security=test/reach/security-page.test.js::node --test test/reach/security-page.test.js',
      'api:app/api/scan/route.js=test/reach/scan-api.test.js::node --test test/reach/scan-api.test.js',
      'model:lib/summarize.js=test/reach/summarize.test.js::node --test test/reach/summarize.test.js'
    ];
    const i = run(['integrate', '--power', 'secret-mask', ...reach.flatMap(r => ['--reach', r])]);
    assert.equal(i.code, 0, i.err);
    assert.equal(i.json.reach.length, 4, 'the earlier ui row is kept beside the new one');
    const w = run(['wired', '--power', 'secret-mask', '--record']);
    assert.equal(w.code, 0, w.err);
    assert.equal(w.json.wired, 3);
    assert.deepEqual(w.json.targets.map(x => x.test), ['test/reach/security-page.test.js', 'test/reach/scan-api.test.js', 'test/reach/summarize.test.js']);
    const d = run(['delivered', '--record']);
    assert.equal(d.code, 0, d.err);
    assert.equal(d.json.all_wired, true);
    const md = await fs.readFile(path.join(dir, d.json.file), 'utf-8');
    assert.match(md, /## secret-mask\n/);
    assert.match(md, /- ✓ Settings › Security, the session list \(`ui:app\/settings\/security\/page\.js` · \/settings\/security\) · advisory — proved by `test\/reach\/security-page\.test\.js`/);
    assert.match(md, /- ✓ POST \/api\/scan \(`api:app\/api\/scan\/route\.js` · \/api\/scan\) · blocking/);
    assert.match(md, /Use it in code: `import \{ maskSecrets \} from '\.\/lib\/mask\.js'`/);
    const measures = (await fs.readFile(path.join(dir, '.claude', 'marathon', marathonRun, 'store', 'measurements.jsonl'), 'utf-8')).trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(measures.filter(m => m.key === 'wired_secret-mask' || m.key === 'delivered').map(m => [m.key, m.value]), [['wired_secret-mask', 3], ['delivered', true]]);
  });

  it('9 a wiring that is removed, or a reach test that fails, stops counting', async () => {
    const route = await fs.readFile(path.join(dir, 'app/api/scan/route.js'), 'utf-8');
    await write('app/api/scan/route.js', route.replace("maskSecrets(body.text ?? '')", "body.text ?? ''"));
    let w = run(['wired', '--power', 'secret-mask']);
    assert.equal(w.json.wired, 2);
    assert.equal(w.json.targets[1].why, 'app/api/scan/route.js never calls maskSecrets');
    await write('app/api/scan/route.js', route);
    await write('lib/mask.js', 'export function maskSecrets(text) { return String(text); }\n');
    w = run(['wired', '--power', 'secret-mask']);
    assert.equal(w.json.wired, 0);
    assert.match(w.json.targets[2].why, /^reach test failed \(exit 1\): node --test test\/reach\/summarize\.test\.js/);
  });
});
