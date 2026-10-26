/**
 * exit-codes — one explicit, machine-readable contract for kit exit statuses, so CI and workflows can tell a
 * broken TOOL (infrastructure) from a broken PRODUCT (a regression or refusal).
 *
 *   exit-codes table                                         the contract (classes, codes, descriptions, overrides)
 *   exit-codes describe <code> [--verb <v>] [--result <file|->]   class + description of a status
 *   exit-codes blocks <code> [--verb <v>] [--result <file|->]     { blocks }: true only for the regression class
 *   exit-codes classify --code <n> [--signal <name>] [--verb <v>] [--result <file|->]
 *
 * --result <file|-> is the JSON a product judge printed (a regular file or piped stdin, each of at most 64 MiB). A judge's exit 2 ALWAYS
 * blocks (class regression), whatever the result says: judges fail closed. scrub never fetches (GIT_NO_LAZY_FETCH=1), so a file whose
 * object is missing locally is skipped deterministically in a sparse or blobless clone; that is not a network fault and never infrastructure.
 * --result only does two things: (1) it rejects a result whose numeric `exit` field differs from the code (KitExit 1: a stale $? must not turn
 * a hit into clean; checked at any code), and (2) it describes the 2 better: the hit count, the first few unscanned file paths with their reasons, and a
 * remedy that fits each reason (e.g. 'fetch the missing blobs or run in a full clone'). Empty, truncated, oversized or non-object output at
 * exit 2 also blocks. The result is read only for a judge verb with no signal; at a code other than 2, empty or unparseable content is ignored.
 * The library takes the parsed object or the judge's stdout string (parsed like --result): classify({ code, verb, result }), blocksMerge(code, verb, signal, result). It fails closed like the CLI: a verb outside the registered kit verbs, a bad code or a bad result throws KitExit 1 (blocksMerge rethrows; an input error never means 'does not block'). 124 (timeout(1)) is infrastructure.
 *
 * Classes: clean (0), regression (2 from a listed product judge only: the ONLY class allowed to block a merge), usage (1, invalid input
 * or broken state), precondition (4, a prerequisite was never met), infrastructure (5; the tool or environment failed:
 * timeout, crash, signal, any status >= 128; 126/127 = tool not executable / not found are preconditions). cli.js uses 2 for a
 * policy refusal of ANY kind, and many verbs refuse for tool limits (size caps, guarded-fs symlink and race refusals, argument
 * refusals) that say nothing about the product, so exit 2 is a NON-BLOCKING refusal (precondition) by default and blocks only
 * for verbs on the explicit PRODUCT_JUDGES list, whose 2 is a product verdict by their usage text (push-gate: deny; scrub: hits,
 * an incomplete scan (fail closed), or a refusal such as a tracked private pattern file, which prints nothing on stdout). A new verb is not a judge until it is added there. Some verbs document their own
 * statuses (diff-range 1 = bad input or a git failure, not separable yet; safe-git 3 = git ran and failed or timed
 * out, infrastructure; diff-range 3 = an empty range, clean). A bare 3 without a verb is ambiguous, so it is unknown.
 * Unknown statuses are reported as `unknown`, never as clean, and never block (only a known regression blocks).
 * A signal always wins and is infrastructure. All of blocks/describe/classify print JSON and exit 0; bad input is exit 1.
 * Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KitExit } from './kit-exit.js';

export const verb = 'exit-codes';
export const usage = 'cli.js exit-codes table | describe <code> [--verb <v>] [--result <file|->] | blocks <code> [--verb <v>] [--result <file|->] | classify --code <n> [--signal <name>] [--verb <v>] [--result <file|->]  (JSON out, exit 0; exit 1 on bad input; a judge 2 always blocks: --result only describes it and rejects an exit field that contradicts the code)';

const freeze = (o) => Object.freeze(o);

/** The outcome classes. Only `regression` may block a merge. */
export const CLASSES = freeze({
  clean: freeze({ code: 0, blocks: false, description: 'The verb succeeded; nothing to report.' }),
  usage: freeze({ code: 1, blocks: false, description: 'Invalid input, broken state, or a tool failure (not separable yet): the call was malformed or the data unusable, or the tool crashed or a git child failed, since cli.js reports any crash as 1. Check the message before blaming the caller; never block on it.' }),
  regression: freeze({ code: 2, blocks: true, description: 'Regression: a verb that judges the product (see product_judges) ran and said no. The only outcome allowed to block a merge. Exit 2 from any other verb, or with no verb, is a refusal (precondition) and does not block. A judge also exits 2 when it could not judge (scrub on an incomplete scan, push-gate whose scrub check could not run); that still blocks (fail closed). Pass --result <file|-> (the verb\'s JSON output) for the hit count, the first unscanned paths with reasons and a remedy.' }),
  precondition: freeze({ code: 4, blocks: false, description: 'A prerequisite was never met (missing tool, file, credential or setup); nothing was judged.' }),
  infrastructure: freeze({ code: 5, blocks: false, description: 'The tool or environment failed (timeout, crash, signal, git failure); says nothing about the product. Retry or repair, never block on it alone.' }),
});

/** Statuses at or above this, and any signal death, are infrastructure. */
export const INFRA_FLOOR = 128;

/** Verbs whose exit 2 is a product verdict (checked against each verb's usage text); every other 2 is a non-blocking refusal. */
export const PRODUCT_JUDGES = freeze(['push-gate', 'scrub', 'bg-fill']);

const REFUSAL = freeze({ class: 'precondition', description: 'The verb refused the call (exit 2): an argument, a size or count limit, an unsafe path or repository state. Nothing was judged about the product, so it never blocks; change the call or the environment. Only the product judges (see product_judges) use 2 as a verdict.' });
const SHELL = freeze({
  124: freeze({ class: 'infrastructure', description: 'Status 124: timeout(1) stopped the command because it ran too long. The tool or environment was too slow, not a product verdict; retry or raise the limit.' }),
  126: freeze({ class: 'precondition', description: 'Status 126: the shell found the tool but it is not executable. A missing prerequisite, not a product failure.' }),
  127: freeze({ class: 'precondition', description: 'Status 127: command not found (the shell could not find the tool or node). A missing prerequisite, not a product failure.' }),
});

/** Per-verb statuses, from each verb's own usage text. */
export const VERB_OVERRIDES = freeze({
  'safe-git': freeze({
    2: freeze({ class: 'precondition', description: 'safe-git refused an argument or option (safe-git exit 2); nothing was judged about the product. Change the call.' }),
    3: freeze({ class: 'infrastructure', description: 'git ran and failed, timed out, or wrote more output than allowed (safe-git exit 3); git\'s own code is in the printed JSON.' }),
  }),
  'diff-range': freeze({
    1: freeze({ class: 'usage', description: 'Bad input, git failed or timed out while diff-range ran, or untracked files skipped by a cap (--max-file-bytes/--max-untracked) left the diff empty (diff-range exit 1); not separable from a malformed call yet, so read the message. Never a product verdict.' }),
    2: freeze({ class: 'precondition', description: 'diff-range refused: the review range is over the size limit, or the repository config has an include.path (diff-range exit 2); nothing was reviewed. Shrink the range or fix the config.' }),
    3: freeze({ class: 'clean', description: 'The range is empty: nothing at all, or only skipped nested repositories (diff-range exit 3); there is nothing to review.' }),
  }),
});

/** The frozen table: default code → class, plus the overrides. */
export const TABLE = freeze({
  classes: CLASSES,
  codes: freeze(Object.fromEntries(Object.entries(CLASSES).map(([name, c]) => [c.code, name]))),
  infrastructure_floor: INFRA_FLOOR,
  product_judges: PRODUCT_JUDGES,
  shell_statuses: SHELL,
  overrides: VERB_OVERRIDES,
});

/** Far above any judge's real output (scrub's not_scanned list has no cap: about 160 bytes per missing file in a partial clone). Only a result beyond this is 'oversize', and it blocks at a judge's 2. The CLI reads incrementally, so memory is bounded by the cap. */
const MAX_RESULT_BYTES = 64 * 1048576;
/** The exact not_scanned reason scrub.js writes for a blob that is not in the object store. scrub never fetches, so this is deterministic in a sparse or blobless clone. */
const MISSING_OBJECT = 'object not available locally (partial clone?)';

/** push-gate.js keeps only the first 20 not_scanned entries (`r.not_scanned.slice(0, 20)` in its scrub-refusal result), and scrub lists the partial-clone entries first, so a list of this length may be truncated; the description says so. Keep in step with push-gate.js. */
export const PUSH_GATE_NOT_SCANNED_CAP = 20;

/** The scan part of a judge result: scrub's own object, or push-gate's `scrub` on a deny. Null when there is none. */
function scanOf(v, result) {
  const scan = v === 'scrub' ? result : v === 'push-gate' && result && result.decision === 'deny' ? result.scrub : null;
  return scan && typeof scan === 'object' && !Array.isArray(scan) ? scan : null;
}
const PATH_LISTED = 5;
const PATH_CAP = 80;
/** The path of a not_scanned entry (an object's file or path, or a bare string), or null. */
const pathOf = (e) => (typeof e === 'string' ? e : e && typeof e === 'object' ? (typeof e.file === 'string' ? e.file : typeof e.path === 'string' ? e.path : null) : null);
/** The first few unscanned paths, each JSON-escaped and capped in length, then '+N more' (N counts every entry not named). */
function pathsOf(ns) {
  const shown = ns.slice(0, PATH_LISTED).map(pathOf).filter((x) => x !== null).map((x) => JSON.stringify(x.length > PATH_CAP ? `${x.slice(0, PATH_CAP)}...` : x));
  const more = ns.length - shown.length;
  return shown.length ? `: ${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}` : '';
}
const reasonOf = (e) => (e && typeof e === 'object' && typeof e.reason === 'string' ? e.reason : 'unknown reason');

/** The remedy that fits the not_scanned reasons (missing object, size, total, or a file that is missing, not regular or unreadable). */
function remedy(v, rs) {
  const parts = [];
  if (rs.some((r) => r === MISSING_OBJECT)) parts.push('Fetch the missing blobs (the command depends on how the clone was made: sparse, --no-checkout or blobless; a plain git fetch does not fill them in) or run in a full clone; scrub never fetches by itself, so a rerun in the same clone gives the same result.');
  if (rs.some((r) => /^larger than /.test(r))) parts.push(v === 'scrub' ? 'Shrink or split the oversized files, or rerun scrub with a higher --max-file-bytes.' : 'Shrink or split the oversized files, or run scrub with a higher --max-file-bytes.');
  if (rs.some((r) => r === 'total size limit reached')) parts.push('Scan a smaller range (scrub --history <base>), since the total size limit cannot be raised.');
  if (rs.some((r) => r === 'tracked but missing on disk' || r === 'not a regular file on disk' || r.startsWith('cannot read'))) parts.push('Restore or fix the missing, non-regular or unreadable files, then rerun.');
  return parts.length ? parts.join(' ') : 'Look at the listed files and reasons, fix the cause, then rerun.';
}

/** A better description of a judge's exit 2 from its result (hit count, unscanned files and reasons, remedy), or null to keep the generic one. It never changes the class: a judge's 2 blocks. */
function describeJudge(v, result) {
  const scan = scanOf(v, result);
  if (!scan) return null;
  const hits = typeof scan.hit_count === 'number' ? scan.hit_count : 0;
  const ns = Array.isArray(scan.not_scanned) ? scan.not_scanned : [];
  const rs = ns.map(reasonOf);
  const reasons = [...new Set(rs)];
  const list = reasons.slice(0, 5).join('; ') + (reasons.length > 5 ? '; ...' : '');
  const hidden = v === 'push-gate' && ns.length >= PUSH_GATE_NOT_SCANNED_CAP ? `; push-gate lists at most ${PUSH_GATE_NOT_SCANNED_CAP} files, so more may be hidden, including oversized ones` : '';
  if (hits > 0) return `${CLASSES.regression.description.split(' A judge also')[0]} ${v} found ${hits} hit(s)${ns.length ? ` and did not scan ${ns.length} file(s)${pathsOf(ns)} (${list}${hidden})` : ''}.`;
  if (ns.length) return `Fail closed: ${v} found no hits but ${ns.length} file(s) were not scanned${pathsOf(ns)} (${list}${hidden}), so nothing shows they are clean and it blocks. ${remedy(v, rs)}`;
  return null;
}

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
let knownVerbs = null;
/** The registered kit verbs, the same set cli.js loadVerbs() finds (sibling .js files other than cli.js and kit-exit.js that export a verb), read synchronously from each file's `export const verb = '<name>'`. */
function registeredVerbs() {
  if (knownVerbs) return knownVerbs;
  const names = [];
  for (const f of fsSync.readdirSync(KIT_DIR).filter((x) => x.endsWith('.js') && x !== 'cli.js' && x !== 'kit-exit.js').sort()) {
    const m = /^export const verb = '([^']*)';/m.exec(fsSync.readFileSync(path.join(KIT_DIR, f), 'utf-8'));
    if (m) names.push(m[1]);
  }
  return (knownVerbs = names);
}
function checkVerb(v) {
  if (v == null) return null;
  if (typeof v !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(v)) throw new KitExit(`verb must be a verb name like "safe-git", got ${JSON.stringify(v)}`, 1);
  const known = registeredVerbs();
  if (!known.includes(v)) throw new KitExit(`verb "${v}" is not a registered kit verb (known: ${known.join(', ')})`, 1);
  return v;
}

const AMBIGUOUS = { 3: 'Status 3 means different things per verb (safe-git: git failed, infrastructure; diff-range: empty range, clean); pass the verb to classify it.' };

/**
 * Classify a status. `signal` (a non-empty string) wins over the code. Returns
 * { code, signal, verb, class, known, blocks, description }; class is `unknown` for an unlisted status, which never blocks.
 */
export function classify(opts = {}) { return classifyWith(opts, null); }

/** Judge a result for a judge's exit 2: { obj } (null when none was given) or { why } when its content is unusable. Never throws on content. */
function judgeResult(result) {
  if (result == null) return { obj: null };
  let sized = false;
  // One rule for text and objects: a result over the cap is oversize (an object is measured by its compact JSON form).
  if (typeof result === 'string') {
    if (Buffer.byteLength(result) > MAX_RESULT_BYTES) return { why: `its result is larger than ${MAX_RESULT_BYTES} bytes` };
    if (!result.trim()) return { why: 'it printed nothing on stdout (it crashed or refused; read its stderr)' };
    sized = true;
    try { result = JSON.parse(result); } catch { return { why: 'its result is truncated or not valid JSON (it crashed or was cut off; read its stderr)' }; }
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { why: 'its result is not a JSON object' };
  if (!sized) {
    let n;
    try { n = Buffer.byteLength(JSON.stringify(result)); } catch { return { why: 'its result cannot be serialized as JSON' }; }
    if (n > MAX_RESULT_BYTES) return { why: `its result is larger than ${MAX_RESULT_BYTES} bytes` };
  }
  return { obj: result };
}

/** `unusable` (CLI only): why the result could not be used (too large to read), already decided by the reader. */
function classifyWith({ code = null, signal = null, verb: v = null, result = null } = {}, unusable = null) {
  v = checkVerb(v);
  if (signal != null && signal !== '') {
    return { code, signal: String(signal), verb: v, class: 'infrastructure', known: true, blocks: false, description: `Killed by signal ${signal}: the tool or environment failed, not the product.` };
  }
  if (!Number.isInteger(code) || code < 0 || code > 255) throw new KitExit(`exit status must be an integer 0..255, got ${JSON.stringify(code)}`, 1);
  const base = { code, signal: null, verb: v };
  // The result is read only for a judge verb with no signal. At exit 2 it decides the class; at any other code it is only checked
  // against its own exit field (a mismatch is KitExit 1), and empty or unparseable content is ignored.
  if (code !== 2 && v && PRODUCT_JUDGES.includes(v) && !unusable && result != null) {
    const o = judgeResult(result).obj;
    if (o && typeof o.exit === 'number' && o.exit !== code) throw new KitExit(`the result says the judge exited ${o.exit} but the status given is ${code}; pass the judge's real exit status (not a stale $?)`, 1);
  }
  if (code === 2 && v && PRODUCT_JUDGES.includes(v)) {
    const j = unusable ? { why: unusable } : judgeResult(result);
    if (j.why) return { ...base, class: 'regression', known: true, blocks: true, description: `Fail closed: ${v} exited 2 but ${j.why}, so nothing shows it did not judge the product; it blocks. Read the judge's stderr and rerun it.` };
    const result2 = j.obj;
    if (result2 && typeof result2.exit === 'number' && result2.exit !== code) throw new KitExit(`the result says the judge exited ${result2.exit} but the status given is ${code}; pass the judge's real exit status (not a stale $?)`, 1);
    // A judge's 2 always blocks. The result only describes it better.
    const better = describeJudge(v, result2);
    return { ...base, class: 'regression', known: true, blocks: true, description: better || CLASSES.regression.description };
  }
  const over = v && Object.hasOwn(VERB_OVERRIDES, v) ? VERB_OVERRIDES[v][code] : undefined;
  if (over) return { ...base, class: over.class, known: true, blocks: CLASSES[over.class].blocks, description: over.description };
  if (code === 2 && !(v && PRODUCT_JUDGES.includes(v))) return { ...base, class: REFUSAL.class, known: true, blocks: false, description: REFUSAL.description };
  if (SHELL[code]) return { ...base, class: SHELL[code].class, known: true, blocks: false, description: SHELL[code].description };
  if (code >= INFRA_FLOOR) return { ...base, class: 'infrastructure', known: true, blocks: false, description: `Status ${code} (>= ${INFRA_FLOOR}) is a signal death or a crash: the tool or environment failed, not the product.` };
  const name = TABLE.codes[code];
  if (name) return { ...base, class: name, known: true, blocks: CLASSES[name].blocks, description: CLASSES[name].description };
  return { ...base, class: 'unknown', known: false, blocks: false, description: AMBIGUOUS[code] || `Status ${code} is not in the contract; it is not clean and not a verified regression. Treat it as an unclassified failure.` };
}

/** True only when the status is a regression for that verb. Unknown, infrastructure and signals are false. Bad input (verb, code, result) throws KitExit 1: it must never read as 'does not block'. */
export function blocksMerge(code, v = null, signal = null, result = null) {
  return classify({ code, verb: v, signal, result }).blocks === true;
}

function parse(args, positional, flags) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    if (a.startsWith('--')) {
      let inline = null;
      const eq = a.indexOf('=');
      if (eq > 0) { inline = a.slice(eq + 1); a = a.slice(0, eq); }
      if (!flags.includes(a)) throw new KitExit(`unknown option ${a}; ${usage}`, 1);
      if (Object.hasOwn(out, a)) throw new KitExit(`${a} given twice`, 1);
      if (inline !== null) {
        if (!inline) throw new KitExit(`${a} needs a value`, 1);
        out[a] = inline;
      } else {
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new KitExit(`${a} needs a value`, 1);
        out[a] = args[++i];
      }
    } else out._.push(a);
  }
  if (out._.length > positional) throw new KitExit(`unexpected argument "${out._[positional]}"; ${usage}`, 1);
  return out;
}

function toCode(s, what) {
  if (typeof s !== 'string' || !/^\d{1,3}$/.test(s)) throw new KitExit(`${what} must be an integer 0..255, got ${JSON.stringify(s)}`, 1);
  const n = Number(s);
  if (n > 255) throw new KitExit(`${what} must be an integer 0..255, got ${s}`, 1);
  return n;
}
/** Read the --result text. Returns { text } or { unusable } (too large; never read whole). Call-level errors (no piped stdin, unreadable file) still throw KitExit 1. */
async function readResult(arg, io) {
  let text;
  if (arg === '-') {
    if (!io || typeof io.stdin !== 'function' || io.stdinIsTTY) throw new KitExit('--result - needs piped stdin, not a terminal', 1);
    // Bounded read: the reader gets maxBytes (cap + 1) and stops once the running byte count passes it, so a huge pipe is never buffered whole.
    const buf = await (typeof io.stdinBytes === 'function' ? io.stdinBytes : io.stdin)({ maxBytes: MAX_RESULT_BYTES + 1 });
    if (Buffer.byteLength(buf) > MAX_RESULT_BYTES) return { unusable: `its result is larger than ${MAX_RESULT_BYTES} bytes` };
    text = buf.toString('utf-8');
  } else {
    const file = path.resolve((io && io.cwd) || process.cwd(), arg);
    const st = await fs.stat(file).catch((e) => { throw new KitExit(`cannot read --result ${arg}: ${e.code || e.message}`, 1); });
    if (!st.isFile()) throw new KitExit(`--result ${arg} is not a regular file`, 1);
    if (st.size > MAX_RESULT_BYTES) return { unusable: `its result is larger than ${MAX_RESULT_BYTES} bytes` };
    // Bounded read: at most cap + 1 bytes, so a file that grows while it is read is never buffered whole.
    const fh = await fs.open(file, 'r').catch((e) => { throw new KitExit(`cannot read --result ${arg}: ${e.code || e.message}`, 1); });
    let buf;
    try {
      buf = Buffer.alloc(Math.min(st.size, MAX_RESULT_BYTES) + 1);
      let n = 0;
      for (;;) {
        const { bytesRead } = await fh.read(buf, n, buf.length - n, null);
        if (!bytesRead) break;
        n += bytesRead;
        if (n >= buf.length) break;
      }
      buf = buf.subarray(0, n);
    } finally { await fh.close(); }
    if (buf.length > MAX_RESULT_BYTES) return { unusable: `its result is larger than ${MAX_RESULT_BYTES} bytes` };
    text = buf.toString('utf-8');
  }
  return { text };
}
/** Read --result only when it can matter: a judge verb with no signal (at exit 2 it decides the class; at other codes only its exit field is checked). */
async function resultFor(arg, code, v, signal, io) {
  if (arg == null || signal != null || !v || !PRODUCT_JUDGES.includes(v)) return {};
  return readResult(arg, io);
}
async function toVerb(s) {
  if (s == null) return null;
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(s)) throw new KitExit(`--verb must be a verb name like "safe-git", got ${JSON.stringify(s)}`, 1);
  const { loadVerbs } = await import('./cli.js');
  const known = [...(await loadVerbs()).keys()];
  if (!known.includes(s)) throw new KitExit(`--verb "${s}" is not a registered kit verb (known: ${known.join(', ')})`, 1);
  return s;
}
function toSignal(s) {
  if (s == null) return null;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(s)) throw new KitExit(`--signal must be a signal name like SIGKILL, got ${JSON.stringify(s)}`, 1);
  return s;
}

export async function run(args, io = {}) {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') return { usage };
  if ((rest.includes('--help') || rest.includes('-h')) && ['table', 'describe', 'blocks', 'classify'].includes(sub)) return { usage };
  if (sub === 'table') { parse(rest, 0, []); return TABLE; }
  if (sub === 'describe' || sub === 'blocks') {
    const p = parse(rest, 1, ['--verb', '--result']);
    if (!p._.length) throw new KitExit(`${sub} needs a <code>; ${usage}`, 1);
    const code = toCode(p._[0], '<code>');
    const v = await toVerb(p['--verb']);
    const rr = await resultFor(p['--result'], code, v, null, io);
    const r = classifyWith({ code, verb: v, result: rr.text }, rr.unusable);
    return sub === 'blocks' ? { code: r.code, verb: r.verb, class: r.class, blocks: r.blocks } : r;
  }
  if (sub === 'classify') {
    const p = parse(rest, 0, ['--code', '--signal', '--verb', '--result']);
    const signal = toSignal(p['--signal']);
    if (p['--code'] == null && signal == null) throw new KitExit(`classify needs --code <n> or --signal <name>; ${usage}`, 1);
    const code = p['--code'] == null ? null : toCode(p['--code'], '--code');
    const v = await toVerb(p['--verb']);
    const rr = await resultFor(p['--result'], code, v, signal, io);
    return classifyWith({ code, signal, verb: v, result: rr.text }, rr.unusable);
  }
  throw new KitExit(`unknown subcommand "${sub}"; ${usage}`, 1);
}
