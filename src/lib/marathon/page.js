/**
 * Marathon run page
 * Self-contained HTML snapshot of a run: gate, streams, reviews, helper spend.
 */

import { foldHelpers } from './store.js';
import { normalizeTasks } from './status.js';

/**
 * Escape text for HTML element content and attribute values.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const e = escapeHtml;

const STATUS_TEXT = { waiting_on_human: 'waiting on human', not_counted: 'not counted' };
const STATUS_CLASS = { met: 'ok', failing: 'bad', waiting_on_human: 'warn', not_counted: 'muted' };
const statusText = (s) => STATUS_TEXT[s] ?? String(s ?? '');
const show = (v) => (v == null ? '—' : String(v));

const CSS = `
:root {
  --bg: #ffffff;
  --fg: #1b1f24;
  --muted: #5f6b76;
  --line: #d8dee4;
  --ok: #1a7f37;
  --warn: #9a6700;
  --bad: #cf222e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --fg: #e6edf3;
    --muted: #8b98a5;
    --line: #30363d;
    --ok: #3fb950;
    --warn: #d29922;
    --bad: #f85149;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 64rem; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
h2 { font-size: 1.1rem; margin: 32px 0 8px; }
p { margin: 4px 0; }
.muted { color: var(--muted); }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; white-space: nowrap; }
.ok { color: var(--ok); font-weight: 600; }
.warn { color: var(--warn); font-weight: 600; }
.bad { color: var(--bad); font-weight: 600; }
`;

function table(headers, rows, empty) {
  if (rows.length === 0) return `<p class="muted">${e(empty)}</p>`;
  const head = headers.map(h => `<th scope="col">${e(h)}</th>`).join('');
  const body = rows.map(r => `<tr>${r.join('')}</tr>`).join('\n');
  return `<div class="scroll"><table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table></div>`;
}

const td = (v, cls) => `<td${cls ? ` class="${cls}"` : ''}>${e(v)}</td>`;

const amount = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Helper spend grouped by model: tokens of done helpers, stated budgets of
// in-flight ones. A helper with no model counts under 'unknown'.
function helperSpend(helpers) {
  const byModel = new Map();
  for (const h of foldHelpers(helpers).values()) {
    const model = h.model ?? 'unknown';
    const m = byModel.get(model) ?? { model, helpers: 0, done: 0, tokens: 0, inFlight: 0 };
    m.helpers += 1;
    if (h.done) {
      m.done += 1;
      m.tokens += amount(h.tokens);
    } else {
      m.inFlight += amount(h.budget);
    }
    byModel.set(model, m);
  }
  return [...byModel.values()];
}

/**
 * Render the run page as a complete HTML document.
 */
export function renderPage({ runId, gate = {}, streams = [], reviews = [], helpers = [] }) {
  const lines = gate.lines ?? [];
  const waiting = gate.waitingOnHuman ?? [];
  const failing = gate.failing ?? [];
  const met = (b) => (b ? '<span class="ok">met</span>' : '<span class="bad">not met</span>');

  const gateRows = lines.map(l => {
    const target = l.value == null ? '—' : `${String(l.op ?? '').replace(/_/g, ' ')} ${l.value}`;
    return [
      td(l.label ?? l.id),
      td(l.owner),
      td(target),
      td(show(l.actual)),
      td(statusText(l.status), STATUS_CLASS[l.status])
    ];
  });

  const streamRows = streams.map(s => [
    td(s.name),
    td(s.state),
    td(`${s.skill ? '/' + s.skill + ' · ' : ''}${s.phase || ''}`),
    td(s.next),
    td(normalizeTasks(s.tasks).join(', '))
  ]);

  const reviewRows = reviews.map(r => {
    const c = r.counts ?? {};
    return [
      td(r.id),
      td(r.stream),
      td(r.round),
      td(r.pass ? 'pass' : 'over', r.pass ? 'ok' : 'bad'),
      td(`${c.high ?? 0} / ${c.medium ?? 0} / ${c.low ?? 0}`),
      td(r.ts)
    ];
  });

  const spendRows = helperSpend(helpers).map(m => [
    td(m.model),
    td(m.helpers),
    td(m.done),
    td(m.tokens.toLocaleString('en-US')),
    td(m.inFlight.toLocaleString('en-US'))
  ]);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Marathon ${e(runId)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>Marathon ${e(runId)}</h1>
<p class="muted">Snapshot of the run: finish line, streams, review ledger and helper spend.</p>

<h2>Gate</h2>
<p>Build gate: ${met(gate.buildGateMet)} · Full gate: ${met(gate.gateMet)}</p>
<p class="muted">Failing: ${e(failing.join(', ') || 'none')} · Waiting on human: ${e(waiting.join(', ') || 'none')}</p>
${table(['Line', 'Owner', 'Target', 'Actual', 'Status'], gateRows, 'No finish line configured.')}

<h2>Streams</h2>
${table(['Stream', 'State', 'Phase', 'Next', 'Tasks'], streamRows, 'No streams yet.')}

<h2>Review ledger</h2>
${table(['Review', 'Stream', 'Round', 'Result', 'High / medium / low', 'Time'], reviewRows, 'No reviews yet.')}

<h2>Helper spend by model</h2>
${table(['Model', 'Helpers', 'Done', 'Tokens used', 'Tokens budgeted in flight'], spendRows, 'No helpers spawned.')}
</main>
</body>
</html>
`;
}
