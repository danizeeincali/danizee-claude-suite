/**
 * frame-capture — repeatable animation frames. The page's clock is faked and stepped by whole-millisecond
 * increments that average the target frame rate (30 fps steps 33, 33, 34, ...), CSS animations are paused at the
 * matching time inside the same evaluation, and each frame is screenshotted. Each frame's loop time is saved beside
 * the images so the export window and the loop seam can be checked afterwards.
 *
 *   frame-capture plan --fps <n> --frames <n> [--warmup <n>] [--loop-ms <ms>]
 *       → { fps, warmup, steps_ms, frames:[{index,t_ms,loop_t_ms}], mean_fps }. Frame g (counting warm-up frames) sits at
 *       floor(g*1000/fps) ms, so the running sum of steps never drifts more than 1 ms from g*1000/fps. steps_ms[g] is the
 *       step from frame g to frame g+1 (warm-up included, plus the step after the last frame). Warm-up frames are stepped
 *       but excluded from `frames`. loop_t_ms is t_ms mod loop_ms (null without --loop-ms; seam derives it).
 *   frame-capture seam --loop-ms <ms> [--file <manifest.json>]   (or the manifest on stdin)
 *       → { ok, findings:[{kind,index?,detail}] }. Kinds: duplicate, missing, timing, inconsistent, seam. Advisory, exit 0.
 *       The first frame's loop time and the last frame's loop time plus the next step must meet at the seam.
 *   frame-capture capture --url <url> --out <dir> --fps <n> --frames <n> [--warmup <n>] [--loop-ms <ms>]
 *                         [--width <px>] [--height <px>] [--scale <x>]
 *       Only file:// and http://localhost / http://127.0.0.1 URLs; anything else is refused (exit 2) and never fetched.
 *       Loads playwright only if the project can resolve it (it is not a dependency of this suite); if not, returns
 *       { captured:0, reason:"playwright not installed: frame-capture capture needs it", exit:4 }. Writes
 *       <out>/frame-00001.png ... and <out>/manifest.json (stale frame-*.png from an earlier run in <out> are removed).
 *       Egress is blocked at the browser: Chromium resolves no name but localhost/127.0.0.1 and uses no proxy, service
 *       workers are blocked, and context-level routes (popups included) abort non-local requests and WebSockets.
 *       Each animation is seeked relative to the frame time it first appeared at, so late starters are not skipped ahead.
 *
 * Built from ideas audited by /w-bbs (run 2026-10-26-ai-design-skills); no foreign code.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { KitExit } from './kit-exit.js';

export const verb = 'frame-capture';
export const usage = 'cli.js frame-capture plan --fps <n> --frames <n> [--warmup <n>] [--loop-ms <ms>] | seam --loop-ms <ms> [--file <manifest.json>] | capture --url <file:// or http://localhost url> --out <dir> --fps <n> --frames <n> [--warmup <n>] [--loop-ms <ms>] [--width <px>] [--height <px>] [--scale <x>]  (JSON out; exit 1 bad input; exit 2 non-local URL refused; exit 4 playwright missing)';

export const MAX_INPUT_BYTES = 8 * 1048576;
export const NOT_INSTALLED = 'playwright not installed: frame-capture capture needs it';
const MAX_FPS = 240;
const MAX_FRAMES = 20000;
const MAX_WARMUP = 1000;
const MAX_LOOP_MS = 3600000;
const MANIFEST_KEYS = ['fps', 'loop_ms', 'frames', 'warmup', 'url', 'width', 'height', 'scale', 'steps_ms', 'mean_fps'];

const bad = (m, code = 1) => new KitExit(m, code);
const isInt = (v) => Number.isInteger(v);

/** Time of frame g (warm-up counted) in whole ms: floor(g * 1000 / fps). Integer arithmetic only. */
export const frameTime = (g, fps) => Math.floor((g * 1000) / fps);

export function plan({ fps, frames, warmup = 0, loopMs = null }) {
  const total = warmup + frames;
  const steps = new Array(total);
  for (let g = 0; g < total; g++) steps[g] = frameTime(g + 1, fps) - frameTime(g, fps);
  const list = new Array(frames);
  for (let k = 0; k < frames; k++) {
    const t = frameTime(warmup + k, fps);
    list[k] = { index: k, t_ms: t, loop_t_ms: loopMs === null ? null : t % loopMs };
  }
  let mean = fps;
  if (frames > 1) mean = Math.round(((frames - 1) * 1000 / (list[frames - 1].t_ms - list[0].t_ms)) * 1000) / 1000;
  return { fps, warmup, steps_ms: steps, frames: list, mean_fps: mean };
}

/** Check a saved manifest {fps, loop_ms?, warmup?, frames:[{index,t_ms,loop_t_ms}]} against loopMs. */
export function seamCheck(manifest, loopMs) {
  const m = manifest;
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw bad('manifest must be a JSON object');
  for (const k of Object.keys(m)) if (!MANIFEST_KEYS.includes(k)) throw bad(`unknown manifest key "${k}"`);
  if (!isInt(m.fps) || m.fps < 1 || m.fps > MAX_FPS) throw bad(`manifest.fps must be an integer 1..${MAX_FPS}`);
  if (!Array.isArray(m.frames) || !m.frames.length) throw bad('manifest.frames must be a non-empty array');
  if (m.warmup !== undefined && (!isInt(m.warmup) || m.warmup < 0)) throw bad('manifest.warmup must be a non-negative integer');
  if (m.loop_ms !== undefined && m.loop_ms !== null && m.loop_ms !== loopMs) throw bad(`manifest.loop_ms (${m.loop_ms}) differs from --loop-ms (${loopMs})`);
  const warmup = m.warmup || 0;
  for (let i = 0; i < m.frames.length; i++) {
    const f = m.frames[i];
    if (!f || typeof f !== 'object' || Array.isArray(f)) throw bad(`manifest.frames[${i}] must be an object`);
    for (const k of ['index', 't_ms', 'loop_t_ms']) {
      if (k === 'loop_t_ms' && f[k] === null) continue; // captured without --loop-ms: derived from t_ms below
      if (!isInt(f[k]) || f[k] < 0) throw bad(`manifest.frames[${i}].${k} must be a non-negative integer`);
    }
  }
  const fr = m.frames.map((f) => (f.loop_t_ms === null ? { ...f, loop_t_ms: f.t_ms % loopMs } : f));
  const findings = [];
  const seen = new Map();
  for (let i = 0; i < fr.length; i++) {
    const f = fr[i];
    if (f.loop_t_ms >= loopMs || f.loop_t_ms !== f.t_ms % loopMs) findings.push({ kind: 'inconsistent', index: f.index, detail: `loop_t_ms ${f.loop_t_ms} is not t_ms ${f.t_ms} mod ${loopMs}` });
    if (seen.has(f.loop_t_ms)) findings.push({ kind: 'duplicate', index: f.index, detail: `loop time ${f.loop_t_ms} ms already used by frame ${seen.get(f.loop_t_ms)}` });
    else seen.set(f.loop_t_ms, f.index);
    if (f.t_ms !== frameTime(warmup + f.index, m.fps)) findings.push({ kind: 'timing', index: f.index, detail: `t_ms ${f.t_ms} differs from the plan (${frameTime(warmup + f.index, m.fps)}) for ${m.fps} fps` });
    if (i > 0) {
      const p = fr[i - 1];
      const want = frameTime(warmup + f.index, m.fps) - frameTime(warmup + p.index, m.fps);
      if (f.index - p.index > 1 || f.t_ms - p.t_ms > want) findings.push({ kind: 'missing', index: f.index, detail: `gap of ${f.t_ms - p.t_ms} ms after frame ${p.index}: loop times between ${p.loop_t_ms} and ${f.loop_t_ms} are missing` });
    }
  }
  const last = fr[fr.length - 1];
  const g = warmup + last.index;
  const next = (last.loop_t_ms + frameTime(g + 1, m.fps) - frameTime(g, m.fps)) % loopMs;
  if (next !== fr[0].loop_t_ms) findings.push({ kind: 'seam', index: last.index, detail: `last frame ${last.loop_t_ms} ms plus one step lands on ${next} ms, but the first frame is at ${fr[0].loop_t_ms} ms` });
  return { ok: findings.length === 0, frames: fr.length, loop_ms: loopMs, findings };
}

/** Only file:// and http://localhost|127.0.0.1 may ever be loaded. Returns the normalised href or throws KitExit 2. */
export function checkUrl(s) {
  let u;
  try { u = new URL(s); } catch { throw bad(`url refused (not a valid URL): ${JSON.stringify(String(s).slice(0, 80))}`, 2); }
  if (u.username || u.password) throw bad('url refused: credentials in the URL', 2);
  if (u.protocol === 'file:' && u.hostname === '') return u.href;
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.href;
  throw bad(`url refused: only file:// and http://localhost or http://127.0.0.1 are allowed, got ${u.protocol}//${u.hostname}`, 2);
}
const isLocalUrl = (s) => { try { checkUrl(s); return true; } catch { return false; } };
/** WebSockets: only ws:// to localhost or 127.0.0.1, without credentials (wss:// is refused like https://). */
const isLocalWs = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === 'ws:' && !u.username && !u.password && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch { return false; }
};

/** Browser-level egress boundary: no name but localhost/127.0.0.1 resolves (redirect targets included) and no proxy is used. */
export const LAUNCH_ARGS = Object.freeze(['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--no-proxy-server']);
/** Context-level request route (covers popups): continue local requests, abort everything else. */
export const routeRequest = (route) => (isLocalUrl(route.request().url()) ? route.continue() : route.abort());
/** Context-level WebSocket route: connect local sockets, close every other one without connecting it. */
export const routeSocket = (ws) => (isLocalWs(ws.url()) ? ws.connectToServer() : ws.close());

function parseFlags(args, allowed) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"; ${usage}`);
    let val = null;
    const eq = a.indexOf('=');
    if (eq > 0) { val = a.slice(eq + 1); a = a.slice(0, eq); }
    const k = a.slice(2);
    if (!allowed.includes(k)) throw bad(`unknown option ${a}; ${usage}`);
    if (Object.hasOwn(out, k)) throw bad(`--${k} given twice`);
    if (val === null) {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw bad(`--${k} needs a value`);
      val = args[++i];
    }
    if (val === '') throw bad(`--${k} needs a non-empty value`);
    out[k] = val;
  }
  return out;
}
function intFlag(f, k, min, max, required, dflt = null) {
  if (f[k] === undefined) { if (required) throw bad(`--${k} is required`); return dflt; }
  if (!/^\d{1,9}$/.test(f[k])) throw bad(`--${k} must be an integer, got ${JSON.stringify(f[k])}`);
  const n = Number(f[k]);
  if (n < min || n > max) throw bad(`--${k} must be between ${min} and ${max}, got ${n}`);
  return n;
}
function planFlags(f) {
  return {
    fps: intFlag(f, 'fps', 1, MAX_FPS, true),
    frames: intFlag(f, 'frames', 1, MAX_FRAMES, true),
    warmup: intFlag(f, 'warmup', 0, MAX_WARMUP, false, 0),
    loopMs: intFlag(f, 'loop-ms', 1, MAX_LOOP_MS, false, null),
  };
}

/** Read the manifest: --file (regular file, checked on the open handle, bounded read) or stdin (byte-counted cap). */
async function readInput(file, io) {
  let buf;
  if (file !== undefined) {
    const p = path.resolve(io.cwd || process.cwd(), file);
    const real = await fs.realpath(p).catch(() => p);
    for (const q of [p, real]) if (/^\/(dev|proc)(\/|$)/.test(q)) throw bad(`--file ${file} is under /dev or /proc and is refused`);
    let fh;
    try { fh = await fs.open(p, FS.O_RDONLY | FS.O_NONBLOCK); } catch (e) { throw bad(`cannot read ${file}: ${e.code || e.message}`); }
    try {
      const st = await fh.stat();
      if (!st.isFile()) throw bad(`--file ${file} is not a regular file`);
      const b = Buffer.alloc(MAX_INPUT_BYTES + 1);
      let n = 0;
      while (n < b.length) {
        const { bytesRead } = await fh.read(b, n, b.length - n, null);
        if (!bytesRead) break;
        n += bytesRead;
      }
      buf = b.subarray(0, n);
    } finally { await fh.close(); }
  } else {
    if (typeof io.stdinBytes !== 'function' || io.stdinIsTTY) throw bad('no input: pass the manifest with --file or on stdin');
    buf = Buffer.from(await io.stdinBytes({ maxBytes: MAX_INPUT_BYTES + 1 }));
  }
  if (buf.length > MAX_INPUT_BYTES) throw bad(`input is larger than ${MAX_INPUT_BYTES} bytes`);
  const text = buf.toString('utf-8').replace(/^﻿/, '');
  if (!text.trim()) throw bad('no input: the manifest is empty');
  try { return JSON.parse(text); } catch { throw bad('input is not valid JSON'); }
}

/** Default resolver: playwright as the project at `cwd` would resolve it (never installed by us). Returns the module or null. */
export async function resolvePlaywright(cwd = process.cwd()) {
  try {
    const req = createRequire(path.join(path.resolve(cwd), 'noop.js'));
    const mod = await import(pathToFileURL(req.resolve('playwright')).href);
    return mod && mod.chromium ? mod : (mod && mod.default && mod.default.chromium ? mod.default : null);
  } catch { return null; }
}

async function writeAtomic(dest, data) {
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, data, { flag: 'wx' });
    await fs.rename(tmp, dest);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw bad(`cannot write ${dest}: ${e.code || e.message}`);
  }
}

export async function capture(o, io = {}) {
  const href = checkUrl(o.url);
  const pw = await (io.resolvePlaywright ? io.resolvePlaywright(io.cwd) : resolvePlaywright(io.cwd));
  if (!pw || !pw.chromium) return { captured: 0, reason: NOT_INSTALLED, exit: 4 };
  const out = path.resolve(io.cwd || process.cwd(), o.out);
  const lst = await fs.lstat(out).catch(() => null);
  if (lst && lst.isSymbolicLink()) throw bad(`--out ${o.out} is a symlink and is refused`);
  if (lst && !lst.isDirectory()) throw bad(`--out ${o.out} is not a directory`);
  await fs.mkdir(out, { recursive: true });
  const p = plan(o);
  let browser;
  try {
    try { browser = await pw.chromium.launch({ headless: true, args: [...LAUNCH_ARGS] }); } catch (e) {
      return { captured: 0, reason: `playwright browser could not start: ${String(e && e.message).split('\n')[0]}`, exit: 4 };
    }
    const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: o.scale, serviceWorkers: 'block' });
    await ctx.route('**/*', routeRequest);
    await ctx.routeWebSocket(/.*/, routeSocket);
    const page = await ctx.newPage();
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000);
    await page.goto(href);
    const files = [];
    const total = o.warmup + o.frames;
    for (let g = 0; g < total; g++) {
      if (g > 0) await page.clock.runFor(p.steps_ms[g - 1]);
      const t = frameTime(g, o.fps);
      // Pause every animation inside one evaluation, seeked to t minus the frame time it was first seen at (animations
      // present at load start at 0), so one that starts later is not jumped ahead to the global time.
      await page.evaluate((ms) => {
        const key = Symbol.for('frame-capture.start');
        const start = globalThis[key] || (globalThis[key] = new WeakMap());
        for (const a of document.getAnimations()) {
          if (!start.has(a)) start.set(a, ms);
          a.pause();
          a.currentTime = ms - start.get(a);
        }
      }, t);
      if (g < o.warmup) continue;
      const k = g - o.warmup;
      const name = `frame-${String(k + 1).padStart(5, '0')}.png`;
      const png = await page.screenshot({ type: 'png' });
      await writeAtomic(path.join(out, name), png);
      files.push(name);
    }
    const keep = new Set(files);
    for (const n of await fs.readdir(out)) {
      if (!/^frame-\d+\.png$/.test(n) || keep.has(n)) continue;
      try { await fs.unlink(path.join(out, n)); } catch (e) { throw bad(`cannot remove stale ${n} from --out: ${e.code || e.message}`); }
    }
    const manifest = {
      fps: o.fps, loop_ms: o.loopMs, warmup: o.warmup, url: href, width: o.width, height: o.height, scale: o.scale,
      steps_ms: p.steps_ms, mean_fps: p.mean_fps,
      frames: p.frames.map((f, i) => ({ ...f, file: files[i] })),
    };
    await writeAtomic(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return { captured: files.length, out, manifest: path.join(out, 'manifest.json'), mean_fps: p.mean_fps };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function run(args, io = {}) {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') return { usage };
  if (rest.includes('--help') || rest.includes('-h')) return { usage };
  if (sub === 'plan') return plan(planFlags(parseFlags(rest, ['fps', 'frames', 'warmup', 'loop-ms'])));
  if (sub === 'seam') {
    const f = parseFlags(rest, ['file', 'loop-ms']);
    const loopMs = intFlag(f, 'loop-ms', 1, MAX_LOOP_MS, true);
    return seamCheck(await readInput(f.file, io), loopMs);
  }
  if (sub === 'capture') {
    const f = parseFlags(rest, ['url', 'out', 'fps', 'frames', 'warmup', 'loop-ms', 'width', 'height', 'scale']);
    if (f.url === undefined) throw bad('--url is required');
    if (f.out === undefined) throw bad('--out is required');
    let scale = 1;
    if (f.scale !== undefined) {
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(f.scale) || Number(f.scale) < 0.25 || Number(f.scale) > 4) throw bad('--scale must be a number between 0.25 and 4');
      scale = Number(f.scale);
    }
    const o = {
      ...planFlags(f), url: f.url, out: f.out, scale,
      width: intFlag(f, 'width', 16, 8192, false, 1280), height: intFlag(f, 'height', 16, 8192, false, 720),
    };
    return capture(o, io);
  }
  throw bad(`unknown subcommand "${sub}"; ${usage}`);
}
