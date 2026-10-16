/**
 * test-map — the test map {"targets":[{id, files}]} for the working directory, built mechanically: each test file under
 * test/ and test/reach/ (`*.test.js`) with the local files it imports (relative specifiers) or starts by path string.
 * Used by `test-plan --scan` (so a workflow in any installed project gets the map from the kit) and by scripts/ci-step.js.
 * Reads only files under cwd; no network, no model.
 */
import fs from 'node:fs';
import path from 'node:path';

const posix = (p) => p.split(path.sep).join('/');

/**
 * Repo files a test reaches by path string rather than by import: the string literals it passes to spawn, spawnSync,
 * execFile(Sync), fork, path.join, path.resolve, join, resolve or a dynamic import(), alone or joined in order
 * ('scripts', 'ci-step.js' is scripts/ci-step.js). Only a literal that resolves to an existing file inside cwd counts.
 */
export function spawnedPaths(text, cwd = process.cwd()) {
  const found = new Set();
  const isRepoFile = (rel) => {
    if (!rel || path.isAbsolute(rel) || rel.split('/').includes('node_modules')) return false;
    const abs = path.resolve(cwd, rel);
    const back = path.relative(cwd, abs);
    if (!back || back.startsWith('..') || path.isAbsolute(back)) return false;
    try { return fs.statSync(abs).isFile(); } catch { return false; }
  };
  for (const m of text.matchAll(/\b(?:spawn|spawnSync|execFile|execFileSync|fork|path\.join|path\.resolve|join|resolve|import)\s*\(/g)) {
    // The argument list: from the opening parenthesis to its matching close (string contents skipped), capped.
    const start = m.index + m[0].length;
    let depth = 1, i = start, quote = null;
    for (; i < text.length && i < start + 600 && depth > 0; i++) {
      const c = text[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; } else if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    const lits = [...text.slice(start, i).matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((x) => x[1] ?? x[2]).filter((x) => x && !x.includes('${'));
    for (let a = 0; a < lits.length; a++) {
      for (let b = a; b < lits.length; b++) {
        const rel = posix(path.normalize(path.join(...lits.slice(a, b + 1))));
        if (isRepoFile(rel)) found.add(rel);
      }
    }
  }
  return [...found].sort();
}

/** Local files each test file imports (relative specifiers) or starts by path string (see spawnedPaths), as repo-relative paths. */
export function testTargets(cwd = process.cwd()) {
  const out = [];
  for (const sub of ['test', 'test/reach']) {
    const dir = path.join(cwd, sub);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort() : [];
    for (const f of files) {
      const id = `${sub}/${f}`;
      const text = fs.readFileSync(path.join(dir, f), 'utf-8');
      const deps = new Set([id]);
      for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
        deps.add(posix(path.relative(cwd, path.resolve(dir, m[1]))));
      }
      for (const dep of spawnedPaths(text, cwd)) deps.add(dep);
      out.push({ id, files: [...deps] });
    }
  }
  return out;
}
