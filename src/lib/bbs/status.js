/**
 * bbs status — step ordering, run summary and the status.md rendering.
 */

import fs from 'fs/promises';
import path from 'path';
import { readJson, readJsonl } from './store.js';

export const STEPS = ['intake', 'fetch', 'inventory', 'map', 'verdict', 'handoff'];

export const DECISIONS = ['rebuild', 'use', 'buy', 'skip'];

/** A power is decided only when its decision is one of DECISIONS. */
export const isDecision = (v) => typeof v === 'string' && DECISIONS.includes(v);

const names = (state) => (state.powers?.powers || []).map(p => p.name);

export function nextStep(state) {
  const s = state.source;
  if (!s) return 'intake';
  if (s.identity === 'pending' || !s.fetched) return 'fetch';
  if (!state.powers) return 'inventory';
  const list = names(state);
  const judgments = state.map?.judgments;
  if (!state.map || list.some(n => !judgments || judgments[n] === undefined)) return 'map';
  const decisions = state.verdicts?.decisions;
  if (!state.verdicts || list.some(n => !decisions || !isDecision(decisions[n]))) return 'verdict';
  if (!state.handoff) return 'handoff';
  return 'done';
}

export function summary(state) {
  const list = names(state);
  const decisions = state.verdicts?.decisions || {};
  const c = { rebuild: 0, use: 0, buy: 0, skip: 0 };
  let decided = 0;
  for (const n of list) {
    const d = decisions[n];
    if (isDecision(d)) { c[d]++; decided++; }
  }
  return {
    found: list.length,
    not_inventoried: (state.powers?.not_inventoried || []).length,
    approved: c.rebuild + c.use + c.buy,
    rebuild: c.rebuild, use: c.use, buy: c.buy, skip: c.skip,
    undecided: list.length - decided,
    marathon: state.handoff?.marathonRun ?? null
  };
}

const esc = (v) => String(v).replace(/\|/g, '\\|');

export function renderStatus(state) {
  const s = state.source;
  const next = nextStep(state);
  const sum = summary(state);
  const egress = state.egress || [];
  const requests = egress.filter(e => e && (e.kind === 'http' || e.kind === 'git'));
  const hosts = [...new Set(requests.map(e => e.host).filter(Boolean))];
  const bytesIn = egress.reduce((n, e) => n + (Number(e.bytes_in) || 0), 0);
  const lines = [`# bbs ${state.run}`, ''];
  if (s) {
    lines.push(`- Source: ${s.type} ${esc(s.ref)}${s.reuse_from ? ` (reuses ${s.reuse_from})` : ''}`);
    lines.push(`- Identity: ${s.identity}`);
  } else {
    lines.push('- Source: none');
    lines.push('- Identity: none');
  }
  lines.push(`- Egress: requests=${requests.length} bytes_in=${bytesIn} bodies_sent=0 hosts=${hosts.length ? hosts.join(',') : 'none'}`);
  if (next === 'done') {
    lines.push(sum.marathon ? `- Next: done — /w-marathon --resume ${sum.marathon}` : '- Next: done');
  } else {
    lines.push(`- Next: \`cli.js ${next}\``);
  }
  lines.push('', '| Step | State | Detail |', '| --- | --- | --- |');
  const at = next === 'done' ? STEPS.length : STEPS.indexOf(next);
  const detail = {
    intake: s ? `${s.type}` : '',
    fetch: s ? (s.fetched ? 'fetched' : 'not fetched') : '',
    inventory: state.powers ? `${sum.found} powers (${sum.not_inventoried} not inventoried)` : '',
    map: state.map ? `${Object.keys(state.map.judgments || {}).length} judged` : '',
    verdict: state.verdicts ? `${sum.approved} approved, ${sum.skip} skipped, ${sum.undecided} undecided` : '',
    handoff: sum.marathon ? esc(sum.marathon) : ''
  };
  STEPS.forEach((step, i) => {
    const st = i < at ? 'done' : i === at ? 'next' : 'pending';
    lines.push(`| ${step} | ${st} | ${st === 'done' ? detail[step] : ''} |`);
  });
  lines.push('', `- Summary: found=${sum.found} approved=${sum.approved} skipped=${sum.skip} buy=${sum.buy} marathon=${sum.marathon || 'none'}`, '');
  return lines.join('\n');
}

export async function loadState(runDir) {
  const j = (f) => readJson(path.join(runDir, f), null);
  return {
    run: path.basename(runDir),
    source: await j('source.json'),
    egress: await readJsonl(path.join(runDir, 'egress.jsonl')),
    powers: await j('powers.json'),
    map: await j('map.json'),
    verdicts: await j('verdicts.json'),
    handoff: await j('handoff.json')
  };
}

export async function renderStatusFile(runDir) {
  const state = await loadState(runDir);
  const md = renderStatus(state);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'status.md'), md);
  return md;
}
