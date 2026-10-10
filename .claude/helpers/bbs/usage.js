/**
 * bbs usage — which workflows the owner actually runs, so a power is never wired into a workflow by guesswork.
 *
 * Evidence, in order of preference:
 *   transcripts  local Claude Code session transcripts (`~/.claude/projects/**\/*.jsonl` by default): a slash
 *                command the owner typed (`<command-name>/x</command-name>` in a user turn) and a `Skill` tool call
 *                (`input.skill`) in an assistant turn
 *   owner        the owner's own list (`--workflows a,b`), for a machine with no transcripts or to override them
 *   none         neither: legal, but the verdict question must then ask the owner to name the workflows
 *
 * Only names, counts, session counts and the last-used time are kept. Message text, arguments and transcript
 * paths are never stored. Reads only; no network.
 */

import fs from 'fs/promises';
import { createReadStream } from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { DEFAULT_CONFIG } from './config.js';
import { runDir as runDirOf, writeJson, readJson } from './store.js';

export const EVIDENCE = ['transcripts', 'owner', 'none'];
export const DEFAULT_DAYS = 90;
export const DEFAULT_ROOTS = ['~/.claude/projects'];
/** A transcript line longer than this (in characters) is skipped unparsed: a command marker never needs a multi-megabyte line. */
export const MAX_LINE_CHARS = 4 * 1024 * 1024;
const NAME = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)*$/i;
const ALIAS = /^#\s*\/([a-z0-9][a-z0-9._-]*)\s+[—-]+\s+alias for\s+\/([a-z0-9][a-z0-9._:-]*)/i;

export const expandHome = (p) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

/**
 * The installed workflows: every `.md` under `.claude/commands/`. `.shortcuts/x.md` is `x`; `ns/x.md` is `ns:x`.
 * An alias file (`# /bc — alias for /w-background-compound`) maps to its target.
 * Returns Map<name, { file, aliasOf: string|null }> with `file` relative to the project.
 */
export async function installedWorkflows(projectDir) {
  const root = path.join(projectDir, '.claude', 'commands');
  const out = new Map();
  async function walk(dir, ns) {
    let ents;
    try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(p, ns === null ? e.name : `${ns}/${e.name}`); continue; }
      if (!e.isFile() || !e.name.endsWith('.md')) continue;
      const base = e.name.slice(0, -3);
      const name = ns === null || ns === '.shortcuts' ? base : `${ns.replace(/\//g, ':')}:${base}`;
      let aliasOf = null;
      try {
        const head = (await fs.readFile(p, 'utf-8')).split('\n', 1)[0];
        const m = ALIAS.exec(head);
        if (m && m[1].toLowerCase() === base.toLowerCase()) aliasOf = m[2];
      } catch { /* unreadable: still installed, just not an alias */ }
      out.set(name, { file: path.relative(projectDir, p).split(path.sep).join('/'), aliasOf });
    }
  }
  await walk(root, null);
  return out;
}

/** Resolve a typed or Skill name to an installed workflow: strip `/` and `.shortcuts:`, follow one alias hop. */
export function resolveName(raw, installed) {
  let name = String(raw).trim().replace(/^\//, '').replace(/^\.shortcuts:/, '');
  if (!NAME.test(name)) return { workflow: null, via: null };
  const via = name;
  const hit = installed.get(name);
  if (!hit) return { workflow: null, via };
  if (hit.aliasOf && installed.has(hit.aliasOf)) return { workflow: hit.aliasOf, via };
  return { workflow: name, via };
}

async function listTranscripts(root, sinceMs) {
  const out = [];
  async function walk(dir, depth) {
    if (depth > 4) return;
    let ents;
    try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      // a subagent's transcript is work a workflow delegated, not a session the owner ran
      if (e.isDirectory()) { if (e.name !== 'subagents') await walk(p, depth + 1); }
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try { const st = await fs.stat(p); if (st.mtimeMs >= sinceMs) out.push(p); } catch { /* vanished */ }
      }
    }
  }
  await walk(root, 0);
  return out.sort();
}

/** The names one parsed transcript row invokes: typed slash commands (user turns) and Skill calls (assistant turns). */
export function invocations(row) {
  const names = [];
  const msg = row && typeof row === 'object' ? row.message : null;
  if (!msg || row.isSidechain === true) return names;
  const parts = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : Array.isArray(msg.content) ? msg.content : [];
  if (row.type === 'user') {
    for (const p of parts) {
      if (p?.type !== 'text' || typeof p.text !== 'string') continue;
      // the command tags open the turn, in either order: <command-message>…</command-message> may come first
      const head = p.text.replace(/^(\s*<command-(?:message|args)>[^<]*<\/command-(?:message|args)>)+/, '');
      const m = /^\s*<command-name>\/?([^<\s]+)<\/command-name>/.exec(head);
      if (m) names.push({ name: m[1], kind: 'typed' });
    }
  } else if (row.type === 'assistant') {
    for (const p of parts) {
      if (p?.type === 'tool_use' && p.name === 'Skill' && typeof p.input?.skill === 'string') names.push({ name: p.input.skill, kind: 'skill' });
    }
  }
  return names;
}

/** Invocations of one workflow closer than this are one use: a typed `/mt` and the Skill hops it triggers. */
export const HOP_MS = 120000;

/**
 * Count workflow use across transcripts. A typed `/mt`, its Skill call and the alias's own Skill hop to
 * `w-marathon` are one use: within a session an invocation less than HOP_MS after the previous invocation of the
 * same workflow is a hop, not a new use. An invocation without a timestamp after one of the same workflow is a hop.
 */
export async function scanUsage(projectDir, { roots = DEFAULT_ROOTS, days = DEFAULT_DAYS, now = () => new Date() } = {}) {
  const installed = await installedWorkflows(projectDir);
  const sinceMs = now().getTime() - days * 86400000;
  const per = new Map(); // workflow -> { typed, skill, sessions:Set, last, via:Map }
  const other = new Map();
  let filesRead = 0;
  let linesSkipped = 0;
  for (const r of roots) {
    for (const file of await listTranscripts(path.resolve(expandHome(r)), sinceMs)) {
      filesRead++;
      const session = new Map(); // workflow -> { typed, skill, last, via }
      const rl = readline.createInterface({ input: createReadStream(file, { encoding: 'utf-8' }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (line.length > MAX_LINE_CHARS) { linesSkipped++; continue; }
        if (!line.includes('<command-name>') && !line.includes('"Skill"')) continue;
        let row;
        try { row = JSON.parse(line); } catch { linesSkipped++; continue; }
        const ts = typeof row.timestamp === 'string' && !Number.isNaN(Date.parse(row.timestamp)) ? row.timestamp : null;
        if (ts && Date.parse(ts) < sinceMs) continue;
        for (const inv of invocations(row)) {
          const { workflow, via } = resolveName(inv.name, installed);
          if (!workflow) { if (via) other.set(via, (other.get(via) || 0) + 1); continue; }
          const s = session.get(workflow) || { uses: 0, prev: undefined, last: null, via: new Map(), useVia: null, hopVia: false };
          const t = ts ? Date.parse(ts) : null;
          const hop = s.prev !== undefined && (t === null || (s.prev !== null && t - s.prev < HOP_MS));
          if (!hop) { s.uses++; s.via.set(via, (s.via.get(via) || 0) + 1); s.useVia = via; s.hopVia = inv.kind === 'skill'; }
          else if (inv.kind === 'typed' && s.hopVia) {
            // the typed name is the one the owner used: it replaces the Skill name this use was first seen by
            const n = s.via.get(s.useVia);
            if (n <= 1) s.via.delete(s.useVia); else s.via.set(s.useVia, n - 1);
            s.via.set(via, (s.via.get(via) || 0) + 1);
            s.useVia = via;
            s.hopVia = false;
          }
          if (t !== null || s.prev === undefined) s.prev = t;
          if (ts && (!s.last || ts > s.last)) s.last = ts;
          session.set(workflow, s);
        }
      }
      for (const [w, s] of session) {
        const agg = per.get(w) || { count: 0, sessions: 0, last: null, via: new Map() };
        agg.count += s.uses;
        agg.sessions++;
        if (s.last && (!agg.last || s.last > agg.last)) agg.last = s.last;
        for (const [v, n] of s.via) agg.via.set(v, (agg.via.get(v) || 0) + n);
        per.set(w, agg);
      }
    }
  }
  const workflows = [...per.entries()]
    .map(([name, a]) => ({ name, count: a.count, sessions: a.sessions, last_used: a.last, file: installed.get(name)?.file ?? null,
      via: Object.fromEntries([...a.via.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))) }))
    .sort((a, b) => b.count - a.count || b.sessions - a.sessions || a.name.localeCompare(b.name));
  return {
    evidence: workflows.length ? 'transcripts' : 'none',
    window_days: days,
    files_read: filesRead,
    lines_skipped: linesSkipped,
    workflows,
    other: Object.fromEntries([...other.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20)),
    installed: installed.size
  };
}

/** The owner's own list: every name must resolve to an installed workflow (aliases allowed). */
export async function ownerUsage(projectDir, list) {
  const installed = await installedWorkflows(projectDir);
  const names = String(list).split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) throw new Error('--workflows needs at least one workflow name, e.g. --workflows w-marathon,bc');
  const seen = new Map();
  const unknown = [];
  for (const n of names) {
    const { workflow, via } = resolveName(n, installed);
    if (!workflow) { unknown.push(n); continue; }
    const row = seen.get(workflow) || { name: workflow, count: null, sessions: null, last_used: null, file: installed.get(workflow).file, via: {} };
    row.via[via] = null;
    seen.set(workflow, row);
  }
  if (unknown.length) throw new Error(`not an installed workflow: ${unknown.join(', ')} (names come from .claude/commands/)`);
  return { evidence: 'owner', window_days: null, files_read: 0, lines_skipped: 0, workflows: [...seen.values()], other: {}, installed: installed.size };
}

/** Write usage.json for a run. Refuses to overwrite without force. */
export async function recordUsage(projectDir, { run, roots, days, workflows, now = () => new Date(), force = false, cfg = DEFAULT_CONFIG }) {
  const dir = runDirOf(projectDir, run, cfg);
  const file = path.join(dir, 'usage.json');
  if (!force) {
    let prior;
    try { prior = await readJson(file); } catch (err) { throw new Error(`${err.message} — pass --force to recount and replace it`); }
    if (prior) throw new Error(`usage.json already exists for run ${run}; pass --force to recount`);
  }
  const result = workflows !== undefined
    ? await ownerUsage(projectDir, workflows)
    : await scanUsage(projectDir, { roots: roots?.length ? roots : (cfg.usage?.roots || DEFAULT_ROOTS), days: days ?? cfg.usage?.days ?? DEFAULT_DAYS, now });
  const data = { run, ts: now().toISOString(), ...result };
  await writeJson(file, data);
  return {
    run,
    evidence: data.evidence,
    files_read: data.files_read,
    used: data.workflows.length,
    top: data.workflows.slice(0, 10).map(w => w.count === null ? w.name : `${w.name}=${w.count}`),
    note: data.evidence === 'none'
      ? 'no workflow use found: the verdict question must ask the owner which workflows they use (workflows=a,b)'
      : undefined
  };
}

/** One line per used workflow, for briefs and the verdict step. */
export function usageLines(usage) {
  if (!usage || usage.evidence === 'none') return ['(no evidence of which workflows the owner uses: ask them)'];
  return usage.workflows.map(w => w.count === null
    ? `- ${w.name} (named by the owner) — ${w.file}`
    : `- ${w.name}: ${w.count} uses in ${w.sessions} sessions, last ${w.last_used ? w.last_used.slice(0, 10) : 'unknown'} — ${w.file}`);
}
