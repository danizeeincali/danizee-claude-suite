/**
 * image-gate — the approval gate a workflow step runs before it calls ANY image-generation tool (paid or not).
 * This verb never calls an image service and never touches the network: it only keeps a JSON ledger of requests and
 * the user's answers, so a step can ask once, wait for a yes, and refuse to run without one.
 *
 *   image-gate request --state <file> --prompt-file <txt> --model <name> --size <WxH> [--service <name>] [--asset <relative path>] [--est-cost <text>]
 *   image-gate approve --state <file> --id <id>
 *   image-gate decline --state <file> --id <id>
 *   image-gate check   --state <file> --id <id>
 *   image-gate used    --state <file> --id <id>
 *   image-gate slot    --width <n> --height <n> [--radius <px>]
 *   image-gate report  --state <file>
 *   image-gate status  --state <file>
 *
 * REQUEST. The prompt is read from a text file (never from argv; at most 8 MiB read, at most 20000 characters kept,
 * not empty, no NUL bytes). `--size` is WxH in pixels (for example 1024x1024). `--asset` is where the result is saved:
 * a relative path inside the project with an image extension (png, jpg, jpeg, webp, avif, gif, svg); absolute paths,
 * `..` segments, URLs, backslashes and temporary folders (tmp, temp, var/tmp, .tmp, .cache) are refused (exit 1),
 * because results go into the project's assets, not a temporary URL. Default asset: assets/generated/<id>.png.
 * The id is the first 12 hex of sha256 over prompt, model and size, so the same request always has the same id.
 * Output { id, status: "pending", show: { prompt, model, size, service, asset, est_cost }, question, next }:
 * `question` is the single yes/no to put to the user, with prompt, model and size in it; wait for the answer, then run
 * approve or decline. Asking again for an id that is still pending or already answered returns that record (no new
 * question when approved); an id already used returns `reroll: true`, status "used" and a warning: change the prompt
 * (judge the result against the one-sentence brief and the palette first) instead of rerolling the same one.
 *
 * APPROVE / DECLINE record the user's answer with a timestamp. Only a pending request can change: any other status
 * is refused (exit 2). An unknown id is exit 1.
 *
 * CHECK. Exit 0 { approved: true, id, status: "approved", show } only when approved. Exit 2 { approved: false, id,
 * status, next } for pending, declined, used or unknown (status "unknown"; also when the state file does not exist yet):
 * the workflow must not call the image tool. One approval covers one run: after the tool ran, call `used`; check then
 * exits 2 with status "used". USED marks an approved request consumed (exit 2 if it is not approved); a reroll needs a
 * new request.
 *
 * SLOT. For a declined or skipped image: { html, css, report_note }: an empty box of the exact width and height with
 * the layout radius, no text inside, aria-hidden. The prompt goes in the report, never on the page. `--radius`
 * defaults to 0; width and height are whole pixels from 1 to 20000, radius a number from 0 to 1000.
 *
 * REPORT lists requests still pending or declined, with prompt, model, size, service, asset and the file name to save
 * under, for the final report (so an unfinished placeholder cannot ship unnoticed). STATUS lists every request.
 * When no image tool is connected and a screen needs a scene or object, say so before the visuals pass, offer to
 * connect one, and name the kind of service that could generate it and the file name (show.asset) to save it under.
 *
 * STATE is a JSON file ({ version: 1, requests: { <id>: {...} } }) written by temp file + rename under the shared state
 * lock (./state-lock.js); check, report and status read without a lock. Unknown flags, duplicate flags, a flag without
 * a value, missing files, binary or oversize input and a corrupt state are exit 1 (message on stderr, nothing on stdout).
 * Exit codes: 0 answer printed, 1 bad input or broken state, 2 only from check (blocking) and refused state changes.
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { withStateLock, readJsonState, writeJsonAtomic } from './state-lock.js';

export const verb = 'image-gate';
export const usage = 'cli.js image-gate request --state <file> --prompt-file <txt> --model <name> --size <WxH> [--service <name>] [--asset <relative path>] [--est-cost <text>]  |  '
  + 'approve|decline|check|used --state <file> --id <id>  |  slot --width <n> --height <n> [--radius <px>]  |  report|status --state <file>   '
  + '(approval gate before any image-generation tool; never calls a service; request returns the one yes/no question to ask, check exits 0 only when approved and 2 otherwise, '
  + 'one approval covers one run (used), a reroll needs a changed prompt; slot gives an empty aria-hidden box of exact size and radius for a declined image; '
  + 'exit 0 done, 1 bad input or broken state, 2 check not approved or refused state change)';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT = 20000;
const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|svg)$/i;
const TMP_SEGMENTS = new Set(['tmp', 'temp', '.tmp', '.cache']);
const STATUSES = ['pending', 'approved', 'declined', 'used'];
const bad = (m) => new KitExit(m, 1);
const refused = (m) => new KitExit(m, 2);

export function idOf(prompt, model, size) {
  return crypto.createHash('sha256').update([prompt, model, size].join('\0')).digest('hex').slice(0, 12);
}

/** The asset path rule: relative, inside the project, an image file, not a temporary or remote location. */
export function checkAsset(a) {
  if (typeof a !== 'string' || !a.trim()) throw bad('--asset needs a non-empty relative path');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\\]/.test(a)) throw bad('--asset must not contain control characters or backslashes');
  if (/^[a-z][a-z0-9+.-]*:/i.test(a) || a.startsWith('//')) throw bad('--asset must be a path inside the project, not a URL or drive');
  if (a.startsWith('/') || a.startsWith('~')) throw bad('--asset must be a relative path inside the project (no absolute or home paths)');
  const parts = a.split('/');
  if (parts.some((p) => p === '..')) throw bad('--asset must stay inside the project (no ".." segments)');
  if (parts.some((p) => p === '')) throw bad('--asset has an empty path segment');
  const clean = parts.filter((p) => p !== '.');
  if (clean.some((p) => TMP_SEGMENTS.has(p.toLowerCase())) || /^var\/tmp(\/|$)/i.test(clean.join('/'))) throw bad('--asset must not point into a temporary folder: save results under the project assets');
  if (!IMAGE_EXT.test(clean[clean.length - 1] || '')) throw bad('--asset must end in an image extension (png, jpg, jpeg, webp, avif, gif, svg)');
  return clean.join('/');
}

function oneLine(name, v, max) {
  if (typeof v !== 'string' || !v.trim()) throw bad(`${name} needs a non-empty value`);
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(v)) throw bad(`${name} must not contain control characters`);
  if (v.length > max) throw bad(`${name} is longer than ${max} characters`);
  return v.trim();
}

const SPECS = {
  request: { flags: ['state', 'prompt-file', 'model', 'size', 'service', 'asset', 'est-cost'], required: ['state', 'prompt-file', 'model', 'size'] },
  approve: { flags: ['state', 'id'], required: ['state', 'id'] },
  decline: { flags: ['state', 'id'], required: ['state', 'id'] },
  check: { flags: ['state', 'id'], required: ['state', 'id'] },
  used: { flags: ['state', 'id'], required: ['state', 'id'] },
  slot: { flags: ['width', 'height', 'radius'], required: ['width', 'height'] },
  report: { flags: ['state'], required: ['state'] },
  status: { flags: ['state'], required: ['state'] }
};

function parseFlags(cmd, rest) {
  const spec = SPECS[cmd];
  const out = {};
  const args = [...rest];
  while (args.length) {
    const a = args.shift();
    if (!a.startsWith('--') || !spec.flags.includes(a.slice(2))) throw bad(`unexpected argument "${a}"\n${usage}`);
    const k = a.slice(2);
    if (k in out) throw bad(`--${k} given more than once`);
    if (!args.length || args[0].startsWith('--')) throw bad(`--${k} needs a value`);
    out[k] = args.shift();
    if (out[k] === '') throw bad(`--${k} needs a non-empty value`);
  }
  for (const k of spec.required) if (!(k in out)) throw bad(`--${k} is required\n${usage}`);
  return out;
}

// ================================================================ state

const emptyState = () => ({ version: 1, requests: {} });

function validateState(s, file) {
  const corrupt = (m) => bad(`image-gate state ${file} is corrupt: ${m}`);
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw corrupt('not an object');
  if (s.version !== 1) throw corrupt('unsupported version');
  if (!s.requests || typeof s.requests !== 'object' || Array.isArray(s.requests)) throw corrupt('requests is not an object');
  for (const [id, r] of Object.entries(s.requests)) {
    if (!r || typeof r !== 'object' || r.id !== id) throw corrupt(`request ${id}`);
    if (!STATUSES.includes(r.status)) throw corrupt(`request ${id} has an unknown status`);
    for (const k of ['prompt', 'model', 'size', 'asset', 'service']) if (typeof r[k] !== 'string') throw corrupt(`request ${id} lacks ${k}`);
  }
  return s;
}

async function loadState(file) {
  const parsed = await readJsonState(file, { fallback: null });
  return parsed === null ? emptyState() : validateState(parsed, file);
}

const showOf = (r) => ({ prompt: r.prompt, model: r.model, size: r.size, service: r.service, asset: r.asset, est_cost: r.est_cost ?? null });
const DEFAULT_SERVICE = 'any connected image-generation tool';

function questionOf(r) {
  const cost = r.est_cost ? ` Estimated cost: ${r.est_cost}.` : ' It may cost money.';
  return `Generate this image with ${r.service}? Prompt: "${r.prompt}" Model: ${r.model}. Size: ${r.size}.${cost} The result will be saved as ${r.asset}. Yes or no?`;
}

const summary = (r) => ({ id: r.id, status: r.status, ...showOf(r), requested_at: r.requested_at, answered_at: r.answered_at ?? null, used_at: r.used_at ?? null });

// ================================================================ subcommands

async function readPrompt(file, cwd) {
  const p = path.resolve(cwd, file);
  let fh;
  try { fh = await fs.open(p, 'r'); } catch (e) { throw bad(`cannot read ${p}: ${e.code || e.message}`); }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw bad(`${p} is not a regular file`);
    const buf = Buffer.alloc(Math.min(st.size, MAX_BYTES + 1));
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, null);
      if (!bytesRead) break;
      n += bytesRead;
    }
    if (n > MAX_BYTES) throw bad(`${p} is larger than 8 MiB`);
    const text = buf.subarray(0, n).toString('utf-8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    if (text.includes('\0')) throw bad(`${p} looks binary (contains NUL bytes)`);
    const prompt = text.trim();
    if (!prompt) throw bad(`${p} is empty: the prompt file needs the prompt text`);
    if (prompt.length > MAX_PROMPT) throw bad(`the prompt is longer than ${MAX_PROMPT} characters`);
    return prompt;
  } catch (e) {
    if (e instanceof KitExit) throw e;
    throw bad(`cannot read ${p}: ${e.code || e.message}`);
  } finally { await fh.close().catch(() => {}); }
}

async function doRequest(f, io, cwd, state) {
  const prompt = await readPrompt(f['prompt-file'], cwd);
  const model = oneLine('--model', f.model, 100);
  const size = f.size;
  if (!/^[1-9]\d{1,4}x[1-9]\d{1,4}$/.test(size)) throw bad('--size must look like 1024x1024 (width x height in pixels)');
  const service = f.service === undefined ? DEFAULT_SERVICE : oneLine('--service', f.service, 100);
  const estCost = f['est-cost'] === undefined ? null : oneLine('--est-cost', f['est-cost'], 200);
  const id = idOf(prompt, model, size);
  const asset = f.asset === undefined ? `assets/generated/${id}.png` : checkAsset(f.asset);
  return { prompt, model, size, service, estCost, id, asset };
}

function requestOutput(r, extra = {}) {
  const base = { id: r.id, status: r.status, show: showOf(r) };
  if (r.status === 'pending') {
    return { ...base, question: questionOf(r), next: `Ask the user this one yes/no question and wait. On yes run: image-gate approve --id ${r.id}; on no run: image-gate decline --id ${r.id} and leave an empty slot (image-gate slot), with the prompt in the report. Do not call the image tool before check exits 0.`, ...extra };
  }
  if (r.status === 'approved') return { ...base, question: null, next: `Already approved: check, run the image tool once, save the result as ${r.asset}, then run image-gate used --id ${r.id}.`, ...extra };
  if (r.status === 'declined') return { ...base, question: null, next: 'The user declined this one. Leave an empty slot (image-gate slot) and put the prompt in the report; change the prompt to ask again.', ...extra };
  return { ...base, question: null, reroll: true, warning: 'This exact request was already used. Do not reroll the same prompt: judge the result against the one-sentence brief and the palette, change the prompt, and request again.', next: 'Change the prompt, then run image-gate request with the new prompt file.', ...extra };
}

async function setStatus(file, id, to, from, io) {
  if (!/^[0-9a-f]{12}$/.test(id)) throw bad('--id must be the 12-hex id that request printed');
  return withStateLock(file, async () => {
    const state = await loadState(file);
    const r = state.requests[id];
    if (!r) throw bad(`no request ${id} in ${file}`);
    if (!from.includes(r.status)) throw refused(`request ${id} is ${r.status}; only ${from.join(' or ')} can become ${to}`);
    const at = new Date().toISOString();
    r.status = to;
    if (to === 'used') r.used_at = at; else r.answered_at = at;
    await writeJsonAtomic(file, state);
    return {
      id, status: to, at, show: showOf(r),
      next: to === 'approved' ? `Run the image tool once, save the result as ${r.asset}, then run image-gate used --id ${id}.`
        : to === 'declined' ? 'Leave an empty slot (image-gate slot) and put the prompt in the report (image-gate report).'
          : 'One approval covers one run. Judge the result against the brief and the palette; to try again, change the prompt and request again.'
    };
  }, io.lockOpts);
}

function doSlot(f) {
  const int = (name) => {
    if (!/^\d+$/.test(f[name])) throw bad(`--${name} must be a whole number of pixels`);
    const n = Number(f[name]);
    if (n < 1 || n > 20000) throw bad(`--${name} must be between 1 and 20000`);
    return n;
  };
  const width = int('width');
  const height = int('height');
  let radius = 0;
  if (f.radius !== undefined) {
    if (!/^\d+(\.\d+)?$/.test(f.radius)) throw bad('--radius must be a number of pixels, 0 or more');
    radius = Number(f.radius);
    if (radius > 1000) throw bad('--radius must be at most 1000');
  }
  return {
    html: '<div class="img-slot" aria-hidden="true"></div>',
    css: `.img-slot{display:block;box-sizing:border-box;flex:none;width:${width}px;height:${height}px;border-radius:${radius}px;background:transparent}`,
    width, height, radius,
    report_note: 'This slot is empty on purpose: the image was declined or skipped. Do not write the prompt, a caption or any text on the page; put the prompt, model, size and the file name to save it under in the final report (image-gate report), and replace the slot when the image exists.'
  };
}

function listOf(state, only) {
  return Object.values(state.requests).filter((r) => !only || only.includes(r.status))
    .sort((a, b) => String(a.requested_at).localeCompare(String(b.requested_at)) || a.id.localeCompare(b.id));
}

export async function run(args, io = {}) {
  const [cmd, ...rest] = args;
  if (!cmd || !Object.hasOwn(SPECS, cmd)) throw bad(`first argument must be one of ${Object.keys(SPECS).join(', ')}\n${usage}`);
  const f = parseFlags(cmd, rest);
  const cwd = io.cwd || process.cwd();
  if (cmd === 'slot') return doSlot(f);
  const file = path.resolve(cwd, f.state);

  if (cmd === 'status') {
    const items = listOf(await loadState(file)).map(summary);
    return { count: items.length, requests: items };
  }
  if (cmd === 'report') {
    const items = listOf(await loadState(file), ['pending', 'declined']).map((r) => ({
      ...summary(r), save_as: r.asset,
      note: r.status === 'declined' ? 'declined: empty slot on the page; give this prompt to the user in the report' : 'still waiting for a yes or no; do not ship without an answer'
    }));
    return { count: items.length, requests: items, next: items.length ? 'Put each prompt, model, size and save_as in the final report; none of it goes on the page.' : 'Nothing to report: no pending or declined image requests.' };
  }
  if (cmd === 'check') {
    if (!/^[0-9a-f]{12}$/.test(f.id)) throw bad('--id must be the 12-hex id that request printed');
    const r = (await loadState(file)).requests[f.id];
    if (!r) return { approved: false, id: f.id, status: 'unknown', next: 'No such request: do not call the image tool. Run image-gate request first.', exit: 2 };
    if (r.status === 'approved') return { approved: true, id: r.id, status: 'approved', show: showOf(r) };
    const why = { pending: 'Not answered yet: ask the user the question from request.', declined: 'The user declined: leave an empty slot.', used: 'Already used: one approval covers one run. Change the prompt and request again.' };
    return { approved: false, id: r.id, status: r.status, next: `Do not call the image tool. ${why[r.status]}`, exit: 2 };
  }
  if (cmd === 'approve') return setStatus(file, f.id, 'approved', ['pending'], io);
  if (cmd === 'decline') return setStatus(file, f.id, 'declined', ['pending'], io);
  if (cmd === 'used') return setStatus(file, f.id, 'used', ['approved'], io);

  // request
  const q = await doRequest(f, io, cwd);
  return withStateLock(file, async () => {
    const state = await loadState(file);
    const have = state.requests[q.id];
    if (have) return requestOutput(have);
    const r = { id: q.id, status: 'pending', prompt: q.prompt, model: q.model, size: q.size, service: q.service, asset: q.asset, est_cost: q.estCost, requested_at: new Date().toISOString() };
    state.requests[q.id] = r;
    await writeJsonAtomic(file, state);
    return requestOutput(r);
  }, io.lockOpts);
}
