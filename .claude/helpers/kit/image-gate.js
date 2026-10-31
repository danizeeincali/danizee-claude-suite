/**
 * image-gate — the approval gate a workflow step runs before it calls ANY image-generation tool (paid or not).
 * This verb never calls an image service and never touches the network: it only keeps a JSON ledger of requests and
 * the user's answers, so a step can ask once, wait for a yes, and refuse to run without one.
 *
 *   image-gate request --state <file> --prompt-file <txt> --model <name> --size <WxH> [--service <name>] [--asset <relative path>] [--est-cost <text>]
 *   image-gate approve --state <file> --id <id>
 *   image-gate decline --state <file> --id <id>
 *   image-gate check   --state <file> --prompt-file <txt> --model <name> --size <WxH> [--service <name>] [--asset <relative path>] [--est-cost <text>] [--id <id>]
 *   image-gate claim   (the same flags as check; an alias of check)
 *   image-gate used    --state <file> --id <id>
 *   image-gate release --state <file> --id <id>
 *   image-gate slot    --width <n> --height <n> [--radius <px>]
 *   image-gate report  --state <file>
 *   image-gate status  --state <file>
 *
 * REQUEST. The prompt is read from a text file (never from argv; at most 8 MiB read). Line ends become \n, trailing
 * spaces on each line are dropped, runs of blank lines collapse to one blank line, and the result is trimmed; it must
 * then be non-empty and at most 4000 characters. A prompt holding a control character other than newline and tab
 * (NUL, ESC and so ANSI escapes, DEL, C1 controls), a Unicode format character (bidi overrides and isolates, zero-width
 * spaces and joiners, soft hyphen, a BOM inside the text) or a line or paragraph separator is refused (exit 1), so the
 * prompt cannot hide text or redraw the question. --model, --service and --est-cost are one line with the same
 * characters refused. `--size` is WxH in pixels (for example 1024x1024). `--asset` is where the result is saved:
 * a relative path inside the project with an image extension (png, jpg, jpeg, webp, avif, gif, svg); absolute paths,
 * `..` segments, URLs, backslashes and temporary folders (tmp, temp, var/tmp, .tmp, .cache) are refused (exit 1),
 * because results go into the project's assets, not a temporary URL. Default asset: assets/generated/<12 hex of the id over the other five fields>.png.
 * The id is the first 12 hex of sha256 over every field the user is shown (prompt, model, size, service, est_cost and
 * asset), so the same request always has the same id and any change to one of them is a new request that needs its own
 * approval. The default asset is derived from the other five fields.
 * Output { id, status: "pending", show: { prompt, model, size, service, asset, est_cost }, question, next }:
 * `question` is the single yes/no to put to the user. It states the cost-relevant facts FIRST, one per line (service,
 * model, size, estimated cost, save as), and only then the prompt as a delimited block: a "Prompt (N lines):" line,
 * every prompt line prefixed with "| ", and an "(end of prompt)" line, then "Yes or no?". Prompt text can therefore
 * never stand where the facts stand. Wait for the answer, then run approve or decline. Asking again for an id that is
 * still pending or already answered returns that record (no new question when approved or claimed); an id already used
 * returns `reroll: true`, status "used" and a warning: change the prompt (judge the result against the one-sentence
 * brief and the palette first) instead of rerolling the same one.
 *
 * APPROVE / DECLINE record the user's answer with a timestamp. Only a pending request can change: any other status
 * is refused (exit 2). An unknown id is exit 1.
 *
 * CHECK takes the exact request the step is about to send (CLAIM is an alias): the same --prompt-file, --model, --size
 * (and the same --service, --asset and --est-cost if request had them; --id is optional and, when given, must equal the
 * recomputed id). The id is recomputed from those values, so a prompt file, model, size, service, cost or asset that
 * changed after approval is a different id and check exits 2 (status "unknown"). Check is SINGLE-USE: under the state
 * lock it moves an approved record to "claimed" (claimed_at) and exits 0 { approved: true, id, status: "claimed", show }
 * only for the one caller that made that move; send the image tool exactly show.prompt, show.model and show.size. Any
 * other check exits 2 { approved: false, id, status, next }: pending, declined, claimed (a second check, or a parallel
 * one that lost the race), used, unknown (also when the state file does not exist yet) or an --id that differs from
 * the recomputed one (status "mismatch"); the workflow must not call the image tool.
 * After the tool call: USED marks a claimed (or approved) request done (used_at); exit 2 for any other status. A reroll
 * needs a new request. RELEASE is for a tool call that failed before an image was made: it returns a claimed record to
 * approved (released_at), so the step may check once more without a new yes. It works once per request: a second
 * release, or a release of a record that is not claimed, is refused (exit 2); after that a failure needs a new request.
 * A crash between check and the tool call leaves the record claimed: release it only if no image was generated.
 *
 * SLOT. For a declined or skipped image: { html, css, report_note }: an empty box of the exact width and height with
 * the layout radius, no text inside, aria-hidden. The prompt goes in the report, never on the page. `--radius`
 * defaults to 0; width and height are whole pixels from 1 to 20000, radius a number from 0 to 1000.
 *
 * REPORT lists requests still pending, claimed (checked but never marked used or released) or declined, with prompt, model, size, service, asset and the file name to save
 * under, for the final report (so an unfinished placeholder cannot ship unnoticed). STATUS lists every request.
 * When no image tool is connected and a screen needs a scene or object, say so before the visuals pass, offer to
 * connect one, and name the kind of service that could generate it and the file name (show.asset) to save it under.
 *
 * STATE is a JSON file ({ version: 1, requests: { <id>: {...} } }) written by temp file + rename under the shared state
 * lock (./state-lock.js); check takes the lock to claim; report and status read without a lock. Unknown flags, duplicate flags, a flag without
 * a value, missing files, binary or oversize input and a corrupt state are exit 1 (a state is corrupt when a record's id is not the id recomputed from its content, or an
 * approved, claimed, declined or used record has no answered_at, a claimed record has no claimed_at, or used_at, claimed_at or released_at is not a string) (message on stderr, nothing on stdout).
 * Exit codes: 0 answer printed (check: this caller claimed the approval), 1 bad input or broken state, 2 only from check
 * (blocking: not claimed by this caller) and refused state changes (approve, decline, used, release).
 * Built from ideas audited by /w-bbs (run 2026-10-30-unslop); no foreign code.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { KitExit } from './kit-exit.js';
import { withStateLock, readJsonState, writeJsonAtomic } from './state-lock.js';

export const verb = 'image-gate';
export const usage = 'cli.js image-gate request --state <file> --prompt-file <txt> --model <name> --size <WxH> [--service <name>] [--asset <relative path>] [--est-cost <text>]  |  '
  + 'check --state <file> --prompt-file <txt> --model <name> --size <WxH> [--service <name>] [--asset <relative path>] [--est-cost <text>] [--id <id>]  |  '
  + 'claim (alias of check)  |  approve|decline|used|release --state <file> --id <id>  |  slot --width <n> --height <n> [--radius <px>]  |  report|status --state <file>   '
  + '(approval gate before any image-generation tool; never calls a service; request returns the one yes/no question to ask, check needs the exact request (prompt file, model, size, plus service, asset and est-cost if given) and exits 0 only for the one caller that claims its approved recomputed id (single-use), 2 otherwise, '
  + 'one approval covers one run: used after the tool ran, release (once) after a failed tool call, a reroll needs a changed prompt; slot gives an empty aria-hidden box of exact size and radius for a declined image; '
  + 'exit 0 done, 1 bad input or broken state, 2 check not approved or refused state change)';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT = 4000;
const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|svg)$/i;
const TMP_SEGMENTS = new Set(['tmp', 'temp', '.tmp', '.cache']);
const STATUSES = ['pending', 'approved', 'claimed', 'declined', 'used'];
// Refused in the prompt: C0 controls but tab and newline, DEL, C1 controls, format characters (bidi, zero-width, soft
// hyphen, BOM) and line/paragraph separators. One character class, so the scan is linear.
// eslint-disable-next-line no-control-regex
const PROMPT_BAD = /[\x00-\x08\x0b-\x1f\x7f-\x9f\p{Cf}\u2028\u2029]/u;
// eslint-disable-next-line no-control-regex
const LINE_BAD = /[\x00-\x1f\x7f-\x9f\p{Cf}\u2028\u2029]/u;
const describeChar = (c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
const bad = (m) => new KitExit(m, 1);
const refused = (m) => new KitExit(m, 2);

export function idOf(prompt, model, size, service, estCost, asset) {
  return crypto.createHash('sha256').update([prompt, model, size, service, estCost ?? '', asset].join('\0')).digest('hex').slice(0, 12);
}

/** The asset path rule: relative, inside the project, an image file, not a temporary or remote location. */
export function checkAsset(a) {
  if (typeof a !== 'string' || !a.trim()) throw bad('--asset needs a non-empty relative path');
  // eslint-disable-next-line no-control-regex
  if (/[\\]/.test(a) || LINE_BAD.test(a)) throw bad('--asset must not contain control or format characters or backslashes');
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
  const m = LINE_BAD.exec(v);
  if (m) throw bad(`${name} must not contain control or format characters (found ${describeChar(m[0])})`);
  if (v.length > max) throw bad(`${name} is longer than ${max} characters`);
  return v.trim();
}

const SPECS = {
  request: { flags: ['state', 'prompt-file', 'model', 'size', 'service', 'asset', 'est-cost'], required: ['state', 'prompt-file', 'model', 'size'] },
  approve: { flags: ['state', 'id'], required: ['state', 'id'] },
  decline: { flags: ['state', 'id'], required: ['state', 'id'] },
  check: { flags: ['state', 'prompt-file', 'model', 'size', 'service', 'asset', 'est-cost', 'id'], required: ['state', 'prompt-file', 'model', 'size'] },
  claim: { flags: ['state', 'prompt-file', 'model', 'size', 'service', 'asset', 'est-cost', 'id'], required: ['state', 'prompt-file', 'model', 'size'] },
  used: { flags: ['state', 'id'], required: ['state', 'id'] },
  release: { flags: ['state', 'id'], required: ['state', 'id'] },
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
    if (r.est_cost !== undefined && r.est_cost !== null && typeof r.est_cost !== 'string') throw corrupt(`request ${id} has a bad est_cost`);
    if (idOf(r.prompt, r.model, r.size, r.service, r.est_cost, r.asset) !== id) throw corrupt(`request ${id} does not match its content`);
    if (r.status !== 'pending' && typeof r.answered_at !== 'string') throw corrupt(`request ${id} is ${r.status} but has no answered_at`);
    if (r.status === 'claimed' && typeof r.claimed_at !== 'string') throw corrupt(`request ${id} is claimed but has no claimed_at`);
    for (const k of ['claimed_at', 'used_at', 'released_at']) if (r[k] !== undefined && r[k] !== null && typeof r[k] !== 'string') throw corrupt(`request ${id} has a bad ${k}`);
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
  const lines = r.prompt.split('\n');
  return [
    'Generate one image? The facts first:',
    `Service: ${r.service}`,
    `Model: ${r.model}`,
    `Size: ${r.size}`,
    `Estimated cost: ${r.est_cost || 'not known; it may cost money'}`,
    `Saved as: ${r.asset}`,
    `Prompt (${lines.length} line${lines.length === 1 ? '' : 's'}, each starting with "| "):`,
    ...lines.map((l) => `| ${l}`),
    '(end of prompt)',
    'Yes or no?'
  ].join('\n');
}

const summary = (r) => ({ id: r.id, status: r.status, ...showOf(r), requested_at: r.requested_at, answered_at: r.answered_at ?? null, claimed_at: r.claimed_at ?? null, used_at: r.used_at ?? null, released_at: r.released_at ?? null });

/** Normalise and vet the prompt text: refuse hidden or terminal-control characters, drop trailing spaces per line,
 * collapse blank-line runs to one blank line, trim. Linear in the input. */
export function cleanPrompt(raw, where = 'the prompt') {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (text.includes('\0')) throw bad(`${where} looks binary (contains NUL bytes)`);
  const m = PROMPT_BAD.exec(text);
  if (m) throw bad(`${where} contains a control or format character (${describeChar(m[0])}); only plain text, newlines and tabs are allowed`);
  const out = [];
  let blank = false;
  for (const line of text.split('\n')) {
    const l = line.trimEnd();
    if (!l) { blank = true; continue; }
    if (blank && out.length) out.push('');
    blank = false;
    out.push(l);
  }
  return out.join('\n').trim();
}

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
    const prompt = cleanPrompt(buf.subarray(0, n).toString('utf-8'), p);
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
  const asset = f.asset === undefined ? `assets/generated/${idOf(prompt, model, size, service, estCost, '')}.png` : checkAsset(f.asset);
  const id = idOf(prompt, model, size, service, estCost, asset);
  return { prompt, model, size, service, estCost, id, asset };
}

function requestOutput(r, extra = {}) {
  const base = { id: r.id, status: r.status, show: showOf(r) };
  if (r.status === 'pending') {
    return { ...base, question: questionOf(r), next: `Ask the user this one yes/no question and wait. On yes run: image-gate approve --id ${r.id}; on no run: image-gate decline --id ${r.id} and leave an empty slot (image-gate slot), with the prompt in the report. Do not call the image tool before check exits 0.`, ...extra };
  }
  if (r.status === 'approved') return { ...base, question: null, next: `Already approved: check (it claims the approval once), run the image tool once, save the result as ${r.asset}, then run image-gate used --id ${r.id} (or image-gate release --id ${r.id} if the tool failed).`, ...extra };
  if (r.status === 'claimed') return { ...base, question: null, next: `Claimed by a check: a run is in flight. When it saved ${r.asset} run image-gate used --id ${r.id}; if the tool failed and no image was made run image-gate release --id ${r.id} (once).`, ...extra };
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
    if (to === 'approved' && r.status === 'claimed') {
      if (r.released_at) throw refused(`request ${id} was already released once (${r.released_at}); a failed run now needs a new request and a new yes`);
      r.released_at = at;
    } else if (to === 'used') r.used_at = at; else r.answered_at = at;
    r.status = to;
    await writeJsonAtomic(file, state);
    return {
      id, status: to, at, show: showOf(r),
      next: to === 'approved' && r.released_at === at ? `Released once: check again (it claims the approval), run the image tool once, then used --id ${id}. A second failure needs a new request.`
        : to === 'approved' ? `Run image-gate check (it claims the approval once), run the image tool once, save the result as ${r.asset}, then run image-gate used --id ${id}.`
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
    const items = listOf(await loadState(file), ['pending', 'claimed', 'declined']).map((r) => ({
      ...summary(r), save_as: r.asset,
      note: r.status === 'declined' ? 'declined: empty slot on the page; give this prompt to the user in the report'
        : r.status === 'claimed' ? 'claimed by a check but never marked used or released: confirm whether the image was saved'
          : 'still waiting for a yes or no; do not ship without an answer'
    }));
    return { count: items.length, requests: items, next: items.length ? 'Put each prompt, model, size and save_as in the final report; none of it goes on the page.' : 'Nothing to report: no pending, claimed or declined image requests.' };
  }
  if (cmd === 'check' || cmd === 'claim') {
    if (f.id !== undefined && !/^[0-9a-f]{12}$/.test(f.id)) throw bad('--id must be the 12-hex id that request printed');
    const q = await doRequest(f, io, cwd);
    if (f.id !== undefined && f.id !== q.id) return { approved: false, id: q.id, status: 'mismatch', next: `The request you are about to send has id ${q.id}, not ${f.id}: it differs from what was approved. Do not call the image tool; run image-gate request for this exact request and ask again.`, exit: 2 };
    const unknown = { approved: false, id: q.id, status: 'unknown', next: 'No approved request matches this exact prompt, model, size, service, cost and asset: do not call the image tool. Run image-gate request first (a changed request needs a new approval).', exit: 2 };
    const why = { pending: 'Not answered yet: ask the user the question from request.', declined: 'The user declined: leave an empty slot.',
      claimed: 'Already claimed by an earlier check: one approval covers one run. If that run failed before an image was made, run image-gate release --id <id> once; otherwise ask for a new approval.',
      used: 'Already used: one approval covers one run. Change the prompt and request again.' };
    const blocked = (r) => ({ approved: false, id: r.id, status: r.status, next: `Do not call the image tool. ${why[r.status].replace('<id>', r.id)}`, exit: 2 });
    const peek = await loadState(file);
    const seen = Object.hasOwn(peek.requests, q.id) ? peek.requests[q.id] : undefined;
    if (!seen) return unknown;
    if (seen.status !== 'approved') return blocked(seen);
    return withStateLock(file, async () => {
      const state = await loadState(file);
      const r = Object.hasOwn(state.requests, q.id) ? state.requests[q.id] : undefined;
      if (!r) return unknown;
      if (r.status !== 'approved') return blocked(r);
      r.status = 'claimed';
      r.claimed_at = new Date().toISOString();
      await writeJsonAtomic(file, state);
      return { approved: true, id: r.id, status: 'claimed', claimed_at: r.claimed_at, show: showOf(r),
        next: `This call claimed the approval: run the image tool once with exactly show.prompt, show.model and show.size, save the result as ${r.asset}, then run image-gate used --id ${r.id}. If the tool failed and no image was made, run image-gate release --id ${r.id} (works once).` };
    }, io.lockOpts);
  }
  if (cmd === 'approve') return setStatus(file, f.id, 'approved', ['pending'], io);
  if (cmd === 'decline') return setStatus(file, f.id, 'declined', ['pending'], io);
  if (cmd === 'used') return setStatus(file, f.id, 'used', ['claimed', 'approved'], io);
  if (cmd === 'release') return setStatus(file, f.id, 'approved', ['claimed'], io);

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
