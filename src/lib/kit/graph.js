/**
 * graph — a small symbol graph of a JS/TS repository, built from per-file facts that are cached by content hash.
 *
 *   graph [--dir <path>] [--changed <file>...] [--diff <file|->] [--budget-ms N] [--max-parses N] [--json]
 *
 * WHAT IT DOES. Each source file is scanned once into local facts: definitions with line spans, call sites, imports and
 * exports. The facts are cached under `<repo>/.claude/kit/cache/graph/<sha256>.json`; the key hashes EXTRACTOR_VERSION,
 * the file's language class (js or ts) and its bytes, so an unchanged file is never scanned again and a new extractor
 * version never reads old facts. A second, cheap pass over the facts links calls to definitions across files.
 *
 * WHAT IT READS. Only .js .mjs .cjs .jsx .ts .tsx .mts .cts. The scanner is hand-written (no parser dependency): it
 * skips strings, template literals (with `${}` nesting), comments and regex literals so text in them never becomes a
 * symbol. It does not understand JSX text, so a .jsx/.tsx file whose text breaks the scanner (an apostrophe in element
 * text, say) is unread with reason parse_error, never guessed at. Not recorded: calls inside parameter lists, object
 * literal methods (their calls count for the enclosing definition), a second declarator after a comma, generic call
 * syntax `f<T>(x)`, local shadowing of an imported name. Files in other languages (.py, .go, .vue, ...) are listed in
 * `not_read` with reason unsupported; other file types (markdown, json, images) are not source and only counted.
 *
 * WHAT IT NEVER DOES. It never runs, imports or evaluates the code it reads; there is no network call. File contents are
 * read through guarded-fs (a symlink anywhere on the way to a source file is refused, not followed; a size cap applies),
 * the file list comes from safe-git (the repository's own config is never run), and the cache is written through
 * guarded-fs too, with the cache folder protected from symlinks. A cache file that is missing, corrupt, from another
 * extractor version or of the wrong shape is a miss, never trusted. If the cache folder itself is refused (a symlink),
 * the build goes on uncached and says so in `stats.cache_error`.
 *
 * BUDGET. The build has a wall-clock budget (--budget-ms), a cap on files scanned (--max-parses; cache hits are free), a
 * size cap per file and an elapsed-time check inside each scan, so one pathological file cannot stall it. Changed files
 * come first, so a cut never loses the files under review. Whatever is cut is listed: `partial` is true when any file is
 * in `not_read` (reason budget, parse_cap, too_large, unsupported or parse_error) or the `unresolved` list was cut at its cap of 5000 rows (`stats.unresolved_total` has the real count), and the result never claims to be complete then. `not_read` itself is capped at 2000 rows (`stats.not_read_total`).
 *
 * RESOLUTION (confidence). certain: one definition fits (same file, relative import with extension/index resolution,
 * `this.` inside a class). likely: found through inheritance, a namespace/default import or a static member. possible:
 * a name that fits several definitions, or a method call on an object of unknown type (never certain). Calls that
 * cannot be linked go to `unresolved` with a reason: ambiguous, dynamic member, computed, value call, external module,
 * unread target, unknown export.
 *
 * Exit codes: 1 invalid input or broken state, 2 policy refusal. Built from ideas audited by /w-bbs (run 2026-10-10-openqodex-2); no foreign code.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { gitPaths } from './git-paths.js';
import { safeGit, locateRepo } from './safe-git.js';
import { guardedRead, guardedWrite } from './guarded-fs.js';
import { parseDiff } from './lenses.js';

export const verb = 'graph';
export const usage = 'cli.js graph [--dir <path>] [--changed <file>...] [--diff <file|->] [--budget-ms N] [--max-parses N] [--json]   '
  + '(symbol graph of the JS/TS files in the repository, facts cached by content hash; changed files first; --changed paths, like diff paths, are relative to the repository top, not the current folder; `partial` and `not_read` say what was cut; '
  + '--diff - reads a unified diff from piped stdin, never a terminal; exit 0 built, 1 invalid, 2 refused)';

export const EXTRACTOR_VERSION = 'graph-facts-2';
export const SUPPORTED_EXT = Object.freeze(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);
const TS_EXT = new Set(['.ts', '.tsx', '.mts', '.cts']);
const OTHER_CODE_EXT = new Set(['.py', '.go', '.rs', '.java', '.kt', '.kts', '.scala', '.rb', '.php', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp',
  '.cs', '.swift', '.m', '.mm', '.lua', '.pl', '.sh', '.bash', '.zsh', '.ps1', '.vue', '.svelte', '.astro', '.dart', '.ex', '.exs', '.erl',
  '.hs', '.ml', '.clj', '.coffee', '.groovy', '.zig', '.nim', '.jl']);

export const DEFAULTS = Object.freeze({
  budgetMs: 20000, maxParses: 2000, maxFileBytes: 1024 * 1024, maxFileMs: 2000, maxFiles: 20000,
  maxNotRead: 2000, maxUnresolved: 5000, maxCandidates: 8, maxDiffBytes: 32 * 1024 * 1024, maxCacheBytes: 16 * 1024 * 1024
});

const refuse = (msg) => new KitExit(msg, 2);
const invalid = (msg) => new KitExit(msg, 1);

// ================================================================ scanner

class Unread extends Error {
  constructor(reason, detail) { super(detail); this.reason = reason; this.detail = detail; }
}

const OPS = ['...', '===', '!==', '**=', '&&=', '||=', '??=', '=>', '==', '!=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**'];
const REGEX_AFTER_KW = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const isIdStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c > 127;
const isIdPart = (c) => isIdStart(c) || (c >= 48 && c <= 57);
const isDigit = (c) => c >= 48 && c <= 57;
// a line ends at \n, at \r (alone or before \n), U+2028 and U+2029
const isEol = (c) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
const OPEN = Object.assign(Object.create(null), { '(': ')', '[': ']', '{': '}' });

/** Source text → tokens {t: id|p|str|num|re, v, line}. Throws Unread on text it cannot scan to the end. */
export function tokenize(src, { clock, deadline } = {}) {
  const toks = [];
  const n = src.length;
  const braces = [];
  let i = 0;
  let line = 1;
  let tick = 0;
  const fail = (msg, at = line) => { throw new Unread('parse_error', `${msg} (line ${at})`); };
  const regexAllowed = () => {
    const p = toks[toks.length - 1];
    if (!p) return true;
    if (p.t === 'id') return REGEX_AFTER_KW.has(p.v);
    if (p.t !== 'p') return false;
    return !(p.v === ')' || p.v === ']' || p.v === '++' || p.v === '--');
  };
  const scanTemplate = (j) => {
    while (j < n) {
      const ch = src.charCodeAt(j);
      if (ch === 92) { if (src[j + 1] === '\n' || (src[j + 1] === '\r' && src[j + 2] !== '\n')) line++; j += 2; continue; }
      if (ch === 10 || (ch === 13 && src[j + 1] !== '\n')) line++;
      if (ch === 96) { toks.push({ t: 'str', v: '', line }); return j + 1; }
      if (ch === 36 && src[j + 1] === '{') { braces.push('t'); toks.push({ t: 'p', v: '{', line }); return j + 2; }
      j++;
    }
    return fail('unterminated template literal');
  };
  if (src.startsWith('#!')) { while (i < n && !isEol(src.charCodeAt(i))) i++; }
  while (i < n) {
    if (clock && (++tick & 1023) === 0 && clock() > deadline) throw new Unread('budget', 'time limit for one file');
    const code = src.charCodeAt(i);
    if (code === 10 || (code === 13 && src[i + 1] !== '\n') || code === 0x2028 || code === 0x2029) { line++; i++; continue; }
    if (code === 32 || code === 9 || code === 13 || code === 11 || code === 12 || code === 0xfeff || code === 0xa0) { i++; continue; }
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && !isEol(src.charCodeAt(i))) i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const start = line;
      let j = i + 2;
      for (; j < n && !(src[j] === '*' && src[j + 1] === '/'); j++) if (src[j] === '\n' || (src[j] === '\r' && src[j + 1] !== '\n') || src[j] === '\u2028' || src[j] === '\u2029') line++;
      if (j >= n) fail('unterminated comment', start);
      i = j + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = line;
      let j = i + 1;
      let v = '';
      for (; j < n; j++) {
        const ch = src[j];
        if (ch === c) break;
        if (ch === '\\') {
          if (src[j + 1] === '\r' && src[j + 2] === '\n') { line++; j += 2; continue; }
          if (src[j + 1] === '\n' || (src[j + 1] === '\r' && src[j + 2] !== '\n') || src[j + 1] === '\u2028' || src[j + 1] === '\u2029') line++;
          j++;
          continue;
        }
        if (ch === '\n' || ch === '\r') fail('unterminated string', start);
        if (v.length < 512) v += ch;
      }
      if (j >= n) fail('unterminated string', start);
      toks.push({ t: 'str', v, line: start });
      i = j + 1;
      continue;
    }
    if (c === '`') { toks.push({ t: 'str', v: '', line }); i = scanTemplate(i + 1); continue; }
    if (isDigit(code) || (c === '.' && isDigit(src.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < n) {
        const ch = src.charCodeAt(j);
        if (isIdPart(ch) || ch === 46) { j++; continue; }
        if ((ch === 43 || ch === 45) && /^[0-9.]+[eE]$/.test(src.slice(i, j))) { j++; continue; }
        break;
      }
      toks.push({ t: 'num', v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (isIdStart(code) || (c === '#' && isIdStart(src.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < n && isIdPart(src.charCodeAt(j))) j++;
      toks.push({ t: 'id', v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      for (; j < n; j++) {
        const ch = src[j];
        if (ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029') break;
        if (ch === '\\') { j++; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { closed = true; break; }
      }
      if (closed) {
        j++;
        while (j < n && isIdPart(src.charCodeAt(j))) j++;
        toks.push({ t: 're', v: '', line });
        i = j;
        continue;
      }
      // no closing slash on the line: it was a division after all
    }
    if (c === '{') { braces.push('b'); toks.push({ t: 'p', v: '{', line }); i++; continue; }
    if (c === '}') {
      const top = braces.pop();
      if (top === undefined) fail('unbalanced }');
      toks.push({ t: 'p', v: '}', line });
      i++;
      if (top === 't') i = scanTemplate(i);
      continue;
    }
    let op = c;
    for (const o of OPS) {
      if (src.startsWith(o, i)) { op = o; break; }
    }
    if (op === '?.' && isDigit(src.charCodeAt(i + 2))) op = '?';
    toks.push({ t: 'p', v: op, line });
    i += op.length;
  }
  if (braces.length) fail('unterminated template literal or unclosed {');
  return toks;
}

/** match[k] = index of the bracket that pairs with token k, or -1. Throws Unread on a mismatch. */
function pairBrackets(toks) {
  const match = new Int32Array(toks.length).fill(-1);
  const stack = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'p') continue;
    if (OPEN[t.v]) stack.push(k);
    else if (t.v === ')' || t.v === ']' || t.v === '}') {
      const o = stack.pop();
      if (o === undefined || OPEN[toks[o].v] !== t.v) throw new Unread('parse_error', `unbalanced ${t.v} (line ${t.line})`);
      match[o] = k;
      match[k] = o;
    }
  }
  if (stack.length) { const o = toks[stack.pop()]; throw new Unread('parse_error', `unclosed ${o.v} (line ${o.line})`); }
  return match;
}

const CONTROL = new Set(['if', 'while', 'for', 'switch', 'catch', 'with']);
const NOT_CALL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'typeof', 'void', 'delete', 'await', 'yield', 'function',
  'class', 'super', 'import', 'do', 'else', 'case', 'throw', 'in', 'of', 'instanceof', 'var', 'let', 'const', 'async', 'require']);
const NOT_PARAM = new Set(['function', 'class', 'new', 'typeof', 'void', 'await', 'yield', 'return', 'this', 'null', 'true', 'false']);
const MODS = new Set(['static', 'async', 'get', 'set', 'public', 'private', 'protected', 'readonly', 'override', 'abstract', 'declare', 'accessor']);
const CONTINUES_LINE = new Set(['.', '?.', '(', '[', '+', '-', '*', '/', '%', '?', ':', '=', ',', '&&', '||', '??', '|', '&', '^', '<', '>', '=>', '==', '===', '!=', '!==', '**', '+=', '-=']);
const MEMBER_BLOCKERS = new Set(['=', '.', '?.', ',', ':', '(', '[', '=>', '?', '|', '&', '<', '+', '-', '/', '%', '!', '~', '&&', '||', '??']);
const EXPR_WORDS = new Set(['new', 'typeof', 'await', 'void', 'delete', 'in', 'of', 'instanceof', 'return', 'yield', 'extends', 'implements']);
const CONTINUING_WORDS = new Set(['in', 'of', 'instanceof', 'as', 'satisfies', 'extends']);

/**
 * Facts for one source file. `path` only picks the language class (by extension). Returns
 * { defs, calls, imports, exports } or { unread: 'unsupported'|'parse_error'|'budget', detail } — never a guess.
 *   defs    [{name, kind: function|class|method|arrow|var-fn|interface, start, end, parent, up, exported, extends?, implements?}]
 *           (start/end are lines; parent is the enclosing definition's name, up its index in defs or -1;
 *           class.extends is a string, interface.extends an array; method includes class property functions)
 *   calls   [{name, receiver, kind: direct|member|computed|value, line, owner}] (owner: index into defs, -1 at module level)
 *   imports [{source, names: [{imported, local}], kind: esm|require|dynamic, line, reexport?}] (source null = not a literal)
 *   exports [{name, local, source?, as?}] ('default' is a name; name '*' with a source is `export * from`)
 */
export function extractFacts(source, { path: file = '', clock, maxMs } = {}) {
  const ext = path.extname(String(file)).toLowerCase();
  if (!SUPPORTED_EXT.includes(ext)) return { unread: 'unsupported', detail: ext ? `${ext} files are not read` : 'no file extension' };
  const ts = TS_EXT.has(ext);
  const deadline = clock && maxMs ? clock() + maxMs : Infinity;
  try {
    const toks = tokenize(String(source), { clock, deadline });
    return scanFacts(toks, pairBrackets(toks), ts, { clock, deadline });
  } catch (e) {
    if (e instanceof Unread) return { unread: e.reason, detail: e.detail };
    throw e;
  }
}

function scanFacts(toks, match, ts, { clock, deadline }) {
  const n = toks.length;
  const defs = [];
  const calls = [];
  const imports = [];
  const exportsList = [];
  const stack = [];
  const isP = (k, v) => k >= 0 && k < n && toks[k].t === 'p' && toks[k].v === v;
  const isId = (k, v) => k >= 0 && k < n && toks[k].t === 'id' && (v === undefined || toks[k].v === v);
  const nearestDef = () => { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].defIdx !== undefined) return stack[k].defIdx; return -1; };
  const makeDef = (name, kind, start, exported, extra) => {
    const up = nearestDef();
    defs.push({ name, kind, start, end: start, parent: up >= 0 ? defs[up].name : null, up, exported: !!exported, ...extra });
    return defs.length - 1;
  };

  /** Index after a balanced <...> that starts at k, or -1 (bounded; gives up at ; ) ] }). */
  const skipAngle = (k) => {
    let depth = 0;
    for (let q = k; q < n && q < k + 300; q++) {
      const u = toks[q];
      if (u.t !== 'p') continue;
      if (u.v === '<') depth++;
      else if (u.v === '>') { if (--depth === 0) return q + 1; } else if (OPEN[u.v]) q = match[q];
      else if (u.v === ';' || u.v === ')' || u.v === ']' || u.v === '}') return -1;
    }
    return -1;
  };
  /** Index of the `{` that opens a body after a parameter list closed at k-1, or -1 when there is none (overload, abstract). */
  const bodyBrace = (k) => {
    const from = k;
    while (k < n && k - from < 400) {
      const u = toks[k];
      if (u.t === 'p') {
        if (u.v === '{') {
          const p = toks[k - 1];
          if (p && p.t === 'p' && (p.v === ':' || p.v === '|' || p.v === '&' || p.v === '<' || p.v === ',' || p.v === '=>')) { k = match[k] + 1; continue; }
          return k;
        }
        if (u.v === '(' || u.v === '[') { k = match[k] + 1; continue; }
        if (u.v === '<') { const e = skipAngle(k); k = e > 0 ? e : k + 1; continue; }
        if (u.v === ';' || u.v === '}' || u.v === ')' || u.v === ']' || u.v === '=' || u.v === ',') return -1;
      }
      k++;
    }
    return -1;
  };
  /** Where an expression that starts at b ends (index of the terminator token). */
  const exprEnd = (b) => {
    let prevT = toks[b - 1];
    for (let k = b; k < n;) {
      const t = toks[k];
      if (t.t === 'p') {
        if (OPEN[t.v]) { k = match[k] + 1; prevT = toks[k - 1]; continue; }
        if (t.v === ',' || t.v === ';' || t.v === ')' || t.v === ']' || t.v === '}') return k;
      }
      if (k > b && t.line > prevT.line) {
        const complete = prevT.t !== 'p' || prevT.v === ')' || prevT.v === ']' || prevT.v === '}' || prevT.v === '++' || prevT.v === '--';
        const continues = (t.t === 'p' && CONTINUES_LINE.has(t.v)) || (t.t === 'id' && CONTINUING_WORDS.has(t.v));
        if (complete && !continues) return k;
      }
      prevT = t;
      k++;
    }
    return n;
  };
  /** An arrow function starting at j → { block } | { expr } (index of its body), or null. */
  const arrowAt = (j) => {
    let k = j;
    if (isId(k, 'async') && !isP(k + 1, '=>')) k++;
    if (ts && isP(k, '<')) { const e = skipAngle(k); if (e < 0) return null; k = e; }
    const t = toks[k];
    if (!t) return null;
    let arrow = -1;
    if (t.t === 'p' && t.v === '(') {
      const m = match[k] + 1;
      if (isP(m, '=>')) arrow = m;
      else if (ts && isP(m, ':')) {
        for (let q = m + 1, guard = 0; q < n && guard++ < 400;) {
          const u = toks[q];
          if (u.t === 'p') {
            if (OPEN[u.v]) { q = match[q] + 1; continue; }
            if (u.v === '=>') { arrow = q; break; }
            if (u.v === ';' || u.v === '}' || u.v === ')' || u.v === ']' || u.v === '=') break;
            if (u.v === '<') { const e = skipAngle(q); if (e > 0) { q = e; continue; } }
          }
          q++;
        }
      }
    } else if (t.t === 'id' && !NOT_PARAM.has(t.v) && isP(k + 1, '=>')) arrow = k + 1;
    if (arrow < 0 || arrow + 1 >= n) return null;
    return isP(arrow + 1, '{') ? { block: arrow + 1 } : { expr: arrow + 1 };
  };
  /** A function expression starting at v (`function` or `async function`) → { block } or null. */
  const fnExpr = (v) => {
    let k = v;
    if (isId(k, 'async')) k++;
    if (!isId(k, 'function')) return null;
    k++;
    if (isP(k, '*')) k++;
    if (isId(k)) k++;
    if (ts && isP(k, '<')) { const e = skipAngle(k); if (e < 0) return null; k = e; }
    if (!isP(k, '(')) return null;
    const b = bodyBrace(match[k] + 1);
    return b < 0 ? null : { block: b };
  };
  /** Open the scope of a definition's body; returns the index to continue from. */
  const enter = (defIdx, shape) => {
    if (shape.block !== undefined) { stack.push({ kind: 'block', defIdx }); return shape.block + 1; }
    stack.push({ kind: 'expr', defIdx, endIdx: exprEnd(shape.expr) });
    return shape.expr;
  };
  const dotted = (k) => {
    let name = toks[k].v;
    k++;
    while (isP(k, '.') && isId(k + 1)) { name += `.${toks[k + 1].v}`; k += 2; }
    return { name, next: k };
  };
  const addExport = (name, local, extra) => exportsList.push({ name, local: local ?? null, ...extra });

  let exportNext = false;
  let tick = 0;
  let i = 0;
  while (i < n) {
    if (clock && (++tick & 1023) === 0 && clock() > deadline) throw new Unread('budget', 'time limit for one file');
    while (stack.length && stack[stack.length - 1].kind === 'expr' && stack[stack.length - 1].endIdx <= i) {
      const s = stack.pop();
      defs[s.defIdx].end = toks[Math.max(s.endIdx - 1, 0)].line;
    }
    const t = toks[i];
    const wasExport = exportNext;
    exportNext = false;
    const prev = toks[i - 1];
    const afterDot = !!prev && prev.t === 'p' && (prev.v === '.' || prev.v === '?.');
    const top = stack[stack.length - 1];

    if (top && top.kind === 'class' && (t.t === 'id' || t.t === 'str' || t.t === 'num' || (t.t === 'p' && (t.v === '[' || t.v === '*')))) {
      const r = member(i);
      if (r >= 0) { i = r; continue; }
    }

    if (t.t === 'p') {
      if (t.v === '{') { stack.push({ kind: 'block' }); i++; continue; }
      if (t.v === '}') {
        const s = stack.pop();
        if (!s) throw new Unread('parse_error', `unbalanced } (line ${t.line})`);
        if (s.defIdx !== undefined) defs[s.defIdx].end = t.line;
        i++;
        continue;
      }
      if (t.v === '(' && prev) {
        let rec = null;
        if (prev.t === 'p' && prev.v === ']') {
          const open = match[i - 1];
          const before = toks[open - 1];
          const root = before && before.t === 'id' && !(toks[open - 2] && toks[open - 2].t === 'p' && (toks[open - 2].v === '.' || toks[open - 2].v === '?.'));
          rec = { name: '[]', receiver: root ? before.v : null, kind: 'computed' };
        } else if (prev.t === 'p' && prev.v === ')') {
          const head = toks[match[i - 1] - 1];
          if (!(head && head.t === 'id' && CONTROL.has(head.v))) rec = { name: '()', receiver: null, kind: 'value' };
        } else if (prev.t === 'p' && prev.v === '?.') {
          rec = { name: '()', receiver: null, kind: 'value' };
        }
        if (rec) calls.push({ ...rec, line: t.line, owner: nearestDef() });
      }
      i++;
      continue;
    }

    if (t.t === 'id' && afterDot && isP(i + 1, '(')) {
      const before = toks[i - 2];
      const root = before && before.t === 'id' && !(toks[i - 3] && toks[i - 3].t === 'p' && (toks[i - 3].v === '.' || toks[i - 3].v === '?.'));
      calls.push({ name: t.v, receiver: root ? before.v : null, kind: 'member', line: t.line, owner: nearestDef() });
    }
    if (t.t !== 'id' || afterDot) {
      i++;
      continue;
    }

    switch (t.v) {
      case 'export': i = handleExport(i); continue;
      case 'import': i = handleImport(i); continue;
      case 'function': i = handleFunction(i, wasExport); continue;
      case 'class': i = handleClass(i, wasExport, null, t.line); continue;
      case 'const': case 'let': case 'var': i = handleDecl(i, wasExport); continue;
      case 'exports': case 'module': { const r = handleCjs(i); if (r > i) { i = r; continue; } break; }
      case 'default': case 'declare': case 'abstract':
        exportNext = wasExport; i++; continue;
      case 'async':
        exportNext = wasExport; i++; continue;
      default: break;
    }
    if (ts) {
      if (t.v === 'interface' && isId(i + 1)) { i = handleInterface(i, wasExport); continue; }
      if (t.v === 'type' && isId(i + 1) && (isP(i + 2, '=') || isP(i + 2, '<'))) {
        if (wasExport) addExport(toks[i + 1].v, toks[i + 1].v);
        i = exprEnd(i + 3);
        continue;
      }
      if (t.v === 'enum' && isId(i + 1) && isP(i + 2, '{')) {
        if (wasExport) addExport(toks[i + 1].v, toks[i + 1].v);
        i = match[i + 2] + 1;
        continue;
      }
    }
    if (t.v === 'require' && isP(i + 1, '(')) {
      if (toks[i + 2] && toks[i + 2].t === 'str' && isP(i + 3, ')')) {
        imports.push({ source: toks[i + 2].v, names: [], kind: 'require', line: t.line });
        i += 4;
      } else {
        imports.push({ source: null, names: [], kind: 'dynamic', line: t.line });
        i++;
      }
      continue;
    }
    if (isP(i + 1, '(') && !NOT_CALL.has(t.v)) {
      const close = match[i + 1];
      const isNew = !!prev && prev.t === 'id' && prev.v === 'new';
      if (!(isP(close + 1, '{') && !isNew)) { // `name(args) {` is an object-literal method, not a call
        calls.push({ name: t.v, receiver: null, kind: 'direct', line: t.line, owner: nearestDef() });
      }
    }
    i++;
  }
  for (const s of stack) if (s.kind !== 'expr') throw new Unread('parse_error', 'unclosed block');
  for (const s of stack) defs[s.defIdx].end = toks[n - 1].line;
  const out = { defs, calls, imports, exports: exportsList };
  const exportedLocals = new Set(exportsList.filter(e => !e.source && e.local).map(e => e.local));
  for (const d of defs) if (d.up < 0 && exportedLocals.has(d.name)) d.exported = true;
  return out;

  // ---- handlers (hoisted)

  function member(i0) {
    // a member starts a line of the class body; after an operator or `new` the same tokens are an expression (a call)
    const before = toks[i0 - 1];
    if (before && ((before.t === 'p' && MEMBER_BLOCKERS.has(before.v)) || (before.t === 'id' && EXPR_WORDS.has(before.v)))) return -1;
    let j = i0;
    while (isId(j) && MODS.has(toks[j].v)) {
      const nx = toks[j + 1];
      if (!nx) break;
      const cont = nx.t === 'id' || nx.t === 'str' || nx.t === 'num' || (nx.t === 'p' && (nx.v === '[' || nx.v === '*'));
      if (!cont) break;
      j++;
    }
    if (isP(j, '*')) j++;
    const nt = toks[j];
    if (!nt) return -1;
    let name = null;
    if (nt.t === 'id' || nt.t === 'str' || nt.t === 'num') { name = nt.v; j++; } else if (nt.t === 'p' && nt.v === '[') j = match[j] + 1;
    else return -1;
    if (isP(j, '?') || isP(j, '!')) j++;
    if (ts && isP(j, '<')) { const e = skipAngle(j); if (e < 0) return -1; j = e; }
    if (isP(j, '(')) {
      const close = match[j];
      const b = bodyBrace(close + 1);
      if (b < 0) return close + 1;
      if (name === null) { stack.push({ kind: 'block' }); return b + 1; }
      const idx = makeDef(name, 'method', toks[i0].line, false);
      stack.push({ kind: 'block', defIdx: idx });
      return b + 1;
    }
    if (isP(j, '=') && name !== null) {
      const shape = fnExpr(j + 1) || arrowAt(j + 1);
      if (!shape) return -1;
      return enter(makeDef(name, 'method', toks[i0].line, false), shape);
    }
    return -1;
  }

  function handleFunction(i0, exp) {
    let j = i0 + 1;
    if (isP(j, '*')) j++;
    let name = null;
    if (isId(j)) { name = toks[j].v; j++; }
    if (ts && isP(j, '<')) { const e = skipAngle(j); if (e < 0) return i0 + 1; j = e; }
    if (!isP(j, '(')) return i0 + 1;
    const close = match[j];
    const b = bodyBrace(close + 1);
    if (b < 0) return close + 1;
    if (name) {
      const idx = makeDef(name, 'function', toks[i0].line, !!exp);
      stack.push({ kind: 'block', defIdx: idx });
      if (exp === 'default') addExport('default', name);
      else if (exp) addExport(name, name);
    } else {
      stack.push({ kind: 'block' });
      if (exp) addExport('default', null);
    }
    return b + 1;
  }

  function handleClass(i0, exp, nameHint, line) {
    let j = i0 + 1;
    let name = nameHint;
    if (isId(j) && toks[j].v !== 'extends' && toks[j].v !== 'implements') { name = toks[j].v; j++; }
    if (ts && isP(j, '<')) { const e = skipAngle(j); if (e > 0) j = e; }
    let ext;
    const impl = [];
    let mode = null;
    if (!(isP(j, '{') || isId(j, 'extends') || isId(j, 'implements'))) return i0 + 1;
    for (; j < n; ) {
      const u = toks[j];
      if (u.t === 'p' && u.v === '{') break;
      if (u.t === 'id' && (u.v === 'extends' || u.v === 'implements')) { mode = u.v; j++; continue; }
      if (u.t === 'id' && mode) {
        const d = dotted(j);
        if (mode === 'extends') ext = d.name; else impl.push(d.name);
        j = d.next;
        if (isP(j, '<')) { const e = skipAngle(j); if (e > 0) j = e; }
        if (mode === 'extends' && isP(j, '(')) j = match[j] + 1;
        continue;
      }
      if (u.t === 'p' && OPEN[u.v]) { j = match[j] + 1; continue; }
      if (u.t === 'p' && (u.v === ';' || u.v === '}' || u.v === ')')) return i0 + 1;
      j++;
    }
    if (j >= n) return i0 + 1;
    let idx;
    if (name) {
      const extra = {};
      if (ext) extra.extends = ext;
      if (impl.length) extra.implements = impl;
      idx = makeDef(name, 'class', line, !!exp, extra);
      if (exp === 'default') addExport('default', name);
      else if (exp) addExport(name, name);
    } else if (exp) addExport('default', null);
    stack.push({ kind: 'class', defIdx: idx });
    return j + 1;
  }

  function handleInterface(i0, exp) {
    let j = i0 + 2;
    const name = toks[i0 + 1].v;
    if (isP(j, '<')) { const e = skipAngle(j); if (e > 0) j = e; }
    const bases = [];
    if (isId(j, 'extends')) {
      j++;
      while (isId(j)) {
        const d = dotted(j);
        bases.push(d.name);
        j = d.next;
        if (isP(j, '<')) { const e = skipAngle(j); if (e > 0) j = e; }
        if (isP(j, ',')) j++; else break;
      }
    }
    if (!isP(j, '{')) return i0 + 1;
    const idx = makeDef(name, 'interface', toks[i0].line, !!exp, bases.length ? { extends: bases } : {});
    defs[idx].end = toks[match[j]].line;
    if (exp) addExport(name, name);
    return match[j] + 1;
  }

  function handleDecl(i0, exp) {
    let j = i0 + 1;
    const startLine = toks[i0].line;
    if (isId(j)) {
      const name = toks[j].v;
      let k = j + 1;
      if (ts && isP(k, '!')) k++;
      if (ts && isP(k, ':')) {
        let q = k + 1;
        for (let guard = 0; q < n && guard++ < 400;) {
          const u = toks[q];
          if (u.t === 'p') {
            if (OPEN[u.v]) { q = match[q] + 1; continue; }
            if (u.v === '=') break;
            if (u.v === ';' || u.v === ',' || u.v === ')' || u.v === '}') { q = -1; break; }
            if (u.v === '<') { const e = skipAngle(q); if (e > 0) { q = e; continue; } }
          }
          q++;
        }
        k = q;
      }
      if (exp) addExport(name, name);
      if (k >= 0 && isP(k, '=')) {
        const v = k + 1;
        if (isId(v, 'require') && isP(v + 1, '(') && toks[v + 2] && toks[v + 2].t === 'str' && isP(v + 3, ')')) {
          let names = [{ imported: '*', local: name }];
          let end = v + 4;
          if (isP(end, '.') && isId(end + 1)) { names = [{ imported: toks[end + 1].v, local: name }]; end += 2; }
          imports.push({ source: toks[v + 2].v, names, kind: 'require', line: toks[v].line });
          return end;
        }
        if (isId(v, 'class')) return handleClass(v, false, name, startLine);
        const shape = fnExpr(v);
        if (shape) return enter(makeDef(name, 'var-fn', startLine, !!exp), shape);
        const arrow = arrowAt(v);
        if (arrow) return enter(makeDef(name, 'arrow', startLine, !!exp), arrow);
        return k + 1;
      }
      return j + 1;
    }
    if (isP(j, '{') && isP(match[j] + 1, '=') && isId(match[j] + 2, 'require') && isP(match[j] + 3, '(')
      && toks[match[j] + 4] && toks[match[j] + 4].t === 'str' && isP(match[j] + 5, ')')) {
      const names = [];
      for (let k = j + 1; k < match[j];) {
        if (isId(k)) {
          const imported = toks[k].v;
          let local = imported;
          k++;
          if (isP(k, ':') && isId(k + 1)) { local = toks[k + 1].v; k += 2; }
          if (isP(k, '=')) { while (k < match[j] && !isP(k, ',')) k = OPEN[toks[k].v] ? match[k] + 1 : k + 1; }
          names.push({ imported, local });
          if (exp) addExport(local, local);
        } else k++;
      }
      imports.push({ source: toks[match[j] + 4].v, names, kind: 'require', line: toks[match[j] + 3].line });
      return match[j] + 6;
    }
    return j;
  }

  function handleCjs(i0) {
    // exports.NAME = rhs | module.exports.NAME = rhs | module.exports = rhs
    let k = i0;
    let name = null;
    if (toks[k].v === 'module') {
      if (!(isP(k + 1, '.') && isId(k + 2, 'exports'))) return i0;
      k += 3;
    } else k += 1;
    if (isP(k, '.') && isId(k + 1) && isP(k + 2, '=')) { name = toks[k + 1].v; k += 2; } else if (toks[i0].v === 'module' && isP(k, '=')) name = null;
    else return i0;
    const rhs = k + 1;
    const line = toks[i0].line;
    if (name !== null) {
      const fn = fnExpr(rhs);
      const shape = fn || arrowAt(rhs);
      if (shape) {
        const idx = makeDef(name, fn ? 'var-fn' : 'arrow', line, true);
        addExport(name, name);
        return enter(idx, shape);
      }
      const direct = isId(rhs) && !isP(rhs + 1, '(') && !isP(rhs + 1, '.') && !isP(rhs + 1, '[') ? toks[rhs].v : null;
      addExport(name, direct);
      return rhs;
    }
    if (isP(rhs, '{')) {
      for (let q = rhs + 1; q < match[rhs];) {
        const key = toks[q];
        if (key.t === 'id' || key.t === 'str') {
          let local = null;
          if (isP(q + 1, ',') || q + 1 === match[rhs]) local = key.t === 'id' ? key.v : null;
          else if (isP(q + 1, ':') && toks[q + 2] && toks[q + 2].t === 'id' && (isP(q + 3, ',') || q + 3 === match[rhs])) local = toks[q + 2].v;
          addExport(key.v, local);
        }
        while (q < match[rhs] && !isP(q, ',')) q = toks[q].t === 'p' && OPEN[toks[q].v] ? match[q] + 1 : q + 1;
        q++;
      }
      return rhs;
    }
    if (isId(rhs, 'class') || isId(rhs, 'function') || isId(rhs, 'async')) { exportNext = 'default'; return rhs; }
    if (isId(rhs) && !isP(rhs + 1, '(') && !isP(rhs + 1, '.') && toks[rhs].v !== 'require') { addExport('default', toks[rhs].v); return rhs; }
    addExport('default', null);
    return rhs;
  }

  function handleExport(i0) {
    const nx = toks[i0 + 1];
    if (!nx) return i0 + 1;
    if (nx.t === 'id' && nx.v === 'default') {
      const a = toks[i0 + 2];
      if (a && a.t === 'id' && ['class', 'function', 'async', 'abstract', 'interface'].includes(a.v)) { exportNext = 'default'; return i0 + 2; }
      const b = toks[i0 + 3];
      if (a && a.t === 'id' && (!b || (b.t === 'p' && (b.v === ';' || b.v === '}')) || b.line > a.line)) { addExport('default', a.v); return i0 + 3; }
      addExport('default', null);
      return i0 + 2;
    }
    let j = i0 + 1;
    if (isId(j, 'type') && (isP(j + 1, '{') || isP(j + 1, '*'))) j++;
    if (isP(j, '{')) {
      const list = [];
      for (let k = j + 1; k < match[j];) {
        if (isId(k, 'type') && isId(k + 1) && !isId(k + 1, 'as')) k++;
        if ((isId(k) || toks[k].t === 'str')) {
          const local = toks[k].v;
          let as = local;
          k++;
          if (isId(k, 'as') && toks[k + 1]) { as = toks[k + 1].v; k += 2; }
          list.push({ local, as });
        } else k++;
      }
      let end = match[j] + 1;
      let source;
      if (isId(end, 'from') && toks[end + 1] && toks[end + 1].t === 'str') {
        source = toks[end + 1].v;
        end += 2;
        imports.push({ source, names: list.map(e => ({ imported: e.local, local: e.as })), kind: 'esm', line: toks[i0].line, reexport: true });
      }
      for (const e of list) addExport(e.as, e.local, source ? { source } : undefined);
      return end;
    }
    if (isP(j, '*')) {
      let k = j + 1;
      let as;
      if (isId(k, 'as') && isId(k + 1)) { as = toks[k + 1].v; k += 2; }
      if (isId(k, 'from') && toks[k + 1] && toks[k + 1].t === 'str') {
        const source = toks[k + 1].v;
        imports.push({ source, names: [], kind: 'esm', line: toks[i0].line, reexport: true });
        addExport(as || '*', as ? '*' : null, { source });
        return k + 2;
      }
      return i0 + 1;
    }
    if (isId(j, 'as') || isP(j, '=')) return i0 + 1;
    exportNext = 'named';
    return i0 + 1;
  }

  function handleImport(i0) {
    let j = i0 + 1;
    const line = toks[i0].line;
    if (isP(j, '.')) return i0 + 1;
    if (isP(j, '(')) {
      const lit = toks[j + 1] && toks[j + 1].t === 'str' && (isP(j + 2, ')') || isP(j + 2, ','));
      imports.push({ source: lit ? toks[j + 1].v : null, names: [], kind: 'dynamic', line });
      return j;
    }
    if (toks[j] && toks[j].t === 'str') { imports.push({ source: toks[j].v, names: [], kind: 'esm', line }); return j + 1; }
    if (isId(j, 'type') && (isId(j + 1) && !isId(j + 1, 'from') || isP(j + 1, '{') || isP(j + 1, '*'))) j++;
    const names = [];
    if (isId(j) && !(isId(j, 'from') && toks[j + 1] && toks[j + 1].t === 'str')) {
      if (isP(j + 1, '=') && isId(j + 2, 'require') && isP(j + 3, '(') && toks[j + 4] && toks[j + 4].t === 'str') { // TS: import x = require('y')
        imports.push({ source: toks[j + 4].v, names: [{ imported: '*', local: toks[j].v }], kind: 'require', line });
        return j + 6;
      }
      names.push({ imported: 'default', local: toks[j].v });
      j++;
      if (isP(j, ',')) j++;
    }
    if (isP(j, '*') && isId(j + 1, 'as') && isId(j + 2)) { names.push({ imported: '*', local: toks[j + 2].v }); j += 3; }
    if (isP(j, '{')) {
      for (let k = j + 1; k < match[j];) {
        if (isId(k, 'type') && (isId(k + 1) && !isId(k + 1, 'as') || (toks[k + 1] && toks[k + 1].t === 'str'))) k++;
        if (isId(k) || toks[k].t === 'str') {
          const imported = toks[k].v;
          let local = imported;
          k++;
          if (isId(k, 'as') && isId(k + 1)) { local = toks[k + 1].v; k += 2; }
          names.push({ imported, local });
        } else k++;
      }
      j = match[j] + 1;
    }
    if (isId(j, 'from') && toks[j + 1] && toks[j + 1].t === 'str') {
      imports.push({ source: toks[j + 1].v, names, kind: 'esm', line });
      j += 2;
      if ((isId(j, 'with') || isId(j, 'assert')) && isP(j + 1, '{')) j = match[j + 1] + 1;
      return j;
    }
    return i0 + 1;
  }
}

// ================================================================ facts cache

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const isStr = (v) => typeof v === 'string';
const isNum = (v) => Number.isInteger(v);

/** Cache files live in a user folder and are not trusted: a value that is not exactly the facts shape is a miss. */
export function validFacts(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
  if (f.unread !== undefined) return f.unread === 'parse_error' && isStr(f.detail);
  const arr = (a, ok) => Array.isArray(a) && a.every(x => x && typeof x === 'object' && ok(x));
  // every index must point into the arrays it indexes: a def's `up` is -1 or an EARLIER def, a call's `owner` is -1 or a def
  if (!Array.isArray(f.defs) || !Array.isArray(f.calls)) return false;
  const nDefs = f.defs.length;
  let at = 0;
  return arr(f.defs, d => isStr(d.name) && isStr(d.kind) && isNum(d.start) && isNum(d.end) && isNum(d.up) && d.up >= -1 && d.up < at++ && (d.parent === null || isStr(d.parent))
      && typeof d.exported === 'boolean' && (d.extends === undefined || isStr(d.extends) || (Array.isArray(d.extends) && d.extends.every(isStr)))
      && (d.implements === undefined || (Array.isArray(d.implements) && d.implements.every(isStr))))
    && arr(f.calls, c => isStr(c.name) && (c.receiver === null || isStr(c.receiver)) && isStr(c.kind) && isNum(c.line) && isNum(c.owner) && c.owner >= -1 && c.owner < nDefs)
    && arr(f.imports, m => (m.source === null || isStr(m.source)) && isStr(m.kind) && Array.isArray(m.names) && m.names.every(x => x && isStr(x.imported) && isStr(x.local)))
    && arr(f.exports, e => isStr(e.name) && (e.local === null || isStr(e.local)) && (e.source === undefined || isStr(e.source)));
}

/** The cache key of a file's content: extractor version, language class and bytes. */
export function cacheKey(ext, bytes) {
  return sha256(Buffer.concat([Buffer.from(`${EXTRACTOR_VERSION}\0${TS_EXT.has(ext) ? 'ts' : 'js'}\0`), bytes]));
}

// ================================================================ build

const posix = path.posix;
const toExt = (p) => path.extname(p).toLowerCase();

/** A name from git's own file list: top-relative POSIX already, so kept exactly (backslash and colon are ordinary
 * characters there). Only win32 gets the Windows rules. Returns null for a name that cannot be used (it is then
 * reported in not_read); throws KitExit 1 for one that escapes the repository. */
export function listedRel(p, platform = process.platform) {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) return null;
  if (platform === 'win32') { try { return normalizeRel(p); } catch { return null; } }
  const segs = p.split('/');
  if (p.startsWith('/') || segs.includes('..')) throw invalid(`file ${JSON.stringify(p).slice(0, 100)} is not a path inside the repository`); // git never lists this: refuse, as before
  if (segs.some(seg => seg === '' || seg === '.')) return null;
  return p;
}

/** A repo-relative POSIX path given by the user, or throws KitExit 1. */
export function normalizeRel(p, what = 'file') {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) throw invalid(`${what}: not a path`);
  const q = posix.normalize(p.replace(/\\/g, '/'));
  if (q === '.' || q === '..' || q.startsWith('../') || q.startsWith('/') || /^[A-Za-z]:/.test(q)) throw invalid(`${what} ${JSON.stringify(p).slice(0, 100)} is not a path inside the repository`);
  return q.replace(/\/$/, '');
}

async function listRepoFiles(root, { git, env } = {}) {
  const r = await safeGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { git, env });
  if (r.code !== 0) throw invalid(`cannot list the repository files: ${(r.stderr || r.stdout || 'git failed').trim().slice(0, 200)}`);
  return r.stdout.split('\0').filter(Boolean);
}

/**
 * Build the graph of `root` (an absolute repository top). Options: files (override the git file list), changed (files
 * to scan first), budgetMs, maxParses, maxFileBytes, maxFileMs, maxFiles, cacheDir (absolute; default
 * `<root>/.claude/kit/cache/graph`), cache (false: neither read nor write), clock (() => ms), onParse (path => void,
 * called before every scan), git/env (for the file list). Returns the graph described in the header.
 */
export async function buildGraph(root, opts = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw invalid('graph needs an absolute repository path');
  const o = { ...DEFAULTS, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) };
  for (const k of ['budgetMs', 'maxParses', 'maxFileBytes', 'maxFileMs', 'maxFiles']) {
    if (!Number.isSafeInteger(o[k]) || o[k] < 1) throw invalid(`${k} must be a positive whole number`);
  }
  const clock = o.clock || (() => performance.now());
  const started = clock();
  const stats = { candidates: 0, read: 0, parsed: 0, cache_hits: 0, cache_writes: 0, missing: 0, ignored: 0, over_file_cap: 0 };

  // ---- candidates: changed files first, then the rest in path order
  const changed = [...new Set((o.changed || []).map(f => normalizeRel(f, 'changed file')))];
  const notRead = [];
  let notReadTotal = 0;
  const addNotRead = (file, reason, detail) => {
    notReadTotal++;
    if (notRead.length < o.maxNotRead) notRead.push(detail ? { file, reason, detail } : { file, reason });
  };
  const listed = [];
  const fromGit = new Set(); // listed by git (not an injected list): a listed file that is not on disk was not read
  for (const f of (o.files ? o.files : await listRepoFiles(root, { git: o.git, env: o.env }))) {
    const rel = listedRel(f);
    if (rel === null) addNotRead(String(f).slice(0, 200), 'unsupported', 'this name cannot be used as a path inside the repository');
    else { listed.push(rel); if (!o.files) fromGit.add(rel); }
  }
  const all = new Set(listed);
  for (const c of changed) all.add(c);
  const candidates = [];
  const sourceSet = new Set();
  for (const f of [...all].sort()) {
    const ext = toExt(f);
    if (SUPPORTED_EXT.includes(ext)) sourceSet.add(f);
    else if (OTHER_CODE_EXT.has(ext)) { addNotRead(f, 'unsupported', `${ext} files are not read`); continue; } else { stats.ignored++; continue; }
    candidates.push(f);
  }
  const changedSet = new Set(changed);
  let ordered = [...changed.filter(f => sourceSet.has(f)), ...candidates.filter(f => !changedSet.has(f))];
  if (ordered.length > o.maxFiles) {
    stats.over_file_cap = ordered.length - o.maxFiles;
    for (const f of ordered.slice(o.maxFiles)) addNotRead(f, 'budget', 'more files than the file cap');
    ordered = ordered.slice(0, o.maxFiles);
  }
  stats.candidates = ordered.length;

  // ---- cache location
  const cacheDir = o.cacheDir ? path.resolve(o.cacheDir) : path.join(root, '.claude', 'kit', 'cache', 'graph');
  const guardRoot = o.cacheDir ? path.dirname(cacheDir) : root;
  let cacheOn = o.cache !== false;
  // the reason first, then the path (short, relative to the repo top), so the cap never cuts the reason off
  const shortReason = (e) => {
    let m = String(e.message || e).split(cacheDir).join(path.relative(root, cacheDir) || '.').split(root).join('.');
    m = m.replace(/\b([0-9a-f]{8})[0-9a-f]{56}\.json/g, '$1.json');
    const lead = /^(\S+) (.*)$/s.exec(m);
    if (lead && /[\\/]/.test(lead[1])) m = `${lead[2]} (${lead[1]})`;
    return m.slice(0, 200);
  };
  const cacheFail = (e) => { cacheOn = false; stats.cache_error = shortReason(e); };
  // is the cache FOLDER itself usable? (probe a name that is never there: only a folder-level refusal is not "missing")
  const folderRefused = async () => {
    try { await guardedRead(cacheFile('0'.repeat(64)), { root: guardRoot, protect: cacheDir, maxBytes: o.maxCacheBytes }); return null; }
    catch (e) { return e instanceof KitExit && e.code === 2 ? e : null; }
  };
  const cacheFile = (key) => path.join(cacheDir, `${key}.json`);
  const cacheGet = async (key) => {
    if (!cacheOn) return null;
    try {
      const f = JSON.parse(await guardedRead(cacheFile(key), { root: guardRoot, protect: cacheDir, maxBytes: o.maxCacheBytes }));
      return f && f.v === EXTRACTOR_VERSION && f.key === key && validFacts(f.facts) ? f.facts : null;
    } catch (e) {
      if (e instanceof KitExit && e.missing) return null;
      if (e instanceof KitExit && e.code === 2) { const fe = await folderRefused(); if (fe) cacheFail(fe); }
      return null; // unreadable, refused or corrupt entry: a miss for this file only (it is rewritten if it can be)
    }
  };
  let ignored = false;
  // the cache ignores itself wherever it lands: a `*` .gitignore in the cache folder's parent (written once per build)
  const ensureIgnore = async () => {
    if (ignored) return;
    const ig = path.join(path.dirname(cacheDir), '.gitignore');
    try { await guardedRead(ig, { root: guardRoot, maxBytes: 1024 }); } catch (e) {
      if (!(e instanceof KitExit && e.missing)) throw e;
      await guardedWrite(ig, '*\n', { root: guardRoot, maxBytes: 1024 });
    }
    ignored = true;
  };
  const cachePut = async (key, facts) => {
    if (!cacheOn) return;
    try {
      const text = JSON.stringify({ v: EXTRACTOR_VERSION, key, facts });
      if (Buffer.byteLength(text) > o.maxCacheBytes) return; // the read limit is the write limit: never write what would be refused
      await ensureIgnore();
      await guardedWrite(cacheFile(key), text, { root: guardRoot, protect: cacheDir, maxBytes: o.maxCacheBytes });
      stats.cache_writes++;
    } catch (e) {
      if (e instanceof KitExit && e.code === 2) { const fe = await folderRefused(); if (fe) cacheFail(fe); } // this entry only: no cache entry, cache stays on
      else cacheFail(e);
    }
  };

  // ---- scan
  const parsed = new Map(); // path → { facts, source }
  let cut = false;
  for (let idx = 0; idx < ordered.length; idx++) {
    const rel = ordered[idx];
    if (cut || clock() - started >= o.budgetMs) {
      cut = true;
      addNotRead(rel, 'budget');
      continue;
    }
    let bytes;
    try {
      bytes = await guardedRead(path.join(root, rel), { root, maxBytes: o.maxFileBytes, encoding: null });
    } catch (e) {
      if (!(e instanceof KitExit)) throw e;
      if (e.missing) {
        stats.missing++;
        // git lists it (sparse checkout, skip-worktree, deleted in the work tree) but it is not here: never read, so partial
        if (fromGit.has(rel)) addNotRead(rel, 'not_on_disk', 'listed by git but not in the working tree');
        continue;
      }
      if (e.code === 2 && /larger than|grew past/.test(e.message)) addNotRead(rel, 'too_large', `over ${o.maxFileBytes} bytes`);
      else addNotRead(rel, e.code === 2 ? 'unsupported' : 'parse_error', e.code === 2 ? 'refused: a link or special file' : 'unreadable');
      continue;
    }
    stats.read++;
    const ext = toExt(rel);
    const key = cacheKey(ext, bytes);
    let facts = await cacheGet(key);
    let source = 'cache';
    if (facts) stats.cache_hits++;
    else {
      if (stats.parsed >= o.maxParses) { addNotRead(rel, 'parse_cap', `more than ${o.maxParses} files to scan`); continue; }
      if (bytes.includes(0)) facts = { unread: 'parse_error', detail: 'binary file (NUL byte)' };
      else {
        stats.parsed++;
        o.onParse?.(rel);
        facts = extractFacts(bytes.toString('utf-8'), { path: rel, clock, maxMs: o.maxFileMs });
      }
      source = 'parsed';
      if (!facts.unread || facts.unread === 'parse_error') await cachePut(key, facts); // a time-limit result is not a property of the content
    }
    if (facts.unread) { addNotRead(rel, facts.unread, facts.detail); continue; }
    parsed.set(rel, { facts, source });
  }

  const resolved = resolveGraph(parsed, sourceSet, o);
  const files = [...parsed].map(([p, v]) => ({ path: p, source: v.source, defs: v.facts.defs.length, changed: changedSet.has(p) }));
  stats.elapsed_ms = Math.max(0, clock() - started);
  stats.unresolved_total = resolved.unresolvedTotal;
  stats.not_read_total = notReadTotal;
  return {
    files,
    defs: resolved.defs,
    edges: resolved.edges,
    unresolved: resolved.unresolved,
    partial: notReadTotal > 0 || resolved.truncated,
    not_read: notRead,
    stats
  };
}

// ================================================================ resolution

const RANK = { possible: 0, likely: 1, certain: 2 };
const MODULE_EXT = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'];
const JS_TO_TS = { '.js': ['.ts', '.tsx', '.mts'], '.mjs': ['.mts'], '.cjs': ['.cts'], '.jsx': ['.tsx'] };
const BUILTIN_RECEIVERS = new Set(['console', 'Math', 'JSON', 'Object', 'Array', 'Promise', 'Number', 'String', 'Boolean', 'Date', 'Reflect', 'Symbol',
  'process', 'Buffer', 'Error', 'Map', 'Set', 'RegExp', 'Intl', 'window', 'document', 'globalThis']);
const FN_KINDS = new Set(['function', 'arrow', 'var-fn', 'class']);

function resolveGraph(parsed, sourceSet, o) {
  const index = new Map();
  const defs = [];
  const methodsByName = new Map();
  for (const [file, { facts }] of parsed) {
    const nodes = facts.defs.map((d) => {
      const chain = [d.name];
      for (let u = d.up, guard = 0; u >= 0 && guard++ < 64; u = facts.defs[u].up) chain.unshift(facts.defs[u].name);
      const node = { id: `${file}::${chain.join('.')}@${d.start}`, file, name: d.name, qualified: chain.join('.'), kind: d.kind, start: d.start, end: d.end, parent: d.parent, exported: d.exported };
      if (d.extends !== undefined) node.extends = d.extends;
      if (d.implements !== undefined) node.implements = d.implements;
      return node;
    });
    const byName = new Map();
    const top = new Map();
    const members = new Map(); // class name → name → nodes
    nodes.forEach((n, k) => {
      const d = facts.defs[k];
      defs.push(n);
      if (!byName.has(n.name)) byName.set(n.name, []);
      byName.get(n.name).push({ node: n, up: d.up, idx: k });
      if (d.up < 0) { if (!top.has(n.name)) top.set(n.name, []); top.get(n.name).push(n); }
      if (n.kind === 'method') {
        if (!members.has(n.parent)) members.set(n.parent, new Map());
        const m = members.get(n.parent);
        if (!m.has(n.name)) m.set(n.name, []);
        m.get(n.name).push(n);
        if (!methodsByName.has(n.name)) methodsByName.set(n.name, []);
        methodsByName.get(n.name).push(n);
      }
    });
    const bindings = new Map();
    for (const im of facts.imports) {
      if (im.reexport || im.source === null) continue;
      for (const nm of im.names) {
        const kind = nm.imported === '*' ? 'ns' : 'named';
        bindings.set(nm.local, { kind, source: im.source, imported: nm.imported });
      }
    }
    index.set(file, { facts, nodes, byName, top, members, bindings });
  }

  const resolveModule = (from, spec) => {
    if (spec === null) return { blocked: 'external module' };
    if (!(spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..')) return { blocked: 'external module' };
    const base = posix.join(posix.dirname(from), spec);
    if (base.startsWith('../') || base === '..') return { blocked: 'unread target' };
    const tries = [base];
    const e = toExt(base);
    if (JS_TO_TS[e]) for (const t of JS_TO_TS[e]) tries.push(base.slice(0, -e.length) + t);
    for (const x of MODULE_EXT) tries.push(base + x);
    for (const x of MODULE_EXT) tries.push(`${base}/index${x}`);
    const hit = tries.find(t => sourceSet.has(t));
    if (!hit) return { blocked: 'unread target' };
    return index.has(hit) ? { file: hit } : { blocked: 'unread target' };
  };

  /** Definitions a file exports under `name`. { nodes, blocked } */
  const lookupExport = (file, name, depth = 0, seen = new Set()) => {
    const fi = index.get(file);
    const key = `${file}\0${name}`;
    if (!fi || depth > 6 || seen.has(key)) return { nodes: [], blocked: fi ? null : 'unread target' };
    seen.add(key);
    const nodes = [];
    let blocked = null;
    const merge = (r) => { nodes.push(...r.nodes); blocked = blocked || r.blocked; };
    for (const e of fi.facts.exports) {
      if (e.name === name && e.local && e.local !== '*') {
        if (e.source) {
          const m = resolveModule(file, e.source);
          if (m.file) merge(lookupExport(m.file, e.local, depth + 1, seen)); else blocked = blocked || m.blocked;
        } else if (fi.top.has(e.local)) nodes.push(...fi.top.get(e.local));
        else if (fi.bindings.has(e.local)) merge(viaBinding(file, fi.bindings.get(e.local), depth + 1, seen));
      } else if (e.name === '*' && e.source && name !== 'default') {
        const m = resolveModule(file, e.source);
        if (m.file) merge(lookupExport(m.file, name, depth + 1, seen)); else blocked = blocked || m.blocked;
      }
    }
    return { nodes: [...new Set(nodes)], blocked };
  };
  const viaBinding = (file, b, depth = 0, seen = new Set()) => {
    const m = resolveModule(file, b.source);
    if (!m.file) return { nodes: [], blocked: m.blocked };
    return lookupExport(m.file, b.kind === 'ns' ? 'default' : b.imported, depth, seen);
  };

  /** Type names (extends / implements) → { nodes, blocked } */
  const resolveTypeName = (file, dottedName) => {
    const fi = index.get(file);
    const [rootName, ...rest] = dottedName.split('.');
    if (!rest.length && fi.top.has(rootName)) return { nodes: fi.top.get(rootName), blocked: null };
    const b = fi.bindings.get(rootName);
    if (!b) return { nodes: [], blocked: null };
    if (!rest.length) return viaBinding(file, b);
    const m = resolveModule(file, b.source);
    if (!m.file) return { nodes: [], blocked: m.blocked };
    return lookupExport(m.file, rest[0]);
  };
  /** Methods named `name` on a class, then up its extends chain. { nodes, rank, blocked } */
  const methodsOf = (cls, name, depth = 0) => {
    const fi = index.get(cls.file);
    const own = fi.members.get(cls.name)?.get(name);
    if (own?.length) return { nodes: own, rank: own.length === 1 ? 'certain' : 'possible', blocked: null };
    if (depth > 8 || typeof cls.extends !== 'string') return { nodes: [], rank: 'likely', blocked: null };
    const base = resolveTypeName(cls.file, cls.extends);
    const found = [];
    let blocked = base.blocked;
    for (const b of base.nodes.filter(n => n.kind === 'class')) {
      const r = methodsOf(b, name, depth + 1);
      found.push(...r.nodes);
      blocked = blocked || r.blocked;
    }
    return { nodes: found, rank: 'likely', blocked };
  };

  const edgeMap = new Map();
  const addEdge = (from, to, kind, confidence) => {
    const k = `${from}\0${to}\0${kind}`;
    const old = edgeMap.get(k);
    if (!old || RANK[confidence] > RANK[old.confidence]) edgeMap.set(k, { from, to, kind, confidence });
  };
  const unresolved = [];
  let unresolvedTotal = 0;
  const addUnresolved = (from, call, reason) => {
    unresolvedTotal++;
    if (unresolved.length < o.maxUnresolved) unresolved.push({ from, call, reason });
  };
  const link = (from, nodes, kind, rank, call, blocked, miss = 'unknown export') => {
    if (!nodes.length) { addUnresolved(from, call, blocked || miss); return; }
    if (nodes.length > o.maxCandidates) { addUnresolved(from, call, 'ambiguous'); return; }
    const conf = nodes.length === 1 ? rank : 'possible';
    for (const n of nodes) addEdge(from, n.id, kind, conf);
  };

  for (const [file, fi] of index) {
    const moduleId = `${file}::<module>`;
    const fromOf = (owner) => (owner >= 0 ? fi.nodes[owner].id : moduleId);
    const classOf = (owner) => {
      for (let u = owner, guard = 0; u >= 0 && guard++ < 64; u = fi.facts.defs[u].up) if (fi.nodes[u].kind === 'class') return fi.nodes[u];
      return null;
    };
    for (let k = 0; k < fi.nodes.length; k++) {
      const n = fi.nodes[k];
      if (n.kind === 'class' && typeof n.extends === 'string') {
        const r = resolveTypeName(file, n.extends);
        link(n.id, r.nodes.filter(x => x.kind === 'class'), 'extends', 'certain', n.extends, r.blocked, missType(file, n.extends));
      }
      const bases = n.kind === 'class' ? n.implements : n.kind === 'interface' ? n.extends : undefined;
      for (const name of bases || []) {
        const r = resolveTypeName(file, name);
        link(n.id, r.nodes.filter(x => x.kind === 'interface'), n.kind === 'class' ? 'implements' : 'extends', 'certain', name, r.blocked, missType(file, name));
      }
    }
    for (const c of fi.facts.calls) {
      const from = fromOf(c.owner);
      const label = c.receiver ? `${c.receiver}.${c.name}` : c.name;
      if (c.kind === 'computed') { addUnresolved(from, label, 'computed'); continue; }
      if (c.kind === 'value') { addUnresolved(from, label, 'value call'); continue; }
      if (c.kind === 'direct') {
        const cands = (fi.byName.get(c.name) || []).filter(x => FN_KINDS.has(x.node.kind) && (x.up < 0 || isAncestor(fi.facts.defs, c.owner, x.up)));
        if (cands.length) {
          const depthOf = (x) => (x.up < 0 ? -1 : x.up);
          const deepest = Math.max(...cands.map(depthOf));
          const best = cands.filter(x => depthOf(x) === deepest);
          const nodes = best.map(x => x.node);
          for (const nd of nodes) addEdge(from, nd.id, 'call', nodes.length === 1 ? 'certain' : 'possible');
          continue;
        }
        const b = fi.bindings.get(c.name);
        if (b) {
          const r = viaBinding(file, b);
          link(from, r.nodes, 'call', b.kind === 'ns' ? 'likely' : 'certain', label, r.blocked);
          continue;
        }
        addUnresolved(from, label, 'value call');
        continue;
      }
      // member call
      const recv = c.receiver;
      if (recv === 'this' || recv === 'super') {
        const cls = classOf(c.owner);
        if (cls) {
          const r = recv === 'super' ? superMethods(cls, c.name) : methodsOf(cls, c.name);
          if (r.nodes.length) { link(from, r.nodes, 'call', r.rank, label, r.blocked); continue; }
          if (r.blocked) { addUnresolved(from, label, r.blocked); continue; }
        }
      } else if (recv) {
        const b = fi.bindings.get(recv);
        if (b) {
          const m = resolveModule(file, b.source);
          if (!m.file) { addUnresolved(from, label, m.blocked); continue; }
          if (b.kind === 'ns') {
            const direct = lookupExport(m.file, c.name);
            if (direct.nodes.length) { link(from, direct.nodes, 'call', 'certain', label, null); continue; }
          }
          const exp = lookupExport(m.file, b.kind === 'ns' ? 'default' : b.imported);
          const found = [];
          let rank = 'likely';
          for (const cl of exp.nodes.filter(x => x.kind === 'class')) {
            const r = methodsOf(cl, c.name);
            found.push(...r.nodes);
            if (b.kind === 'named') rank = r.rank;
          }
          if (found.length) { link(from, found, 'call', rank, label, null); continue; }
          if (exp.blocked) { addUnresolved(from, label, exp.blocked); continue; }
        } else {
          const cls = fi.top.get(recv)?.filter(x => x.kind === 'class');
          if (cls?.length === 1) {
            const r = methodsOf(cls[0], c.name);
            if (r.nodes.length) { link(from, r.nodes, 'call', r.rank, label, r.blocked); continue; }
          } else if (BUILTIN_RECEIVERS.has(recv) && !fi.top.has(recv)) { addUnresolved(from, label, 'external module'); continue; }
        }
      }
      // receiver of unknown type: any method of that name, never better than possible
      const cands = methodsByName.get(c.name) || [];
      if (!cands.length) addUnresolved(from, label, 'dynamic member');
      else if (cands.length > o.maxCandidates) addUnresolved(from, label, 'ambiguous');
      else for (const nd of cands) addEdge(from, nd.id, 'call', 'possible');
    }
  }
  // a base type that is neither defined nor imported is outside the repository (a global); an import that finds nothing is an unknown export
  function missType(file, dottedName) {
    return index.get(file).bindings.has(dottedName.split('.')[0]) ? 'unknown export' : 'external module';
  }
  function superMethods(cls, name) {
    const base = resolveTypeName(cls.file, cls.extends);
    const found = [];
    let blocked = base.blocked;
    for (const b of base.nodes.filter(n => n.kind === 'class')) {
      const r = methodsOf(b, name);
      found.push(...r.nodes);
      blocked = blocked || r.blocked;
    }
    return { nodes: found, rank: 'likely', blocked };
  }
  return { defs, edges: [...edgeMap.values()], unresolved, unresolvedTotal, truncated: unresolvedTotal > unresolved.length };
}

/** Is definition `anc` the owner definition or one of its enclosing definitions? */
function isAncestor(defs, owner, anc) {
  for (let u = owner, guard = 0; u >= 0 && guard++ < 64; u = defs[u].up) if (u === anc) return true;
  return false;
}

// ================================================================ CLI

/**
 * Paths a unified diff touches, top-relative, through the lens catalog's parser (lenses.parseDiff): hunks are counted,
 * so an added line that starts with `++ ` is content, not a header; git's prefixes (a/ b/, mnemonic c/ i/ w/ o/,
 * --no-prefix) are read from the `diff --git` header rather than guessed from the file system; quoted names are
 * unquoted. Deleted files (new side /dev/null) are left out.
 */
export function diffPaths(text) {
  return parseDiff(text, { deleted: true }).filter((f) => !f.deleted).map((f) => f.path).filter((p) => p && p !== '/dev/null');
}

const VALUE_FLAGS = ['dir', 'diff', 'budget-ms', 'max-parses'];

export function parseArgs(args) {
  const f = { changed: [], json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') { f.help = true; continue; }
    if (a === '--json') { f.json = true; continue; }
    if (a === '--changed') {
      let k = i + 1;
      while (k < args.length && !args[k].startsWith('--')) f.changed.push(args[k++]);
      if (k === i + 1) throw invalid('--changed needs at least one file (see --help)');
      i = k - 1;
      continue;
    }
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (name && VALUE_FLAGS.includes(name)) {
      if (i + 1 >= args.length) throw invalid(`--${name} needs a value (see --help)`);
      f[name] = args[++i];
      continue;
    }
    throw invalid(`${name ? 'unknown flag' : 'unexpected argument'} ${a} (see --help)`);
  }
  for (const k of ['budget-ms', 'max-parses']) {
    if (f[k] !== undefined && !/^[1-9][0-9]{0,9}$/.test(f[k])) throw invalid(`--${k} needs a positive whole number (see --help)`);
  }
  return f;
}

const countBy = (rows, key) => rows.reduce((m, r) => { m[r[key]] = (m[r[key]] || 0) + 1; return m; }, {});

export async function run(args, io = {}) {
  const f = parseArgs(args);
  if (f.help) return { usage };
  const cwd = io.cwd || process.cwd();
  const dir = path.resolve(cwd, f.dir || '.');
  let diffText = '';
  if (f.diff !== undefined) {
    if (f.diff === '-') {
      if (io.stdinIsTTY) throw invalid('--diff - needs piped stdin, not a terminal (see --help)');
      diffText = await io.stdin();
    } else {
      const file = path.resolve(cwd, f.diff);
      const st = await fs.stat(file).catch((e) => { throw invalid(`cannot read ${f.diff}: ${e.code || e.message}`); });
      if (!st.isFile()) throw invalid(`${f.diff} is not a regular file`);
      if (st.size > DEFAULTS.maxDiffBytes) throw refuse(`${f.diff} is larger than ${DEFAULTS.maxDiffBytes} bytes`);
      diffText = await fs.readFile(file, 'utf-8');
    }
    if (diffText.length > DEFAULTS.maxDiffBytes) throw refuse(`the diff is larger than ${DEFAULTS.maxDiffBytes} bytes`);
    if (!/^(\+\+\+ |--- |diff --git )/m.test(diffText) && diffText.trim() !== '') throw invalid('that is not a unified diff');
  }
  const loc = await locateRepo(dir);
  if (!loc.top) throw invalid(`${dir} has no work tree (a bare repository or a path inside .git)`);
  const exec = (a) => safeGit(loc.top, a, { git: io.git, env: io.env || process.env });
  const [top] = await gitPaths(exec, loc.top, ['toplevel'], 'cannot find the repository');
  const changed = [...f.changed];
  changed.push(...diffPaths(diffText));
  const g = await buildGraph(top, {
    changed,
    budgetMs: f['budget-ms'] ? Number(f['budget-ms']) : undefined,
    maxParses: f['max-parses'] ? Number(f['max-parses']) : undefined,
    git: io.git, env: io.env, clock: io.clock, onParse: io.onParse, cacheDir: io.cacheDir
  });
  if (f.json) return { root: top, ...g };
  return {
    root: top,
    partial: g.partial,
    counts: { files: g.files.length, defs: g.defs.length, edges: g.edges.length, unresolved: g.stats.unresolved_total, not_read: g.stats.not_read_total },
    edges_by_confidence: countBy(g.edges, 'confidence'),
    unresolved_by_reason: countBy(g.unresolved, 'reason'),
    changed: (() => {
      const src = new Set(), other = new Set();
      for (const c of changed) (SUPPORTED_EXT.includes(toExt(c)) ? src : other).add(normalizeRel(c, 'changed file'));
      // requested = changed JS/TS files (the only ones the graph can read); the rest are counted, not hidden
      const out = { requested: src.size, read: g.files.filter(x => x.changed).length };
      if (other.size) Object.assign(out, { not_source: other.size, note: 'requested counts changed JS/TS files; not_source counts changed files of other types, which the graph never reads' });
      return out;
    })(),
    not_read: g.not_read,
    stats: g.stats
  };
}
