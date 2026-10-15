/**
 * render — turn a findings list into SARIF 2.1.0, JUnit XML, or a sticky PR comment. Pure: it reads JSON
 * (stdin or --file) and prints the rendering; it never posts anything, the calling workflow or CI step does.
 *
 *   render sarif|junit|comment [--file <f>] [--key <k>]      → { format, content, counts }
 *
 * Input: { findings: [...], tests?: [{ name, suite? }], incomplete?: bool, reason?: string, tool?: string }
 *   finding: { message (required), severity: blocking|advisory|note (default advisory), id?, file?, line?,
 *              testCase?, suite?, disposition?: open|filed|needs-decision (default open), url? }
 * Unknown keys (top level, finding, test) are refused (exit 1); a leading BOM is stripped.
 *
 * SARIF: blocking is level "error", advisory "warning", note "note"; an incomplete run is an unsuccessful
 * invocation with an error notification. JUnit: a blocking finding is a <failure> on its test case; advisory and
 * note findings are reported in system-out but do not fail; findings with no test case sit in the separate
 * "unattributed" suite; an incomplete run adds an explicit <error>. All XML text is escaped and characters that
 * XML 1.0 forbids become U+FFFD. Comment: a hidden marker line `<!-- kit-render:<key> -->` (key from --key,
 * default "review"; export findMarker(body, key) so a caller can find and edit the same comment), one verdict
 * line, then Blocking / Filed / Needs decision / Advisory sections. `<` in finding text is escaped so text can
 * never forge a marker.
 * Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'render';
export const usage = 'cli.js render sarif|junit|comment [--file <f>] [--key <k>]  (findings JSON on stdin or --file)';

export const FORMATS = ['sarif', 'junit', 'comment'];
export const DEFAULT_KEY = 'review';
const SEVERITIES = ['blocking', 'advisory', 'note'];
const DISPOSITIONS = ['open', 'filed', 'needs-decision'];
const TOP_KEYS = ['findings', 'tests', 'incomplete', 'reason', 'tool'];
const FINDING_KEYS = ['message', 'severity', 'id', 'file', 'line', 'testCase', 'suite', 'disposition', 'url'];
const TEST_KEYS = ['name', 'suite'];
const SARIF_LEVEL = { blocking: 'error', advisory: 'warning', note: 'note' };
const ORPHAN_SUITE = 'unattributed';

const bad = m => new KitExit(m, 1);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const optStr = (o, k, where) => {
  if (o[k] !== undefined && (typeof o[k] !== 'string' || !o[k])) throw bad(`${where}.${k} must be a non-empty string`);
};
function noUnknown(o, allowed, where) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw bad(`unknown key "${k}" in ${where} (allowed: ${allowed.join(', ')})`);
}

/** Validate and default the input; returns a fresh normalised object. */
export function normalize(input) {
  if (!isObj(input)) throw bad('input must be a JSON object with a findings array');
  noUnknown(input, TOP_KEYS, 'input');
  if (!Array.isArray(input.findings)) throw bad('input.findings must be an array');
  if (input.incomplete !== undefined && typeof input.incomplete !== 'boolean') throw bad('input.incomplete must be a boolean');
  optStr(input, 'reason', 'input'); optStr(input, 'tool', 'input');
  if (input.tests !== undefined && !Array.isArray(input.tests)) throw bad('input.tests must be an array');
  const findings = input.findings.map((f, i) => {
    const where = `findings[${i}]`;
    if (!isObj(f)) throw bad(`${where} must be an object`);
    noUnknown(f, FINDING_KEYS, where);
    if (typeof f.message !== 'string' || !f.message) throw bad(`${where}.message must be a non-empty string`);
    for (const k of ['id', 'file', 'testCase', 'suite', 'url']) optStr(f, k, where);
    const severity = f.severity === undefined ? 'advisory' : f.severity;
    if (!SEVERITIES.includes(severity)) throw bad(`${where}.severity must be one of ${SEVERITIES.join(', ')}`);
    const disposition = f.disposition === undefined ? 'open' : f.disposition;
    if (!DISPOSITIONS.includes(disposition)) throw bad(`${where}.disposition must be one of ${DISPOSITIONS.join(', ')}`);
    if (f.line !== undefined && !(Number.isInteger(f.line) && f.line >= 1)) throw bad(`${where}.line must be a positive integer`);
    return { ...f, severity, disposition };
  });
  const tests = (input.tests || []).map((t, i) => {
    if (!isObj(t)) throw bad(`tests[${i}] must be an object`);
    noUnknown(t, TEST_KEYS, `tests[${i}]`);
    if (typeof t.name !== 'string' || !t.name) throw bad(`tests[${i}].name must be a non-empty string`);
    optStr(t, 'suite', `tests[${i}]`);
    return { ...t };
  });
  return { findings, tests, incomplete: input.incomplete === true, reason: input.reason, tool: input.tool || 'kit-render' };
}

export function countFindings(n) {
  const c = { total: n.findings.length, blocking: 0, advisory: 0, note: 0, filed: 0, needsDecision: 0 };
  for (const f of n.findings) {
    c[f.severity]++;
    if (f.disposition === 'filed') c.filed++;
    if (f.disposition === 'needs-decision') c.needsDecision++;
  }
  return c;
}

const incompleteText = n => `Run did not finish${n.reason ? `: ${n.reason}` : ''}`;

// ---- SARIF ----

export function renderSarif(input) {
  const n = normalize(input);
  const ruleIds = [...new Set(n.findings.map(f => f.id).filter(Boolean))];
  const results = n.findings.map(f => {
    const r = { level: SARIF_LEVEL[f.severity], message: { text: f.message }, properties: { severity: f.severity, disposition: f.disposition } };
    if (f.id) r.ruleId = f.id;
    if (f.url) r.properties.url = f.url;
    if (f.testCase) r.properties.testCase = f.testCase;
    if (f.file) {
      const physicalLocation = { artifactLocation: { uri: f.file } };
      if (f.line) physicalLocation.region = { startLine: f.line };
      r.locations = [{ physicalLocation }];
    }
    return r;
  });
  const invocation = { executionSuccessful: !n.incomplete };
  if (n.incomplete) invocation.toolExecutionNotifications = [{ level: 'error', message: { text: incompleteText(n) } }];
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{ tool: { driver: { name: n.tool, rules: ruleIds.map(id => ({ id })) } }, invocations: [invocation], results }],
  };
}

// ---- XML ----

/** Escape for XML text or attribute values; characters XML 1.0 forbids (and lone surrogates) become U+FFFD. */
export function xmlEscape(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    const ok = c === 0x9 || c === 0xA || c === 0xD || (c >= 0x20 && c <= 0xD7FF) || (c >= 0xE000 && c <= 0xFFFD) || (c >= 0x10000 && c <= 0x10FFFF);
    if (!ok) out += '�';
    else if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&apos;';
    else if (c === 0x9) out += '&#9;';
    else if (c === 0xA) out += '&#10;';
    else if (c === 0xD) out += '&#13;';
    else out += ch;
  }
  return out;
}

const where = f => (f.file ? `${f.file}${f.line ? `:${f.line}` : ''}: ` : '');
const text = f => `${f.id ? `[${f.id}] ` : ''}${where(f)}${f.message}`;

export function renderJunit(input) {
  const n = normalize(input);
  // suite name -> Map(test name -> { findings })
  const suites = new Map();
  const slot = (suite, name) => {
    if (!suites.has(suite)) suites.set(suite, new Map());
    const m = suites.get(suite);
    if (!m.has(name)) m.set(name, { findings: [], error: null });
    return m.get(name);
  };
  for (const t of n.tests) slot(t.suite || 'findings', t.name);
  for (const f of n.findings) {
    if (f.testCase) slot(f.suite || 'findings', f.testCase).findings.push(f);
    else slot(ORPHAN_SUITE, f.id || f.message.slice(0, 80)).findings.push(f);
  }
  if (n.incomplete) slot('run', 'run-completed').error = incompleteText(n);

  let tTests = 0, tFail = 0, tErr = 0;
  const body = [];
  for (const [suite, cases] of suites) {
    let tests = 0, failures = 0, errors = 0;
    const lines = [];
    for (const [name, c] of cases) {
      tests++;
      const fails = c.findings.filter(f => f.severity === 'blocking');
      const info = c.findings.filter(f => f.severity !== 'blocking');
      if (fails.length) failures++;
      if (c.error) errors++;
      lines.push(`    <testcase name="${xmlEscape(name)}" classname="${xmlEscape(suite)}">`);
      for (const f of fails) lines.push(`      <failure message="${xmlEscape(f.message)}" type="${xmlEscape(f.id || 'finding')}">${xmlEscape(text(f))}</failure>`);
      if (c.error) lines.push(`      <error message="${xmlEscape(c.error)}" type="incomplete-run">${xmlEscape(c.error)}</error>`);
      if (info.length) lines.push(`      <system-out>${xmlEscape(info.map(f => `${f.severity}: ${text(f)}`).join('\n'))}</system-out>`);
      lines.push('    </testcase>');
    }
    tTests += tests; tFail += failures; tErr += errors;
    body.push(`  <testsuite name="${xmlEscape(suite)}" tests="${tests}" failures="${failures}" errors="${errors}" skipped="0">`, ...lines, '  </testsuite>');
  }
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${xmlEscape(n.tool)}" tests="${tTests}" failures="${tFail}" errors="${tErr}">`, ...body, '</testsuites>', ''].join('\n');
}

// ---- comment ----

const KEY_RE = /^[A-Za-z0-9._-]{1,64}$/;
function checkKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw bad('key must be 1-64 characters of letters, digits, dot, underscore or hyphen');
  return key;
}

/** The hidden marker line for a key. */
export function marker(key = DEFAULT_KEY) { return `<!-- kit-render:${checkKey(key)} -->`; }

/** Locate this key's marker in an existing comment body: { start, end } or null. Exactly this key, never a prefix. */
export function findMarker(body, key = DEFAULT_KEY) {
  const m = marker(key);
  if (typeof body !== 'string') return null;
  const start = body.indexOf(m);
  return start === -1 ? null : { start, end: start + m.length };
}

const md = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\s*[\r\n]+\s*/g, ' ');
const bullet = f => {
  const loc = f.file ? ` (\`${md(f.file).replace(/`/g, "'")}${f.line ? `:${f.line}` : ''}\`)` : '';
  const link = f.url ? ` - ${md(f.url)}` : '';
  return `- ${f.id ? `**${md(f.id)}** ` : ''}${md(f.message)}${loc}${link}`;
};

export function renderComment(input, { key = DEFAULT_KEY } = {}) {
  const n = normalize(input);
  const m = marker(key);
  const blocking = n.findings.filter(f => f.severity === 'blocking' && f.disposition === 'open');
  const filed = n.findings.filter(f => f.disposition === 'filed');
  const decide = n.findings.filter(f => f.disposition === 'needs-decision');
  const advisory = n.findings.filter(f => f.severity !== 'blocking' && f.disposition === 'open');
  let verdict;
  if (n.incomplete) verdict = `**Review incomplete** - the run did not finish${n.reason ? ` (${md(n.reason)})` : ''}`;
  else if (blocking.length) verdict = `**Blocked** - ${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'}`;
  else if (decide.length) verdict = `**Needs a decision** - ${decide.length} item${decide.length === 1 ? '' : 's'} waiting on you`;
  else verdict = `**Clear** - no blocking findings (${advisory.length} advisory, ${filed.length} filed)`;
  const out = [m, verdict, ''];
  for (const [title, list] of [['Blocking', blocking], ['Filed', filed], ['Needs decision', decide], ['Advisory', advisory]]) {
    if (!list.length) continue;
    out.push(`### ${title} (${list.length})`, ...list.map(bullet), '');
  }
  return out.join('\n');
}

// ---- CLI ----

const VALUE = ['file', 'key'];

function parse(args) {
  const [format, ...rest] = args;
  if (!FORMATS.includes(format)) throw bad(`first argument must be one of ${FORMATS.join(', ')}\n${usage}`);
  const flags = {};
  while (rest.length) {
    const a = rest.shift();
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"\n${usage}`);
    const k = a.slice(2);
    if (!VALUE.includes(k)) throw bad(`unknown flag --${k} (allowed: ${VALUE.map(f => `--${f}`).join(', ')})`);
    if (!rest.length || rest[0].startsWith('--')) throw bad(`--${k} needs a value`);
    flags[k] = rest.shift();
  }
  if (flags.key !== undefined && format !== 'comment') throw bad('--key only applies to comment');
  return { format, flags };
}

export async function run(args, io) {
  const { format, flags } = parse(args);
  const cwd = io.cwd || process.cwd();
  let raw;
  if (flags.file) {
    const file = path.resolve(cwd, flags.file);
    try { raw = await fs.readFile(file, 'utf-8'); } catch (e) { throw bad(`cannot read ${file}: ${e.code || e.message}`); }
  } else raw = await io.stdin();
  raw = String(raw).replace(/^﻿/, '');
  if (!raw.trim()) throw bad('no input: pass findings JSON on stdin or --file');
  let data;
  try { data = JSON.parse(raw); } catch { throw bad('input is not valid JSON'); }
  const n = normalize(data);
  const counts = countFindings(n);
  let content;
  if (format === 'sarif') content = renderSarif(data);
  else if (format === 'junit') content = renderJunit(data);
  else content = renderComment(data, { key: flags.key === undefined ? DEFAULT_KEY : flags.key });
  return { format, incomplete: n.incomplete, counts, content };
}
