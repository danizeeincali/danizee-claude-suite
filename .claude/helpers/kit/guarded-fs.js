/**
 * guarded-fs — write, read and delete files in a user's own folders without a swapped link moving the operation
 * outside the area that was meant.
 *
 *   guarded-write --root <dir> --file <path> [--protect <dir>]      content on stdin; prints { written, path, bytes }
 *
 * Comparing path strings is not enough: a symlink, a case or Unicode spelling difference, or a folder swapped for a link
 * between the check and the write can all move a write elsewhere. So:
 *
 *   WALK. resolveGuarded() starts at `root` (absolute; its real path is the base) and takes the target one name at a
 *   time with lstat, never letting the system follow a link on its own. Every folder is recorded by device+inode (the
 *   chain), not by its spelling. A name that is a symlink INSIDE `protect` (default: root; the protected folder itself
 *   counts) is refused (KitExit 2). A symlink elsewhere under root is followed on purpose (dotfile managers link ~/.claude
 *   somewhere) — but only when its real target is still under root and not inside the protected tree. `..` anywhere in
 *   the target, a target outside root, an unreadable or non-folder step, more than 64 steps: refused / invalid.
 *   "Inside protect" is decided by real path AND by device+inode of the protected folder, so a case-insensitive or
 *   Unicode-equivalent spelling of it is still caught once it exists.
 *   WRITE. guardedWrite() opens the verified parent folder (O_DIRECTORY|O_NOFOLLOW) and compares the handle's
 *   device+inode with the chain (a folder swapped for a link after the walk is refused). On Linux the file operations
 *   then go through /proc/self/fd/<handle>/, i.e. relative to that open folder; elsewhere through the verified path.
 *   The temp file is created O_EXCL|O_NOFOLLOW (mode 0600), written, fsynced, renamed over the name. Node has no
 *   renameat, so afterwards the final path must hold the same device+inode as the temp file's handle and the walk must
 *   give the same chain; if not, what we wrote is removed and the call fails (KitExit 2). The temp file never remains
 *   after a failure. A final name that is a link is replaced (rename never follows it), not written through.
 *   READ. guardedRead() opens the file O_NOFOLLOW (a final link is refused) with a size cap, then repeats the walk and
 *   compares the file's identity again, so a link swapped in during the read is caught.
 *   DELETE. guardedDelete() unlinks the name (a final link is removed itself, its target untouched; a folder is not
 *   removed) after re-checking the folder's identity against the chain, again immediately before the removal.
 *
 * Every function takes `hooks` ({ afterWalk, afterOpen, beforeRename, afterRename, afterRead, beforeUnlink }, async,
 * for tests to swap things between the steps). Exit codes: 1 invalid input / broken state (also: the folder or file is
 * missing, err.missing = true), 2 policy refusal. Built from ideas audited by /w-bbs (run 2026-10-10-openqodex-2); no foreign code.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { KitExit } from './kit-exit.js';

export const verb = 'guarded-write';
export const usage = 'cli.js guarded-write --root <absolute dir> --file <path under root> [--protect <dir under root>]   '
  + '(content on stdin; writes it through an identity-checked walk: a symlink inside the protect folder (default: root) is refused, '
  + 'one elsewhere under root is followed; exit 0 written, 1 invalid, 2 refused)';

export const MAX_STEPS = 64;
export const MAX_BYTES = 64 * 1024 * 1024;
const C = fsSync.constants;
const refuse = (msg) => new KitExit(msg, 2);
const invalid = (msg) => new KitExit(msg, 1);
const missing = (msg) => Object.assign(new KitExit(msg, 1), { missing: true });
const PROC = process.platform === 'linux' && fsSync.existsSync('/proc/self/fd');

const lstatBig = (p) => fs.lstat(p, { bigint: true }).catch((e) => { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; });
const ident = (st) => ({ dev: String(st.dev), ino: String(st.ino) });
const sameId = (a, b) => !!a && !!b && String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
const inside = (p, base) => p === base || p.startsWith(base.endsWith(path.sep) ? base : base + path.sep);

function checkRaw(p, what) {
  if (typeof p !== 'string' || p === '') throw invalid(`${what} must be a non-empty path`);
  if (p.includes('\0')) throw invalid(`${what} contains a NUL character`);
  if (!path.isAbsolute(p)) throw invalid(`${what} must be an absolute path (got ${JSON.stringify(p).slice(0, 80)})`);
  if (p.split(/[\\/]+/).includes('..')) throw refuse(`${what} contains "..": ${JSON.stringify(p).slice(0, 120)}`);
}

/** realpath of the deepest existing ancestor of p, plus the names below it. */
async function realish(p) {
  const rest = [];
  for (let d = p; ;) {
    try { return path.join(await fs.realpath(d), ...rest.reverse()); } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw invalid(`cannot resolve ${p}: ${e.message}`);
    }
    const up = path.dirname(d);
    if (up === d) return p;
    rest.push(path.basename(d));
    d = up;
  }
}

/**
 * Walk `target`'s parent folders from `root`. Returns { root, protect, parent, name, chain: [{path, dev, ino, via?}] }
 * (chain[0] is the root, the last entry the parent folder). `create: true` makes missing folders (mode 0700) as it goes.
 */
export async function resolveGuarded(target, { root, protect, create = false } = {}) {
  checkRaw(target, 'target');
  checkRaw(root, 'root');
  const protectIn = protect === undefined ? root : protect;
  checkRaw(protectIn, 'protect');
  let realRoot;
  try { realRoot = await fs.realpath(root); } catch (e) { throw invalid(`cannot open root ${root}: ${e.message}`); }
  const rootSt = await lstatBig(realRoot);
  if (!rootSt?.isDirectory()) throw invalid(`root ${root} is not a folder`);
  const relOf = (p) => path.relative(path.resolve(root), path.resolve(p));
  const rel = relOf(target);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw refuse(`${target} is not inside the root ${root}`);
  const protRel = relOf(protectIn);
  if (protRel === '..' || protRel.startsWith('..' + path.sep) || path.isAbsolute(protRel)) throw invalid(`protect ${protectIn} is not inside the root ${root}`);
  const realProtect = await realish(path.join(realRoot, protRel));
  const protectSt = await lstatBig(realProtect).catch(() => null);
  const protectId = protectSt?.isDirectory() ? ident(protectSt) : null;

  const names = rel.split(path.sep);
  const name = names.pop();
  if (names.length + 1 > MAX_STEPS) throw invalid(`${target} has more than ${MAX_STEPS} steps`);
  const chain = [{ path: realRoot, ...ident(rootSt) }];
  let cur = realRoot;
  let scoped = inside(cur, realProtect) || sameId(ident(rootSt), protectId);
  const enter = (p, st) => { if (!scoped && (inside(p, realProtect) || sameId(ident(st), protectId))) scoped = true; };
  for (const nm of names) {
    if (nm === '' || nm === '.') continue;
    const child = path.join(cur, nm);
    let st = await lstatBig(child).catch((e) => { throw invalid(`cannot look at ${child}: ${e.message}`); });
    if (!st) {
      if (!create) throw missing(`${child} does not exist`);
      try { await fs.mkdir(child, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw invalid(`cannot create ${child}: ${e.message}`); }
      st = await lstatBig(child);
      if (!st) throw invalid(`${child} vanished while it was being created`);
    }
    if (st.isSymbolicLink()) {
      if (scoped || inside(child, realProtect)) throw refuse(`${child} is a symlink inside the protected tree ${realProtect}; refusing to follow it`);
      let real;
      try { real = await fs.realpath(child); } catch (e) { throw invalid(`the link ${child} does not lead anywhere (${e.code || e.message})`); }
      const rst = await lstatBig(real);
      if (!inside(real, realRoot)) throw refuse(`the link ${child} leads to ${real}, outside the root ${realRoot}`);
      if (!rst?.isDirectory()) throw invalid(`the link ${child} leads to ${real}, which is not a folder`);
      if (inside(real, realProtect) || sameId(ident(rst), protectId)) throw refuse(`the link ${child} leads into the protected tree ${realProtect}`);
      chain.push({ path: real, via: child, ...ident(rst) });
      cur = real;
      enter(cur, rst);
    } else {
      if (!st.isDirectory()) throw invalid(`${child} is not a folder`);
      chain.push({ path: child, ...ident(st) });
      cur = child;
      enter(cur, st);
    }
  }
  if (nameBad(name)) throw invalid(`bad file name ${JSON.stringify(name).slice(0, 80)}`);
  return { root: realRoot, protect: realProtect, parent: cur, name, chain };
}

const nameBad = (n) => !n || n === '.' || n === '..' || n.includes('\0');
const sameChain = (a, b) => a.chain.length === b.chain.length && a.chain.every((e, i) => e.path === b.chain[i].path && sameId(e, b.chain[i]));

/** Walk again (no creating) and refuse when anything on the way changed since `res`. */
async function recheck(target, opts, res, what) {
  let again;
  try { again = await resolveGuarded(target, { ...opts, create: false }); } catch (e) {
    if (e instanceof KitExit) throw refuse(`${what}: the path changed while it was being used (${e.message})`);
    throw e;
  }
  if (!sameChain(res, again)) throw refuse(`${what}: a folder on the way to ${res.parent} changed while it was being used`);
}

/** Open the verified parent folder; its device+inode must be the chain's last entry. Returns { fh, base } (base = where to name files). */
async function openParent(res) {
  let fh;
  try { fh = await fs.open(res.parent, C.O_RDONLY | (C.O_DIRECTORY || 0) | (C.O_NOFOLLOW || 0)); } catch (e) {
    if (e.code === 'ELOOP' || e.code === 'ENOTDIR') throw refuse(`${res.parent} is no longer a plain folder (swapped for a link or file after the walk)`);
    if (e.code === 'ENOENT') throw missing(`${res.parent} does not exist`);
    throw invalid(`cannot open the folder ${res.parent}: ${e.message}`);
  }
  try {
    const st = await fh.stat({ bigint: true });
    if (!st.isDirectory() || !sameId(st, res.chain.at(-1))) throw refuse(`the folder ${res.parent} is no longer the one that was checked (swapped after the walk)`);
  } catch (e) { await fh.close().catch(() => {}); throw e; }
  return { fh, base: PROC ? `/proc/self/fd/${fh.fd}` : res.parent };
}

const wrap = (what, target) => (e) => { throw e instanceof KitExit ? e : invalid(`cannot ${what} ${target}: ${e.message}`); };

/** Write `data` (string or Buffer) to `target` atomically; see the header. Returns { path, bytes, parent }. */
export async function guardedWrite(target, data, opts = {}) {
  const { hooks = {}, maxBytes = MAX_BYTES, mode = 0o600 } = opts;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
  if (buf.length > maxBytes) throw invalid(`refusing to write ${buf.length} bytes (limit ${maxBytes})`);
  const wopts = { root: opts.root, protect: opts.protect };
  const res = await resolveGuarded(target, { ...wopts, create: true }).catch(wrap('write', target));
  await hooks.afterWalk?.(res);
  const { fh: dirFh, base } = await openParent(res);
  const tmpPath = path.join(base, `.${res.name}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const finalVia = path.join(base, res.name);
  let fh;
  let renamed = false;
  let mine = null;
  try {
    await hooks.afterOpen?.(res);
    fh = await fs.open(tmpPath, C.O_WRONLY | C.O_CREAT | C.O_EXCL | (C.O_NOFOLLOW || 0), mode);
    await fh.writeFile(buf);
    await fh.sync();
    mine = await fh.stat({ bigint: true });
    await hooks.beforeRename?.(res);
    await fs.rename(tmpPath, finalVia);
    renamed = true;
    await hooks.afterRename?.(res);
    // Node has no renameat: prove the name the caller sees holds the file we wrote, in the folder we checked.
    const seen = await lstatBig(path.join(res.parent, res.name)).catch(() => null);
    if (!sameId(seen, mine)) throw refuse(`${target} does not hold the file that was written (the folder was swapped during the write); the write was undone`);
    await recheck(target, wopts, res, 'write');
    await dirFh.sync().catch(() => {});
    return { path: path.join(res.parent, res.name), bytes: buf.length, parent: res.chain.at(-1) };
  } catch (e) {
    if (renamed) {
      const ours = await lstatBig(finalVia).catch(() => null);
      if (sameId(ours, mine)) await fs.unlink(finalVia).catch(() => {});
    } else {
      await fs.unlink(tmpPath).catch(() => {});
    }
    throw wrap('write', target)(e);
  } finally {
    await fh?.close().catch(() => {});
    await dirFh.close().catch(() => {});
  }
}

/** Read `target` (string; Buffer with encoding: null). A file that is missing: KitExit with .missing = true. */
export async function guardedRead(target, opts = {}) {
  const { hooks = {}, maxBytes = MAX_BYTES, encoding = 'utf-8' } = opts;
  const ropts = { root: opts.root, protect: opts.protect };
  const res = await resolveGuarded(target, { ...ropts, create: false }).catch(wrap('read', target));
  await hooks.afterWalk?.(res);
  const { fh: dirFh, base } = await openParent(res);
  let fh;
  try {
    await hooks.afterOpen?.(res);
    try { fh = await fs.open(path.join(base, res.name), C.O_RDONLY | (C.O_NOFOLLOW || 0) | (C.O_NONBLOCK || 0)); } catch (e) {
      if (e.code === 'ENOENT') throw missing(`${target} does not exist`);
      if (e.code === 'ELOOP') throw refuse(`${target} is a symlink; refusing to read through it`);
      throw e;
    }
    const st = await fh.stat({ bigint: true });
    if (!st.isFile()) throw refuse(`${target} is not a regular file`);
    if (st.size > BigInt(maxBytes)) throw refuse(`${target} is larger than ${maxBytes} bytes`);
    const out = await fh.readFile();
    if (out.length > maxBytes) throw refuse(`${target} grew past ${maxBytes} bytes while it was read`);
    await hooks.afterRead?.(res);
    const seen = await lstatBig(path.join(res.parent, res.name)).catch(() => null);
    if (!sameId(seen, st)) throw refuse(`${target} is not the file that was read (a link was swapped in during the read)`);
    await recheck(target, ropts, res, 'read');
    return encoding ? out.toString(encoding) : out;
  } catch (e) {
    throw wrap('read', target)(e);
  } finally {
    await fh?.close().catch(() => {});
    await dirFh.close().catch(() => {});
  }
}

/** Remove the name `target` (a final link is removed itself, never followed; a folder is refused). Returns { deleted }. */
export async function guardedDelete(target, opts = {}) {
  const { hooks = {} } = opts;
  const dopts = { root: opts.root, protect: opts.protect };
  let res;
  try { res = await resolveGuarded(target, { ...dopts, create: false }); } catch (e) {
    if (e.missing) return { deleted: false };
    throw wrap('delete', target)(e);
  }
  await hooks.afterWalk?.(res);
  let dir;
  try {
    dir = await openParent(res);
  } catch (e) {
    if (e.missing) return { deleted: false };
    throw wrap('delete', target)(e);
  }
  try {
    const st = await lstatBig(path.join(dir.base, res.name));
    if (!st) return { deleted: false };
    if (st.isDirectory()) throw invalid(`${target} is a folder; guardedDelete removes files and links only`);
    await hooks.beforeUnlink?.(res);
    // identity of the folder, once more, immediately before the removal
    const now = await dir.fh.stat({ bigint: true });
    if (!sameId(now, res.chain.at(-1))) throw refuse(`the folder ${res.parent} changed before the removal`);
    await recheck(target, dopts, res, 'delete');
    await fs.unlink(path.join(dir.base, res.name));
    return { deleted: true };
  } catch (e) {
    throw wrap('delete', target)(e);
  } finally {
    await dir.fh.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- CLI

const FLAGS = ['root', 'file', 'protect'];

export function parseArgs(args) {
  const out = {};
  const rest = [...args];
  while (rest.length) {
    const a = rest.shift();
    if (!a.startsWith('--')) throw invalid(`unexpected argument "${a}"\n${usage}`);
    const k = a.slice(2);
    if (!FLAGS.includes(k)) throw invalid(`unknown flag --${k} (allowed: ${FLAGS.map((f) => `--${f}`).join(', ')})`);
    if (!rest.length) throw invalid(`--${k} needs a value`);
    out[k] = rest.shift();
  }
  return out;
}

export async function run(args, io) {
  const f = parseArgs(args);
  if (!f.root || !f.file) throw invalid(`--root and --file are required\n${usage}`);
  if (f.file.split(/[\\/]+/).includes('..')) throw refuse(`--file contains "..": ${JSON.stringify(f.file).slice(0, 120)}`);
  const file = path.isAbsolute(f.file) ? f.file : path.join(f.root, f.file);
  const content = await io.stdin();
  const r = await guardedWrite(file, content, { root: f.root, protect: f.protect });
  return { written: true, path: r.path, bytes: r.bytes };
}
