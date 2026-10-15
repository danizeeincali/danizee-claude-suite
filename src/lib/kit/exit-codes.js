/**
 * exit-codes — one explicit, machine-readable contract for kit exit statuses, so CI and workflows can tell a
 * broken TOOL (infrastructure) from a broken PRODUCT (a regression or refusal).
 *
 *   exit-codes table                                         the contract (classes, codes, descriptions, overrides)
 *   exit-codes describe <code> [--verb <v>] [--result <file|->]   class + description of a status
 *   exit-codes blocks <code> [--verb <v>] [--result <file|->]     { blocks }: true only for the regression class
 *   exit-codes classify --code <n> [--signal <name>] [--verb <v>] [--result <file|->]
 *
 * --result <file|-> is the JSON a product judge printed (a regular file of at most 1 MiB, or piped stdin). A judge exits 2 both when it
 * judged the product and said no and when it could not judge at all, so without --result a judge's 2 is a regression. With it, an exit 2 whose
 * result shows nothing was judged is infrastructure and never blocks: scrub with hit_count 0 and a non-empty not_scanned list
 * where every not_scanned reason is an environment reason (a partial clone with the remote unreachable); push-gate with decision deny and scrub.ran false, a reason
 * that says the check 'could not run' (e.g. git timed out), or a scrub block that is such a zero-hit partial-clone-only scan. Size, total,
 * not-a-regular-file and other reasons stay blocking (fail closed, described by their reason), as does any hit or a review deny.
 * The library takes the parsed object: classify({ code, verb, result }), blocksMerge(code, verb, signal, result). 124 (timeout(1)) is infrastructure.
 *
 * Classes: clean (0), regression (2 from a listed product judge only: the ONLY class allowed to block a merge), usage (1, invalid input
 * or broken state), precondition (4, a prerequisite was never met), infrastructure (5; the tool or environment failed:
 * timeout, crash, signal, any status >= 128; 126/127 = tool not executable / not found are preconditions). cli.js uses 2 for a
 * policy refusal of ANY kind, and many verbs refuse for tool limits (size caps, guarded-fs symlink and race refusals, argument
 * refusals) that say nothing about the product, so exit 2 is a NON-BLOCKING refusal (precondition) by default and blocks only
 * for verbs on the explicit PRODUCT_JUDGES list, whose 2 is a product verdict by their usage text (push-gate: deny; scrub: hits
 * or an incomplete scan, fail closed). A new verb is not a judge until it is added there. Some verbs document their own
 * statuses (diff-range 1 = bad input or a git failure, not separable yet; safe-git 3 = git ran and failed or timed
 * out, infrastructure; diff-range 3 = an empty range, clean). A bare 3 without a verb is ambiguous, so it is unknown.
 * Unknown statuses are reported as `unknown`, never as clean, and never block (only a known regression blocks).
 * A signal always wins and is infrastructure. All of blocks/describe/classify print JSON and exit 0; bad input is exit 1.
 * Built from ideas audited by /w-bbs (run 2026-10-15-bugpatrol); no foreign code.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { KitExit } from './kit-exit.js';

export const verb = 'exit-codes';
export const usage = 'cli.js exit-codes table | describe <code> [--verb <v>] [--result <file|->] | blocks <code> [--verb <v>] [--result <file|->] | classify --code <n> [--signal <name>] [--verb <v>] [--result <file|->]  (JSON out, exit 0; exit 1 on bad input)';

const freeze = (o) => Object.freeze(o);

/** The outcome classes. Only `regression` may block a merge. */
export const CLASSES = freeze({
  clean: freeze({ code: 0, blocks: false, description: 'The verb succeeded; nothing to report.' }),
  usage: freeze({ code: 1, blocks: false, description: 'Invalid input, broken state, or a tool failure (not separable yet): the call was malformed or the data unusable, or the tool crashed or a git child failed, since cli.js reports any crash as 1. Check the message before blaming the caller; never block on it.' }),
  regression: freeze({ code: 2, blocks: true, description: 'Regression: a verb that judges the product (see product_judges) ran and said no. The only outcome allowed to block a merge. Exit 2 from any other verb, or with no verb, is a refusal (precondition) and does not block. A judge also exits 2 when it could not judge (scrub on an incomplete scan, push-gate whose scrub check could not run); pass --result <file|-> (the verb\'s JSON output) to tell an unrun check (infrastructure) from a real verdict.' }),
  precondition: freeze({ code: 4, blocks: false, description: 'A prerequisite was never met (missing tool, file, credential or setup); nothing was judged.' }),
  infrastructure: freeze({ code: 5, blocks: false, description: 'The tool or environment failed (timeout, crash, signal, git failure); says nothing about the product. Retry or repair, never block on it alone.' }),
});

/** Statuses at or above this, and any signal death, are infrastructure. */
export const INFRA_FLOOR = 128;

/** Verbs whose exit 2 is a product verdict (checked against each verb's usage text); every other 2 is a non-blocking refusal. */
export const PRODUCT_JUDGES = freeze(['push-gate', 'scrub']);

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
    1: freeze({ class: 'usage', description: 'Bad input, or git failed or timed out while diff-range ran (diff-range exit 1); not separable from a malformed call yet, so read the message. Never a product verdict.' }),
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

const MAX_RESULT_BYTES = 1048576;
const NOT_JUDGED = 'The judge exited 2 but its result shows it could not judge the product (%s); nothing was decided about the product, so this is infrastructure and never blocks. Fix the environment (network, partial clone, git speed) and rerun.';

/** The only not_scanned reasons that come from the environment, not the product (the exact string scrub.js writes). Size limits, total limit, not-a-regular-file, unreadable and unknown reasons may hide a secret, so they stay blocking. */
const ENV_REASONS = freeze(['object not available locally (partial clone?)']);

const incompleteNoHits = (o) => o && typeof o === 'object' && o.hit_count === 0
  && Array.isArray(o.not_scanned) && o.not_scanned.length > 0
  && o.not_scanned.every((e) => e && typeof e === 'object' && ENV_REASONS.includes(e.reason));

/** Why a judge's result shows nothing was judged, or null. Field names are those of scrub.js and push-gate.js. */
export function unjudgedReason(v, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  if (v === 'scrub') return incompleteNoHits(result) ? 'scrub found no hits but every file it skipped was skipped for an environment reason (partial clone)' : null;
  if (v === 'push-gate') {
    if (result.decision !== 'deny') return null;
    if (result.scrub && typeof result.scrub === 'object') {
      if (result.scrub.ran === false) return 'the scrub check could not run (scrub.ran false)';
      if (incompleteNoHits(result.scrub)) return 'the scrub check skipped files only for an environment reason and found no hits';
    }
    if (typeof result.reason === 'string' && /could not run/i.test(result.reason) && !(result.scrub && result.scrub.hit_count > 0)) return 'the scrub check could not run';
  }
  return null;
}

/** The not_scanned reasons of a zero-hit judge result that stayed blocking, or null (fail closed: unscanned files, no verdict on them). */
function failClosedReasons(v, result) {
  const scan = v === 'scrub' ? result : v === 'push-gate' && result && result.decision === 'deny' ? result.scrub : null;
  if (!scan || typeof scan !== 'object' || scan.hit_count !== 0 || !Array.isArray(scan.not_scanned) || !scan.not_scanned.length) return null;
  const reasons = [...new Set(scan.not_scanned.map((e) => (e && typeof e === 'object' && typeof e.reason === 'string' ? e.reason : 'unknown reason')))];
  return reasons.slice(0, 5).join('; ') + (reasons.length > 5 ? '; ...' : '');
}

const AMBIGUOUS = { 3: 'Status 3 means different things per verb (safe-git: git failed, infrastructure; diff-range: empty range, clean); pass the verb to classify it.' };

/**
 * Classify a status. `signal` (a non-empty string) wins over the code. Returns
 * { code, signal, verb, class, known, blocks, description }; class is `unknown` for an unlisted status, which never blocks.
 */
export function classify({ code = null, signal = null, verb: v = null, result = null } = {}) {
  if (signal != null && signal !== '') {
    return { code, signal: String(signal), verb: v, class: 'infrastructure', known: true, blocks: false, description: `Killed by signal ${signal}: the tool or environment failed, not the product.` };
  }
  if (!Number.isInteger(code) || code < 0 || code > 255) throw new KitExit(`exit status must be an integer 0..255, got ${JSON.stringify(code)}`, 1);
  if (result != null && (typeof result !== 'object' || Array.isArray(result))) throw new KitExit('result must be the JSON object a verb printed', 1);
  const base = { code, signal: null, verb: v };
  if (code === 2 && v && PRODUCT_JUDGES.includes(v)) {
    const why = unjudgedReason(v, result);
    if (why) return { ...base, class: 'infrastructure', known: true, blocks: false, judged: false, description: NOT_JUDGED.replace('%s', why) };
    const fc = failClosedReasons(v, result);
    if (fc) return { ...base, class: 'regression', known: true, blocks: true, description: `Fail closed: ${v} found no hits but some files were not scanned for a product reason (${fc}), so it blocks. Shrink or split those files, or scan with a higher limit, then rerun.` };
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

/** True only when the status is a regression for that verb. Unknown, infrastructure, signals and bad input are false. */
export function blocksMerge(code, v = null, signal = null, result = null) {
  try { return classify({ code, verb: v, signal, result }).blocks === true; } catch { return false; }
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
async function readResult(arg, io) {
  if (arg == null) return null;
  let text;
  if (arg === '-') {
    if (!io || typeof io.stdin !== 'function' || io.stdinIsTTY) throw new KitExit('--result - needs piped stdin, not a terminal', 1);
    text = (await io.stdin()).toString('utf-8');
  } else {
    const file = path.resolve((io && io.cwd) || process.cwd(), arg);
    const st = await fs.stat(file).catch((e) => { throw new KitExit(`cannot read --result ${arg}: ${e.code || e.message}`, 1); });
    if (!st.isFile()) throw new KitExit(`--result ${arg} is not a regular file`, 1);
    if (st.size > MAX_RESULT_BYTES) throw new KitExit(`--result ${arg} is larger than ${MAX_RESULT_BYTES} bytes`, 1);
    text = await fs.readFile(file, 'utf-8');
  }
  if (Buffer.byteLength(text) > MAX_RESULT_BYTES) throw new KitExit(`--result is larger than ${MAX_RESULT_BYTES} bytes`, 1);
  if (!text.trim()) throw new KitExit('--result is empty (the verb printed nothing; did it crash?)', 1);
  let j;
  try { j = JSON.parse(text); } catch { throw new KitExit('--result is not valid JSON (pass the verb\'s JSON output)', 1); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new KitExit('--result must be a JSON object (the verb\'s output)', 1);
  return j;
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
  if (!sub || sub === '--help') return { usage };
  if (rest.includes('--help') && ['table', 'describe', 'blocks', 'classify'].includes(sub)) return { usage };
  if (sub === 'table') { parse(rest, 0, []); return TABLE; }
  if (sub === 'describe' || sub === 'blocks') {
    const p = parse(rest, 1, ['--verb', '--result']);
    if (!p._.length) throw new KitExit(`${sub} needs a <code>; ${usage}`, 1);
    const r = classify({ code: toCode(p._[0], '<code>'), verb: await toVerb(p['--verb']), result: await readResult(p['--result'], io) });
    return sub === 'blocks' ? { code: r.code, verb: r.verb, class: r.class, blocks: r.blocks } : r;
  }
  if (sub === 'classify') {
    const p = parse(rest, 0, ['--code', '--signal', '--verb', '--result']);
    const signal = toSignal(p['--signal']);
    if (p['--code'] == null && signal == null) throw new KitExit(`classify needs --code <n> or --signal <name>; ${usage}`, 1);
    return classify({ code: p['--code'] == null ? null : toCode(p['--code'], '--code'), signal, verb: await toVerb(p['--verb']), result: await readResult(p['--result'], io) });
  }
  throw new KitExit(`unknown subcommand "${sub}"; ${usage}`, 1);
}
