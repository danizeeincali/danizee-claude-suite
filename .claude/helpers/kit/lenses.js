/**
 * lenses — a catalog of review rules kept as plain markdown files. Adding a rule means adding a file.
 *
 *   lenses --diff <file|-> [--cap N] [--covered name,name] [--dir <extra lens dir>]
 *
 * A lens file is `---` frontmatter, then a markdown body (the instruction for the reviewer):
 *
 *   ---
 *   name: missing-await          required; lowercase letters, digits and dashes
 *   globs: [src/**\/*.js, "*.ts"]  required; a list of file globs  (or one `- item` per line)
 *   match: \bfetch\(              required; a regex source, run case-insensitively over the changed lines
 *   covered_by: [no-floating-promises]   optional; checks that already cover the same rule
 *   ---
 *
 * Frontmatter that is supported, exactly: blank lines, `# comment` lines, `key: value` (a scalar, optionally wrapped in
 * matching "double" or 'single' quotes, nothing inside is unescaped), `key: [a, b]` (an inline list; commas inside
 * {braces} or quotes do not split), and `key:` followed by `- item` lines. The keys are the four above; an unknown or
 * repeated key, a list where a scalar belongs (or the reverse), nested structure, YAML anchors or block scalars are
 * refused with the file and line. A bad glob (unbalanced brace) or a bad regex is refused too.
 *
 * Input must be a unified diff with at least one changed file: an empty input, or text that is not a diff, exits 1
 * (it is wrong input, not "no lens applies"); `--diff -` with stdin on a terminal is refused. Produce it with
 * `git diff --no-prefix`; the parser also copes with a/ b/ and the mnemonic i/ w/ c/ o/ prefixes.
 *
 * Globs: `*` (not across `/`), `**` (across `/`; `**\/` also matches no directory), `?` (one non-`/` character),
 * `{a,b}` alternatives (nestable), `\x` for a literal. A glob with no `/` matches the base name at any depth.
 *
 * A lens fires only when a changed file matches its globs AND its regex hits an added or removed line of that file.
 * At most `--cap` (default 4) lenses are handed over, in name order; the rest are named in `capped`. A lens whose
 * `covered_by` names a check passed in `--covered` stands down and does not use up the cap.
 * Lens dirs, later wins on a duplicate name: the built-in lenses/ next to this file, the project's
 * <repo>/.claude/kit/lenses/, then each --dir. Built from our own ideas (run 2026-10-10-openqodex-2); no foreign code.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { KitExit } from './kit-exit.js';
import { defaultGit } from './push-gate.js';
import { revParseArgs, resolveRevParse } from './git-paths.js';

export const verb = 'lenses';
export const usage = 'cli.js lenses --diff <file|-> [--cap N] [--covered name,name] [--dir <lens dir>]';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BUILTIN_DIR = path.join(HERE, 'lenses');
export const DEFAULT_CAP = 4;

const LIST_KEYS = new Set(['globs', 'covered_by']);
const SCALAR_KEYS = new Set(['name', 'match']);
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const fail = (msg) => new KitExit(msg, 1);

// ---------------------------------------------------------------- globs

/** A glob → an anchored RegExp. Throws KitExit 1 on an unbalanced brace. */
export function globToRegExp(glob) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '\\' && i + 1 < glob.length) out += glob[++i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    else if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '{') { depth++; out += '(?:'; }
    else if (c === '}') {
      if (depth === 0) throw fail(`glob "${glob}": unbalanced brace`);
      depth--; out += ')';
    } else if (c === ',' && depth > 0) out += '|';
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  if (depth !== 0) throw fail(`glob "${glob}": unbalanced brace`);
  const anchored = glob.includes('/') ? '' : '(?:.*/)?';
  return new RegExp(`^${anchored}${out}$`);
}

const globCache = new Map();
export function globMatch(glob, filePath) {
  let re = globCache.get(glob);
  if (!re) { re = globToRegExp(glob); globCache.set(glob, re); }
  return re.test(filePath);
}

// ---------------------------------------------------------------- frontmatter and lens files

function unquote(s) {
  return s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0] ? s.slice(1, -1) : s;
}

/** Split an inline list body on commas that are outside {braces} and quotes. */
function splitInline(body, where) {
  const items = [];
  let cur = '', depth = 0, quote = null;
  for (const c of body) {
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if ((c === '"' || c === "'") && cur.trim() === '') { quote = c; cur += c; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth <= 0) { items.push(cur); cur = ''; continue; }
    cur += c;
  }
  items.push(cur);
  const out = items.map(s => unquote(s.trim()));
  if (out.some(s => s === '')) throw fail(`${where}: empty list item`);
  return out;
}

/**
 * Parse frontmatter text (the lines between the `---` fences). `firstLine` is the file line number of its first line,
 * so errors name file:line. Returns a plain object of the keys present.
 */
export function parseFrontmatter(text, file, firstLine = 2) {
  const out = {};
  let openList = null; // key waiting for `- item` lines
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  lines.forEach((raw, idx) => {
    const where = `${file}:${firstLine + idx}`;
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) return;
    const dash = /^\s+-\s+(.*)$/.exec(line);
    if (dash) {
      if (!openList) throw fail(`${where}: a "- item" line with no list key above it`);
      const v = unquote(dash[1].trim());
      if (v === '') throw fail(`${where}: empty list item`);
      out[openList].push(v);
      return;
    }
    const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!kv) throw fail(`${where}: cannot read this line (supported: "key: value", "key: [a, b]", "key:" then "- item" lines): ${line.trim().slice(0, 60)}`);
    const [, key, rest = ''] = kv;
    if (!LIST_KEYS.has(key) && !SCALAR_KEYS.has(key)) throw fail(`${where}: unknown key "${key}" (allowed: name, globs, match, covered_by)`);
    if (Object.hasOwn(out, key)) throw fail(`${where}: duplicate key "${key}"`);
    openList = null;
    const value = rest.trim();
    if (LIST_KEYS.has(key)) {
      if (value === '') { out[key] = []; openList = key; return; }
      if (!(value.startsWith('[') && value.endsWith(']'))) throw fail(`${where}: "${key}" must be a list: "[a, b]" or "- item" lines`);
      const inner = value.slice(1, -1).trim();
      out[key] = inner === '' ? [] : splitInline(inner, where);
      return;
    }
    if (value === '') throw fail(`${where}: "${key}" has no value`);
    if (key !== 'match' && /^[|>&*!%@`[{]/.test(value)) throw fail(`${where}: "${key}" must be a plain value (no YAML anchors, block scalars or nesting)`);
    out[key] = unquote(value);
  });
  return out;
}

/** A whole lens file → `{ name, globs, match, re, covered_by, body, source }`. Throws KitExit 1 naming the file. */
export function parseLens(text, file) {
  const lines = text.replace(/^﻿/, '').split('\n');
  if (lines[0].replace(/\r$/, '') !== '---') throw fail(`${file}: a lens file must start with a "---" frontmatter line`);
  const end = lines.findIndex((l, i) => i > 0 && l.replace(/\r$/, '') === '---');
  if (end < 0) throw fail(`${file}: the frontmatter has no closing "---" line`);
  const fm = parseFrontmatter(lines.slice(1, end).join('\n'), file, 2);
  for (const key of ['name', 'globs', 'match']) if (fm[key] === undefined) throw fail(`${file}: missing required field "${key}"`);
  if (!NAME_RE.test(fm.name)) throw fail(`${file}: "name" must be lowercase letters, digits and dashes (got "${fm.name}")`);
  if (fm.globs.length === 0) throw fail(`${file}: "globs" needs at least one glob`);
  for (const g of fm.globs) {
    try { globToRegExp(g); } catch (e) { throw fail(`${file}: ${e.message}`); }
  }
  let re;
  try { re = new RegExp(fm.match, 'i'); } catch (e) { throw fail(`${file}: "match" is not a valid regex: ${e.message}`); }
  const body = lines.slice(end + 1).join('\n').trim();
  if (!body) throw fail(`${file}: the lens has an empty body (the reviewer instruction)`);
  return { name: fm.name, globs: fm.globs, match: fm.match, re, covered_by: fm.covered_by || [], body, source: file };
}

/**
 * Load every `*.md` in each dir. A later dir wins a duplicate name; two files with one name in the same dir are
 * refused. Returns the lenses sorted by name. A missing dir or any bad file fails the whole load.
 */
export async function loadLenses(dirs) {
  const byName = new Map();
  for (const dir of dirs) {
    let names;
    try { names = (await fs.readdir(dir)).filter(f => f.endsWith('.md')).sort(); }
    catch (e) { throw fail(`cannot read lens dir ${dir}: ${e.message}`); }
    const seen = new Map();
    for (const f of names) {
      const file = path.join(dir, f);
      let text;
      try { text = await fs.readFile(file, 'utf-8'); } catch (e) { throw fail(`cannot read ${file}: ${e.message}`); }
      const lens = parseLens(text, file);
      if (seen.has(lens.name)) throw fail(`duplicate lens name "${lens.name}" in ${seen.get(lens.name)} and ${file}`);
      seen.set(lens.name, file);
      byName.set(lens.name, lens);
    }
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------- diffs

// Prefixes git puts before paths: a/ b/ by default; c/ i/ w/ o/ with diff.mnemonicPrefix; none with --no-prefix.
const LOOSE_PREFIX = /^[abciwo]\//;
const GIT_PREFIX = /^[a-z]\//;

/**
 * git's C-style quoting (core.quotePath, the default, quotes names with non-ASCII bytes or specials): "caf\303\251.js"
 * → café.js. Octal escapes are bytes of UTF-8; \t \n \" \\ and friends are single characters.
 */
export function unquoteCPath(s) {
  if (!(s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"')) return s;
  const bytes = [];
  const body = s.slice(1, -1);
  const SIMPLE = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf-8')); continue; }
    const n = body[i + 1];
    if (/[0-7]/.test(n || '') && /^[0-7]{3}$/.test(body.slice(i + 1, i + 4))) { bytes.push(parseInt(body.slice(i + 1, i + 4), 8)); i += 3; continue; }
    if (n !== undefined && Object.hasOwn(SIMPLE, n)) { bytes.push(SIMPLE[n]); i++; continue; }
    bytes.push(92);
  }
  return Buffer.from(bytes).toString('utf-8');
}

function cleanPath(raw, mode = 'loose') {
  let p = raw.split('\t')[0].trim();
  p = unquoteCPath(p);
  if (p === '/dev/null' || mode === 'none') return p;
  return p.replace(mode === 'git' ? GIT_PREFIX : LOOSE_PREFIX, '');
}

const unquoteGit = unquoteCPath;

/**
 * The path in a `diff --git` header and how it is prefixed. `--no-prefix` repeats the bare path (`x y` → both halves
 * equal); otherwise each side carries one one-char prefix (`a/ b/`, or `i/ w/`, `c/ w/`, `c/ o/` with
 * diff.mnemonicPrefix). Returns `{ path, mode }`, mode being 'none', 'git' or 'loose' (could not tell).
 */
function parseGitHeader(rest) {
  if (rest.length % 2 === 1) {
    const h = (rest.length - 1) / 2;
    if (rest[h] === ' ' && rest.slice(0, h) === rest.slice(h + 1)) return { path: unquoteGit(rest.slice(0, h)), mode: 'none' };
  }
  const m = /^"?([a-z])\/(.+?)"? "?([a-z])\/(.+?)"?$/.exec(rest);
  // Two different one-letter prefixes (a/ b/, c/ w/): git put them there. The same letter on both sides can only be an
  // unprefixed rename between directories (c/x.js → c/y.js); the rename lines name the real paths.
  if (m && m[1] !== m[3]) return { path: m[4], mode: 'git' };
  if (m) return { path: `${m[3]}/${m[4]}`, mode: 'none' };
  return { path: rest, mode: 'loose' };
}

/**
 * A unified diff → `[{ path, added: [...], removed: [...] }]` in file order. Lines are without the +/- marker.
 * `{ deleted: true }` adds `deleted` (the new side is /dev/null) to each entry. `{ lines: true }` adds `deleted`, `oldPath`
 * and, aligned with `added` / `removed`, `addedAt` (new-side line numbers), `removedAt` (old-side line numbers) and
 * `removedNewAt` (for each removed line, the new-side line the removal sits just before).
 */
export function parseDiff(text, { deleted = false, lines = false } = {}) {
  const files = [];
  let cur = null;
  let hunk = null;
  for (const line of String(text || '').split('\n')) {
    if (hunk && (hunk.old > 0 || hunk.new > 0)) {
      const c = line[0];
      if (c === '+') { cur.added.push(line.slice(1)); cur.addedAt.push(hunk.newNo++); hunk.new--; continue; }
      if (c === '-') { cur.removed.push(line.slice(1)); cur.removedAt.push(hunk.oldNo++); cur.removedNewAt.push(hunk.newNo); hunk.old--; continue; }
      if (c === ' ' || line === '') { hunk.old--; hunk.new--; hunk.oldNo++; hunk.newNo++; continue; }
      if (c === '\\') continue;
      hunk = null; // malformed counts: treat this line as a header
    }
    if (line.startsWith('\\')) continue;
    if (line.startsWith('diff --git ')) {
      const g = parseGitHeader(line.slice('diff --git '.length).replace(/\r$/, ''));
      cur = { path: g.path, mode: g.mode, added: [], removed: [], addedAt: [], removedAt: [], removedNewAt: [], fromGit: true, sawOld: false };
      files.push(cur);
      continue;
    }
    const rn = /^(rename|copy) (from|to) (.*)$/.exec(line);
    if (rn && cur && cur.fromGit && !cur.sawOld) {
      // git never prefixes these paths, whatever the prefix settings are.
      const p = cleanPath(rn[3].replace(/\r$/, ''), 'none');
      if (rn[2] === 'from') cur.oldPath = p; else { cur.path = p; cur.renamed = true; }
      continue;
    }
    if (line.startsWith('--- ')) {
      const mode = cur && cur.fromGit ? cur.mode : 'loose';
      const p = cleanPath(line.slice(4), mode);
      if (cur && cur.fromGit && !cur.sawOld && cur.added.length + cur.removed.length === 0) { cur.sawOld = true; if (!cur.renamed) cur.oldPath = p; }
      else { cur = { path: p, oldPath: p, mode: 'loose', added: [], removed: [], addedAt: [], removedAt: [], removedNewAt: [], sawOld: true }; files.push(cur); }
      continue;
    }
    if (line.startsWith('+++ ') && cur && cur.renamed) continue;
    if (line.startsWith('+++ ') && cur) {
      const p = cleanPath(line.slice(4), cur.mode);
      if (p === '/dev/null') cur.deleted = true;
      cur.path = p === '/dev/null' ? (cur.oldPath && cur.oldPath !== '/dev/null' ? cur.oldPath : cur.path) : p;
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && cur) hunk = { old: h[2] === undefined ? 1 : +h[2], new: h[4] === undefined ? 1 : +h[4], oldNo: +h[1], newNo: +h[3] };
  }
  if (lines) return files.map(f => ({ path: f.path, oldPath: f.oldPath || f.path, added: f.added, removed: f.removed, addedAt: f.addedAt, removedAt: f.removedAt, removedNewAt: f.removedNewAt, deleted: !!f.deleted }));
  return files.map(f => (deleted ? { path: f.path, added: f.added, removed: f.removed, deleted: !!f.deleted } : { path: f.path, added: f.added, removed: f.removed }));
}

// ---------------------------------------------------------------- selection

/**
 * Which lenses to hand the reviewer. `diff` is parseDiff's output. Returns `{ fired, capped, stood_down }`:
 * fired entries are `{ name, files, body, source }`, capped and stood_down are lens names. Name order throughout.
 */
export function selectLenses(lenses, diff, { cap = DEFAULT_CAP, covered = [] } = {}) {
  if (!Number.isInteger(cap) || cap < 0) throw fail(`cap must be a whole number, 0 or more (got ${cap})`);
  const have = new Set(covered);
  const candidates = [];
  const stood_down = [];
  for (const lens of [...lenses].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const files = diff
      .filter(f => lens.globs.some(g => globMatch(g, f.path)))
      .filter(f => [...f.added, ...f.removed].some(l => { lens.re.lastIndex = 0; return lens.re.test(l); }))
      .map(f => f.path);
    if (files.length === 0) continue;
    if ((lens.covered_by || []).some(c => have.has(c))) { stood_down.push(lens.name); continue; }
    candidates.push({ name: lens.name, files, body: lens.body, source: lens.source });
  }
  return { fired: candidates.slice(0, cap), capped: candidates.slice(cap).map(c => c.name), stood_down };
}

// ---------------------------------------------------------------- CLI

function parseArgs(args) {
  const o = { dirs: [], covered: [], cap: DEFAULT_CAP, diff: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!['--diff', '--cap', '--covered', '--dir'].includes(a)) throw fail(`unknown argument ${a} — usage: ${usage}`);
    const v = args[++i];
    if (v === undefined || (v.startsWith('--') && v.length > 2)) throw fail(`${a} needs a value`);
    if (a === '--diff') o.diff = v;
    else if (a === '--dir') o.dirs.push(v);
    else if (a === '--covered') o.covered.push(...v.split(',').map(s => s.trim()).filter(Boolean));
    else {
      if (!/^\d+$/.test(v)) throw fail(`--cap must be a whole number (got "${v}")`);
      o.cap = Number(v);
    }
  }
  if (o.diff === null) throw fail(`--diff <file|-> is required — usage: ${usage}`);
  return o;
}

/** The project lens dir, from the repository root (never the cwd); null outside a repository. */
async function projectLensDir(io) {
  const git = io.git || defaultGit(io.cwd);
  const queries = ['toplevel'];
  const r = await git(revParseArgs(queries));
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout || '').trim();
    if (/not a git repository/i.test(msg)) return null;
    throw fail(`cannot find the repository root: ${msg || 'git failed'}`);
  }
  const [top] = resolveRevParse(io.cwd, queries, r.stdout);
  return path.join(top, '.claude', 'kit', 'lenses');
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

export async function run(args, io) {
  const o = parseArgs(args);
  let text;
  if (o.diff === '-') {
    if (io.stdinIsTTY) throw fail('--diff - reads the diff from stdin, but stdin is a terminal: pipe a diff in (git diff ... | cli.js lenses --diff -) or pass a file');
    text = await io.stdin();
  }
  else {
    const file = path.resolve(io.cwd, o.diff);
    try { text = await fs.readFile(file, 'utf-8'); } catch (e) { throw fail(`cannot read the diff ${file}: ${e.message}`); }
  }
  const dirs = [BUILTIN_DIR];
  const project = await projectLensDir(io);
  if (project && await exists(project)) dirs.push(project);
  for (const d of o.dirs) dirs.push(path.resolve(io.cwd, d));
  const lenses = await loadLenses(dirs);
  const diff = parseDiff(text);
  if (diff.length === 0) {
    const what = o.diff === '-' ? 'on stdin' : `in ${o.diff}`;
    throw fail(String(text || '').trim() === ''
      ? `no diff was given ${what} (it is empty): check the range being reviewed — an empty input is not "no lens applies"`
      : `the input ${what} is not a unified diff (no changed files found): check what was piped in`);
  }
  const { fired, capped, stood_down } = selectLenses(lenses, diff, { cap: o.cap, covered: o.covered });
  return { loaded: lenses.length, changed_files: diff.length, cap: o.cap, fired, capped, stood_down };
}
