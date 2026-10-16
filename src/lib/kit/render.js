/**
 * render — turn a findings list into SARIF 2.1.0, JUnit XML, or a sticky PR comment. Pure: it reads JSON
 * (stdin or --file) and prints the rendering; it never posts anything, the calling workflow or CI step does.
 *
 *   render sarif|junit|comment [--file <f>] [--key <k>] [--out <f>]   → { format, content, counts }
 *   --out <f> writes the raw content (SARIF JSON, JUnit XML or comment markdown) to f and returns { format, incomplete, counts, out } without content.
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
 * line, then Blocking / Filed / Needs decision / Advisory sections. `<` in finding text is escaped (and `<!--` broken in code spans), and findMarker matches only at the start of the body, so text can
 * never forge a marker.
 * Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'render';
export const usage = 'cli.js render sarif|junit|comment [--file <f>] [--key <k>] [--out <f>]  (findings JSON on stdin or --file)';

export const FORMATS = ['sarif', 'junit', 'comment'];
export const DEFAULT_KEY = 'review';
const SEVERITIES = ['blocking', 'advisory', 'note'];
const DISPOSITIONS = ['open', 'filed', 'needs-decision'];
const TOP_KEYS = ['findings', 'tests', 'incomplete', 'reason', 'tool'];
const FINDING_KEYS = ['message', 'severity', 'id', 'file', 'line', 'testCase', 'suite', 'disposition', 'url'];
const TEST_KEYS = ['name', 'suite'];
const SARIF_LEVEL = { blocking: 'error', advisory: 'warning', note: 'note' };
const ORPHAN_SUITE = 'unattributed';
const RUN_SUITE = 'run';
const FALLBACK_RULE = 'finding';

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
  const c = { total: n.findings.length, blocking: 0, blockingOpen: 0, blockingFiled: 0, blockingNeedsDecision: 0, advisory: 0, note: 0, filed: 0, needsDecision: 0 };
  for (const f of n.findings) {
    c[f.severity]++;
    if (f.severity === 'blocking') c[{ open: 'blockingOpen', filed: 'blockingFiled', 'needs-decision': 'blockingNeedsDecision' }[f.disposition]]++;
    if (f.disposition === 'filed') c.filed++;
    if (f.disposition === 'needs-decision') c.needsDecision++;
  }
  return c;
}

const incompleteText = n => `Run did not finish${n.reason ? `: ${n.reason}` : ''}`;

// ---- SARIF ----

/**
 * A file path as a SARIF artifact uri. Backslashes become '/', each segment is percent-encoded, and lone surrogates
 * become U+FFFD. Cases:
 *  - drive-letter path ('C:\\a', 'C:/a') -> 'file:///C:/a'
 *  - POSIX absolute path (one leading '/', or three or more, which POSIX reads as one) -> 'file:///...'
 *  - exactly two leading slashes or backslashes (UNC / '//host/share') -> the leading slashes are stripped and the
 *    rest is a relative reference, so a network-path reference is never emitted
 *  - anything else -> a relative reference; an empty result becomes '.'
 */
const wellFormed = s => String(s).replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd');
const encodePath = p => p.split('/').map(encodeURIComponent).join('/');
export const fileUri = file => {
  const p = wellFormed(file).replace(/\\/g, '/');
  const drive = /^([A-Za-z]):\//.exec(p);
  if (drive) return `file:///${drive[1]}:/${encodePath(p.slice(3))}`;
  if (p.startsWith('//') && !p.startsWith('///')) {
    const rest = p.slice(2);
    return rest ? encodePath(rest) : '.';
  }
  if (p.startsWith('/')) return `file:///${encodePath(p.replace(/^\/+/, ''))}`;
  return p === '' ? '.' : encodePath(p);
};

export function renderSarif(input) {
  const n = normalize(input);
  const ruleIds = [...new Set(n.findings.map(f => f.id || FALLBACK_RULE))];
  const results = n.findings.map(f => {
    const r = { level: SARIF_LEVEL[f.severity], message: { text: f.message }, properties: { severity: f.severity, disposition: f.disposition } };
    r.ruleId = f.id || FALLBACK_RULE;
    if (f.url) r.properties.url = f.url;
    if (f.testCase) r.properties.testCase = f.testCase;
    // GitHub code scanning refuses a result with no location, so a finding with no file points at the repo root
    // and names itself as a logical location.
    const physicalLocation = { artifactLocation: { uri: f.file ? fileUri(f.file) : '.' } };
    if (f.file && f.line) physicalLocation.region = { startLine: f.line };
    r.locations = [{ physicalLocation }];
    if (!f.file) r.locations[0].logicalLocations = [{ name: f.id || f.message.slice(0, 80) }];
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
  // User suites, orphan findings and the run error live in separate maps so a listed test can never absorb them.
  const userSuites = new Map(), orphanSuite = new Map(), runSuite = new Map();
  const slot = (suites, suite, name) => {
    if (!suites.has(suite)) suites.set(suite, new Map());
    const m = suites.get(suite);
    if (!m.has(name)) m.set(name, { findings: [], error: null });
    return m.get(name);
  };
  for (const t of n.tests) slot(userSuites, t.suite || 'findings', t.name);
  for (const f of n.findings) {
    if (f.testCase) slot(userSuites, f.suite || 'findings', f.testCase).findings.push(f);
    else slot(orphanSuite, ORPHAN_SUITE, f.id || f.message.slice(0, 80)).findings.push(f);
  }
  if (n.incomplete) slot(runSuite, RUN_SUITE, 'run-completed').error = incompleteText(n);
  // A clean run with no cases would read as "no test results"; give it one passing case.
  if (!userSuites.size && !orphanSuite.size && !runSuite.size) slot(runSuite, RUN_SUITE, 'review');
  const suites = [...userSuites, ...orphanSuite, ...runSuite];
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
  // The marker is always the first thing in the body, so only a match at the very start counts.
  return body.startsWith(m) ? { start: 0, end: m.length } : null;
}

const md = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\s*[\r\n]+\s*/g, ' ');
// Inside a code span entities are not decoded, so only neutralise backticks and newlines (a span cannot forge the marker).
const codeSpan = s => String(s).replace(/\s*[\r\n]+\s*/g, ' ').replace(/`/g, "'").replace(/<!--/g, '\uff1c!--');
const REASON_MAX = 500;
const shortReason = r => { const t = String(r); return t.length > REASON_MAX ? `${t.slice(0, REASON_MAX)}... (full text in the SARIF notification or JUnit error)` : t; };
export const COMMENT_CAP = 60000;
const bullet = (f, tagBlocking = false) => {
  const loc = f.file ? ` (\`${codeSpan(f.file)}${f.line ? `:${f.line}` : ''}\`)` : '';
  const link = f.url ? ` - ${md(f.url)}` : '';
  return `- ${tagBlocking && f.severity === 'blocking' ? '[blocking] ' : ''}${f.id ? `**${md(f.id)}** ` : ''}${md(f.message)}${loc}${link}`;
};

export function renderComment(input, { key = DEFAULT_KEY } = {}) {
  const n = normalize(input);
  const m = marker(key);
  const counts = countFindings(n);
  const blocking = n.findings.filter(f => f.severity === 'blocking' && f.disposition === 'open');
  const filed = n.findings.filter(f => f.disposition === 'filed');
  const decide = n.findings.filter(f => f.disposition === 'needs-decision');
  const advisory = n.findings.filter(f => f.severity !== 'blocking' && f.disposition === 'open');
  let verdict;
  if (n.incomplete) verdict = `**Review incomplete** - the run did not finish${n.reason ? ` (${md(shortReason(n.reason))})` : ''}${blocking.length ? `; ${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'} so far` : ''}`;
  else if (blocking.length) {
    const other = counts.blockingFiled + counts.blockingNeedsDecision;
    verdict = `**Blocked** - ${blocking.length} blocking finding${blocking.length === 1 ? '' : 's'}${other ? ` (${other} more blocking filed or awaiting a decision)` : ''}`;
  } else if (decide.length) verdict = `**Needs a decision** - ${decide.length} item${decide.length === 1 ? '' : 's'} waiting on you${counts.blockingNeedsDecision ? ` (${counts.blockingNeedsDecision} blocking)` : ''}`;
  else if (counts.blockingFiled) verdict = `**Clear** - no open blocking findings (${advisory.length} advisory, ${filed.length} filed, ${counts.blockingFiled} blocking filed)`;
  else verdict = `**Clear** - no blocking findings (${advisory.length} advisory, ${filed.length} filed)`;
  const out = [m, verdict, ''];
  let size = out.join('\n').length + 1;
  const NOTE_RESERVE = 200; // room for the "... and N more" line of this and of later sections
  for (const [title, list] of [['Blocking', blocking], ['Filed', filed], ['Needs decision', decide], ['Advisory', advisory]]) {
    if (!list.length) continue;
    const head = `### ${title} (${list.length})`;
    const lines = [head];
    size += head.length + 1;
    let shown = 0;
    for (const f of list) {
      const b = bullet(f, title === 'Filed' || title === 'Needs decision');
      if (size + b.length + 1 + NOTE_RESERVE > COMMENT_CAP) continue;
      lines.push(b); size += b.length + 1; shown++;
    }
    if (shown < list.length) {
      const lower = title.toLowerCase();
      const note = `... and ${list.length - shown} more ${lower} finding${list.length - shown === 1 ? '' : 's'} (see SARIF/JUnit)`;
      lines.push(note); size += note.length + 1;
    }
    lines.push(''); size += 1;
    out.push(...lines);
  }
  return out.join('\n');
}

// ---- CLI ----

const VALUE = ['file', 'key', 'out'];

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
  if (flags.out !== undefined) {
    const out = path.resolve(cwd, flags.out);
    const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n';
    const tmp = `${out}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tmp, data, { flag: 'wx' });
      await fs.rename(tmp, out);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw bad(`cannot write ${out}: ${e.code || e.message}`);
    }
    return { format, incomplete: n.incomplete, counts, out };
  }
  return { format, incomplete: n.incomplete, counts, content };
}
