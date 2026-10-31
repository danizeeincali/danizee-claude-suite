/**
 * story-render — turn a self-contained story page into a short MP4 (or tell someone how to watch it live).
 * Builds on frame-capture: the same deterministic clock stepping, animation pausing and local-only browser.
 *
 *   story-render plan --file <story.html> [--format square|wide] [--fps <n>] [--max-seconds <n>]
 *       → { file, format, size:{w,h}, fps, frames, duration_ms, duration_source, ffmpeg_args }. Pure and read-only.
 *       square is 1080x1080, wide is 1920x1080 (default square). fps 1..60 (default 30), max-seconds 1..120
 *       (default 10). frames = ceil(duration_ms * fps / 1000). ffmpeg_args is the argv (no shell, no "ffmpeg"
 *       itself) with "{frames_dir}" and "{out}" placeholders: constant frame rate, libx264, yuv420p, +faststart.
 *       The story page declares its length in whole milliseconds, looked up in this order (first hit wins):
 *         1. <meta name="story-duration-ms" content="3000">
 *         2. a data-story-duration-ms="3000" attribute on <html>
 *         3. a data-story-duration-ms="3000" attribute on <body>
 *       A page with none of these, a value that is not a positive whole number, or a duration over
 *       --max-seconds is refused (exit 1) with a message saying what to change.
 *   story-render render --file <story.html> --out <file.mp4> [--format square|wide] [--fps <n>] [--max-seconds <n>]
 *                       [--ffmpeg <path>] [--keep-frames] [--encode-timeout-s <n>]
 *       → { out, frames, duration_ms, size, bytes, format, fps, ffmpeg, blocked_origins } (plus frames_dir with --keep-frames, and
 *       warnings when blocked_origins is not empty: one entry per blocked origin, since its fonts/images are missing from the video).
 *       Captures the frames through frame-capture into a temp directory (the story is loaded from its file:// URL;
 *       only local requests (file://, localhost) are allowed, everything else is blocked in the browser and listed in blocked_origins), then encodes them with ffmpeg spawned from an argv array
 *       without a shell. The temp frames are removed afterwards unless --keep-frames. --out must end in .mp4 and is
 *       written through a temp name and renamed. ffmpeg is probed with `ffmpeg -version` and `ffmpeg -hide_banner -encoders`
 *       (or `<path> ...` with --ffmpeg) before any frame is captured; a missing ffmpeg, or a build without the libx264
 *       encoder, gives
 *       { out:null, frames:0, reason:"ffmpeg not found: ..." (or "... has no libx264 encoder ..."), exit:4 }. If playwright cannot be resolved the
 *       frame-capture result passes through the same way (exit 4, out:null). A failed encode exits 1 with the
 *       tail of ffmpeg's stderr; a killed or timed-out ffmpeg is named ("killed by SIGKILL", "timed out after N s"), a hanging
 *       `-version` is reported as "ffmpeg did not answer" (exit 4), and an ffmpeg that exits 0 without writing the file exits 1 saying so.
 *       With --keep-frames every failure message names the kept frames folder (the exit-4 capture result also carries frames_dir).
 *       Encode timeout: max(600 s, ceil(frames x 0.2 s x (w x h) / (1920 x 1080))), e.g. 7200 wide frames = 1440 s; --encode-timeout-s <n>
 *       (1..86400) overrides it.
 *       SIGINT/SIGTERM during a render stop a running ffmpeg child (SIGTERM, then SIGKILL after a 2 s grace), remove the temp frames
 *       folder (unless --keep-frames) and the .part.mp4, print "story-render: interrupted by SIGTERM" (plus "; frames kept in <dir>"
 *       with --keep-frames) instead of a capture error, then re-raise the signal.
 *   story-render play --file <story.html> [--format square|wide]
 *       → { url, play_url, contract, next }. Prints the file:// URL to open; it starts no browser. The contract:
 *       a story page opened with the query `?play=1` runs live at real speed (real clock, animations running,
 *       looping is the page's choice); without it the page is passive so a renderer can drive its clock.
 *
 * Exit codes: 0 answer printed; 1 bad input (no/oversize/binary/unreadable file, missing or invalid duration, over
 * the cap, unknown/duplicate flag, ffmpeg failed); 4 ffmpeg or playwright missing (result carries a reason).
 * Reads at most 8 MiB of the story file.
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import fs from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { constants as FS } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { KitExit } from './kit-exit.js';
import { capture } from './frame-capture.js';

export const verb = 'story-render';
export const usage = 'cli.js story-render plan --file <story.html> [--format square|wide] [--fps <n>] [--max-seconds <n>] | render --file <story.html> --out <file.mp4> [--format square|wide] [--fps <n>] [--max-seconds <n>] [--ffmpeg <path>] [--keep-frames] [--encode-timeout-s <n>] | play --file <story.html> [--format square|wide]  (JSON out; exit 1 bad input; exit 4 ffmpeg or playwright missing)';

export const MAX_INPUT_BYTES = 8 * 1048576;
export const FORMATS = Object.freeze({ square: { w: 1080, h: 1080 }, wide: { w: 1920, h: 1080 } });
export const DEFAULT_FPS = 30;
export const DEFAULT_MAX_SECONDS = 10;
const MAX_FPS = 60;
const MAX_MAX_SECONDS = 120;
const MAX_TAG_CHARS = 8192;
export const FFMPEG_MISSING = 'ffmpeg not found: story-render render needs it';
export const SIGNAL_GRACE_MS = 2000;
const MAX_ENCODE_TIMEOUT_S = 86400;
/** Encode timeout in seconds: scales with frames and pixels (0.2 s per 1920x1080 frame), never under 600 s. */
export const encodeTimeoutS = (frames, size) => Math.max(600, Math.ceil((frames * 0.2 * size.w * size.h) / (1920 * 1080)));
const liveChildren = new Set();

const bad = (m, code = 1) => new KitExit(m, code);

/** Attributes of one tag's text (between "<name" and ">"). Names lower-cased; bounded input, linear scan. */
function tagAttrs(text) {
  const out = new Map();
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`][^\s>]*)))?/g;
  let m;
  while ((m = re.exec(text))) {
    const k = m[1].toLowerCase();
    if (!out.has(k)) out.set(k, m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/** The text of the first `<name ...>` tag(s) at or after `from`, honouring quotes, capped at MAX_TAG_CHARS. Returns [text,next] or null. */
function readTag(html, start, nameLen) {
  let q = '';
  let prev = ''; // last non-space char outside quotes: a quote opens a value only right after "="
  const end = Math.min(html.length, start + MAX_TAG_CHARS);
  for (let i = start + nameLen + 1; i < end; i++) {
    const c = html[i];
    if (q) { if (c === q) { q = ''; prev = c; } continue; }
    if ((c === '"' || c === "'") && prev === '=') { q = c; continue; }
    if (c === '>') return [html.slice(start + nameLen + 1, i), i + 1];
    if (!/\s/.test(c)) prev = c;
  }
  return null;
}

/** Every tag with the given lower-case name, in document order, as attribute maps. Comments and script/style/textarea/title/template/noscript bodies are skipped. */
function eachTag(html, name, visit) {
  const lower = html.replace(/[A-Z]/g, (c) => c.toLowerCase()); // ASCII only: indices stay aligned with html
  const needle = '<' + name;
  let i = 0;
  let wasted = 0; // chars scanned by tags that never closed: bounded so unclosed tags cannot make the scan quadratic
  while (i < lower.length) {
    const lt = lower.indexOf('<', i);
    if (lt < 0) return;
    if (lower.startsWith('<!--', lt)) { const e = lower.indexOf('-->', lt + 4); if (e < 0) return; i = e + 3; continue; }
    const raw = /^<(script|style|textarea|title|template|noscript)(?=[\s>\/])/.exec(lower.slice(lt, lt + 12));
    if (raw && name !== raw[1]) { const e = lower.indexOf('</' + raw[1], lt + 1); if (e < 0) return; i = e + 2; continue; }
    if (lower.startsWith(needle, lt) && /[\s\/>]/.test(lower[lt + needle.length] || '>')) {
      const t = readTag(html, lt, needle.length - 1);
      if (t) { if (visit(tagAttrs(t[0])) === false) return; i = t[1]; continue; }
      wasted += MAX_TAG_CHARS;
      if (wasted > 1048576) return;
    }
    i = lt + 1;
  }
}

/** Parse the declared duration from story HTML: { duration_ms, source } or throws KitExit 1. */
export function parseStoryDuration(html) {
  const found = [];
  let metaHit = null;
  eachTag(html, 'meta', (a) => {
    if ((a.get('name') || '').trim().toLowerCase() === 'story-duration-ms') { metaHit = a.get('content') ?? ''; return false; }
    return true;
  });
  if (metaHit !== null) found.push(['<meta name="story-duration-ms">', metaHit]);
  for (const el of ['html', 'body']) {
    if (found.length) break;
    eachTag(html, el, (a) => { if (a.has('data-story-duration-ms')) found.push([`data-story-duration-ms on <${el}>`, a.get('data-story-duration-ms')]); return false; });
  }
  if (!found.length) throw bad('no story duration: add <meta name="story-duration-ms" content="3000"> (or data-story-duration-ms on <html> or <body>) to the story page');
  const [source, raw] = found[0];
  const v = raw.trim();
  if (!/^\d{1,9}$/.test(v) || Number(v) < 1) throw bad(`story duration from ${source} must be a positive whole number of milliseconds, got ${JSON.stringify(raw.slice(0, 40))}`);
  return { duration_ms: Number(v), source };
}

/** Frame count for a duration at fps: whole frames covering the duration. Integer arithmetic. */
export const frameCount = (durationMs, fps) => Math.ceil((durationMs * fps) / 1000);

/** The ffmpeg argv (without the program name): image sequence in, constant-rate H.264 yuv420p with the index up front out. */
export function buildFfmpegArgs({ framesDir, out, fps }) {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(framesDir, 'frame-%05d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-r', String(fps), '-movflags', '+faststart', out];
}

/** The pure plan for a story: validates and returns the documented fields. */
export function planStory({ html, file = null, format = 'square', fps = DEFAULT_FPS, maxSeconds = DEFAULT_MAX_SECONDS }) {
  if (!Object.hasOwn(FORMATS, format)) throw bad(`--format must be square or wide, got ${JSON.stringify(String(format).slice(0, 40))}`);
  const { duration_ms, source } = parseStoryDuration(html);
  if (duration_ms > maxSeconds * 1000) throw bad(`story duration ${duration_ms} ms is over the ${maxSeconds} s cap (--max-seconds); shorten the story or raise the cap`);
  const size = { ...FORMATS[format] };
  return {
    file, format, size, fps, frames: frameCount(duration_ms, fps), duration_ms, duration_source: source,
    ffmpeg_args: buildFfmpegArgs({ framesDir: '{frames_dir}', out: '{out}', fps }),
  };
}

function parseFlags(args, valued, bools = []) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    if (!a.startsWith('--')) throw bad(`unexpected argument "${a}"; ${usage}`);
    let val = null;
    const eq = a.indexOf('=');
    if (eq > 0) { val = a.slice(eq + 1); a = a.slice(0, eq); }
    const k = a.slice(2);
    const isBool = bools.includes(k);
    if (!isBool && !valued.includes(k)) throw bad(`unknown option ${a}; ${usage}`);
    if (Object.hasOwn(out, k)) throw bad(`--${k} given twice`);
    if (isBool) { if (val !== null) throw bad(`--${k} takes no value`); out[k] = true; continue; }
    if (val === null) {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw bad(`--${k} needs a value`);
      val = args[++i];
    }
    if (val === '') throw bad(`--${k} needs a non-empty value`);
    out[k] = val;
  }
  return out;
}
function intFlag(f, k, min, max, dflt) {
  if (f[k] === undefined) return dflt;
  if (!/^\d{1,9}$/.test(f[k])) throw bad(`--${k} must be an integer, got ${JSON.stringify(f[k])}`);
  const n = Number(f[k]);
  if (n < min || n > max) throw bad(`--${k} must be between ${min} and ${max}, got ${n}`);
  return n;
}
function planOpts(f) {
  return {
    format: f.format === undefined ? 'square' : f.format,
    fps: intFlag(f, 'fps', 1, MAX_FPS, DEFAULT_FPS),
    maxSeconds: intFlag(f, 'max-seconds', 1, MAX_MAX_SECONDS, DEFAULT_MAX_SECONDS),
  };
}

/** Read the story file: regular file only, bounded read, text only. Returns { html, abs }. */
async function readStory(file, io) {
  if (file === undefined) throw bad('--file is required');
  const p = path.resolve(io.cwd || process.cwd(), file);
  const real = await fs.realpath(p).catch(() => p);
  for (const q of [p, real]) if (/^\/(dev|proc)(\/|$)/.test(q)) throw bad(`--file ${file} is under /dev or /proc and is refused`);
  let fh;
  try { fh = await fs.open(p, FS.O_RDONLY | FS.O_NONBLOCK); } catch (e) { throw bad(`cannot read ${file}: ${e.code || e.message}`); }
  let buf;
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
  if (buf.length > MAX_INPUT_BYTES) throw bad(`--file ${file} is larger than ${MAX_INPUT_BYTES} bytes`);
  if (!buf.length) throw bad(`--file ${file} is empty`);
  if (buf.includes(0)) throw bad(`--file ${file} looks binary, not an HTML story page`);
  return { html: buf.toString('utf-8').replace(/^﻿/, ''), abs: real };
}

/** Run a program with an argv array (never a shell). Resolves { code, stderr, error }; stderr keeps the last 4 KiB. */
function exec(cmd, args, timeoutMs = 600000, opts = {}) {
  return new Promise((resolve) => {
    let stderr = '';
    let stdout = '';
    let child;
    try { child = spawn(cmd, args, { stdio: ['ignore', opts.stdout ? 'pipe' : 'ignore', 'pipe'], shell: false }); } catch (error) { resolve({ code: null, stderr, error }); return; }
    liveChildren.add(child);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4096); });
    if (opts.stdout) child.stdout.on('data', (d) => { if (stdout.length < 1048576) stdout += d; });
    child.on('error', (error) => { clearTimeout(timer); liveChildren.delete(child); resolve({ code: null, stderr, error }); });
    child.on('close', (code, signal) => { clearTimeout(timer); liveChildren.delete(child); resolve({ code, signal, timedOut, timeoutMs, stderr, ...(opts.stdout ? { stdout } : {}) }); });
  });
}

/** Words for how a finished process went wrong: the spawn error, a timeout, a signal, or the exit code. */
function describeExit(r) {
  if (r.error) return r.error.code || r.error.message;
  if (r.timedOut) return `timed out after ${Math.round((r.timeoutMs || 0) / 1000)} s and was killed${r.signal ? ' by ' + r.signal : ''}`;
  if (r.signal) return `killed by ${r.signal}`;
  return 'exit ' + r.code;
}

/** Probe ffmpeg with `-version`. Returns { ok, ffmpeg, version? , reason? }. */
export async function probeFfmpeg(bin = 'ffmpeg', io = {}) {
  const r = await (io.exec || exec)(bin, ['-version'], 10000);
  if (r.timedOut) return { ok: false, ffmpeg: bin, reason: `ffmpeg did not answer: "${bin} -version" ${describeExit(r)}; check that ${bin} is a working ffmpeg or pass --ffmpeg <path>` };
  if (r.error || r.code !== 0) return { ok: false, ffmpeg: bin, reason: `${FFMPEG_MISSING} (${describeExit(r)} running "${bin} -version"); install ffmpeg or pass --ffmpeg <path>` };
  const enc = await (io.exec || exec)(bin, ['-hide_banner', '-encoders'], 10000, { stdout: true });
  if (enc.timedOut) return { ok: false, ffmpeg: bin, reason: `ffmpeg did not answer: "${bin} -encoders" ${describeExit(enc)}; check that ${bin} is a working ffmpeg or pass --ffmpeg <path>` };
  if (!enc.error && enc.code === 0 && typeof enc.stdout === 'string' && !/^\s*[A-Z.]{6}\s+libx264\b/m.test(enc.stdout)) {
    return { ok: false, ffmpeg: bin, reason: `${bin} has no libx264 encoder (ffmpeg not usable: story-render render needs libx264); install an ffmpeg build with libx264 or pass --ffmpeg <path>` };
  }
  return { ok: true, ffmpeg: bin };
}

/** SIGTERM every live child, wait up to graceMs for them to close, then SIGKILL the rest. */
async function stopChildren(graceMs) {
  const kids = [...liveChildren];
  for (const c of kids) { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  const t0 = Date.now();
  while (Date.now() - t0 < graceMs && kids.some((c) => c.exitCode === null && c.signalCode === null)) await new Promise((r) => setTimeout(r, 20));
  for (const c of kids) { if (c.exitCode === null && c.signalCode === null) { try { c.kill('SIGKILL'); } catch { /* gone */ } } }
}

export async function render(o, io = {}) {
  const { html, abs } = await readStory(o.file, io);
  const p = planStory({ html, file: abs, format: o.format, fps: o.fps, maxSeconds: o.maxSeconds });
  if (typeof o.out !== 'string' || !o.out) throw bad('--out is required');
  if (!/\.mp4$/i.test(o.out)) throw bad('--out must end in .mp4');
  const out = path.resolve(io.cwd || process.cwd(), o.out);
  const lst = await fs.lstat(out).catch(() => null);
  if (lst && !lst.isFile()) throw bad(`--out ${o.out} exists and is not a regular file`);
  const dirSt = await fs.stat(path.dirname(out)).catch(() => null);
  if (!dirSt || !dirSt.isDirectory()) throw bad(`--out ${o.out}: its directory does not exist`);
  const bin = o.ffmpeg || 'ffmpeg';
  const probe = await probeFfmpeg(bin, io);
  if (!probe.ok) return { out: null, frames: 0, reason: probe.reason, exit: 4 };
  const framesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'story-render-'));
  const tmpOut = `${out}.${process.pid}.part.mp4`;
  const cleanupSync = () => {
    try { rmSync(tmpOut, { force: true }); } catch { /* best effort */ }
    if (!o.keepFrames) { try { rmSync(framesDir, { recursive: true, force: true }); } catch { /* best effort */ } }
  };
  const kept = o.keepFrames ? `; frames kept in ${framesDir}` : '';
  let interrupted = null;
  let signalDone = null;
  const onSignal = async (sig) => {
    if (interrupted) return;
    interrupted = sig;
    try { (io.stderr || process.stderr).write(`story-render: interrupted by ${sig}${kept}\n`); } catch { /* best effort */ }
    for (const [s2, h] of handlers) sigTarget.removeListener(s2, h);
    await stopChildren(io.killGraceMs ?? SIGNAL_GRACE_MS);
    cleanupSync();
    if (io.reraise) { io.reraise(sig); return; }
    // Re-raise with the default action; if the signal is swallowed, still exit the way a signalled process would (128 + signo).
    setImmediate(() => {
      process.kill(process.pid, sig);
      setTimeout(() => process.exit(128 + (os.constants.signals[sig] || 15)), 100);
    });
  };
  const sigTarget = io.signalTarget || process;
  const handlers = ['SIGINT', 'SIGTERM'].map((s2) => [s2, () => { signalDone = onSignal(s2); }]);
  for (const [s2, h] of handlers) sigTarget.on(s2, h);
  try {
    const cap = await capture({ url: pathToFileURL(abs).href, out: framesDir, fps: p.fps, frames: p.frames, warmup: 0, loopMs: null, width: p.size.w, height: p.size.h, scale: 1 }, io);
    if (interrupted) { await signalDone; throw bad(`interrupted by ${interrupted}${kept}`, 1); }
    if (cap.exit) return { out: null, frames: 0, reason: `${cap.reason}${kept}`, exit: cap.exit, ...(o.keepFrames ? { frames_dir: framesDir } : {}) };
    const enc = await (io.exec || exec)(bin, buildFfmpegArgs({ framesDir, out: tmpOut, fps: p.fps }), (o.encodeTimeoutS || encodeTimeoutS(p.frames, p.size)) * 1000);
    if (enc.error || enc.code !== 0) throw bad(`ffmpeg failed (${describeExit(enc)}): ${String(enc.stderr || '').trim().split('\n').slice(-5).join(' | ')}`);
    const made = await fs.stat(tmpOut).catch(() => null);
    if (!made || !made.isFile() || !made.size) throw bad(`ffmpeg exited 0 but wrote no output (${made ? 'empty file' : 'no file'} at ${tmpOut})`);
    await fs.rename(tmpOut, out);
    const bytes = (await fs.stat(out)).size;
    const res = { out, frames: p.frames, duration_ms: p.duration_ms, size: p.size, bytes, format: p.format, fps: p.fps, ffmpeg: bin };
    res.blocked_origins = cap.blocked_origins || [];
    if (res.blocked_origins.length) res.warnings = res.blocked_origins.map((x) => `blocked remote origin ${x}: its fonts/images/scripts are missing from the video`);
    if (o.keepFrames) res.frames_dir = framesDir;
    return res;
  } catch (e) {
    if (interrupted) { await signalDone; throw bad(`interrupted by ${interrupted}${kept}`, 1); }
    if (o.keepFrames && e && typeof e.message === 'string' && !e.message.includes(framesDir)) e.message += kept;
    throw e;
  } finally {
    if (!interrupted) for (const [s2, h] of handlers) sigTarget.removeListener(s2, h);
    await fs.rm(tmpOut, { force: true }).catch(() => {});
    if (!o.keepFrames) await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function run(args, io = {}) {
  const [sub, ...rest] = args;
  if (!sub || sub === '--help' || sub === '-h') return { usage };
  if (rest.includes('--help') || rest.includes('-h')) return { usage };
  if (sub === 'plan') {
    const f = parseFlags(rest, ['file', 'format', 'fps', 'max-seconds']);
    const { html, abs } = await readStory(f.file, io);
    return planStory({ html, file: abs, ...planOpts(f) });
  }
  if (sub === 'render') {
    const f = parseFlags(rest, ['file', 'out', 'format', 'fps', 'max-seconds', 'ffmpeg', 'encode-timeout-s'], ['keep-frames']);
    return render({ file: f.file, out: f.out, ffmpeg: f.ffmpeg, keepFrames: !!f['keep-frames'], encodeTimeoutS: intFlag(f, 'encode-timeout-s', 1, MAX_ENCODE_TIMEOUT_S, 0), ...planOpts(f) }, io);
  }
  if (sub === 'play') {
    const f = parseFlags(rest, ['file', 'format']);
    const { abs } = await readStory(f.file, io);
    const format = f.format === undefined ? 'square' : f.format;
    if (!Object.hasOwn(FORMATS, format)) throw bad(`--format must be square or wide, got ${JSON.stringify(String(format).slice(0, 40))}`);
    const url = pathToFileURL(abs).href;
    return {
      url, play_url: `${url}?play=1`, format, size: { ...FORMATS[format] },
      contract: 'A story page opened with the query ?play=1 runs live at real speed (real clock, animations running). Without it the page stays passive so story-render can step its clock.',
      next: `Open ${url}?play=1 in a browser window (this verb starts none). To make an MP4 instead: story-render render --file <story.html> --out <file.mp4>`,
    };
  }
  throw bad(`unknown subcommand "${sub}"; ${usage}`);
}
