/**
 * /bc status file: the markdown table of streams a project keeps outside the chat.
 *
 * The table is read by its header, so a project keeps its own column layout:
 *   | Stream | Where | Plan | State | Next | Phase | Skill | Tasks |
 * Only the first column (the stream) is required. "State and next step" in one column works too.
 * From it this module builds the keep-list (open streams only, never file contents), the resume
 * line, and the handoff stamp the PreCompact hook writes.
 */

const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
// Markdown decoration that carries no meaning in a one-line keep-list.
const plain = (v) => oneLine(v).replace(/`/g, '').replace(/\*\*/g, '');
const EMPTY = /^(—|-|–|n\/a|none)?$/i;

const FINISHED = /^\W*(done|finished|complete|completed|merged|shipped|closed|removed|dropped)\b/i;
const ACTIVE = /^\W*(active|running|in progress|in-progress|building|working)\b/i;

const HANDOFF_OPEN = '<!-- bc:handoff -->';
const HANDOFF_CLOSE = '<!-- /bc:handoff -->';

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const isTableLine = (line) => line.trim().startsWith('|');
const isSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

function columnIndex(headers, re) {
  return headers.findIndex(h => re.test(h));
}

/**
 * Parse the first stream table in a status file.
 * Returns rows of { name, state, next, phase, skill, tasks, finished, active }.
 * phase and skill come from their own columns, else from text such as "/pt phase 3" in the
 * state or next cell. A file with no table yields [].
 */
export function parseStatusTable(md) {
  const lines = String(md ?? '').split('\n');
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!isTableLine(lines[i]) || !isSeparator(lines[i + 1])) continue;
    const headers = splitRow(lines[i]).map(h => plain(h).toLowerCase());
    const col = {
      state: columnIndex(headers, /state|status/),
      next: columnIndex(headers, /next/),
      phase: columnIndex(headers, /phase/),
      skill: columnIndex(headers, /skill/),
      tasks: columnIndex(headers, /task/)
    };
    const rows = [];
    for (let j = i + 2; j < lines.length && isTableLine(lines[j]); j++) {
      const cells = splitRow(lines[j]);
      const get = (k) => (col[k] > -1 ? plain(cells[col[k]]) : '');
      const name = plain(cells[0]);
      if (!name) continue;
      const state = get('state');
      // A combined "State and next step" column is both: keep it as state, and as next when no next column exists.
      const next = col.next > -1 && col.next !== col.state ? get('next') : '';
      const text = `${state} ${next}`;
      const phase = get('phase') || (text.match(/\bphase\s+([\w.-]+)/i)?.[1] ?? '');
      const skill = (get('skill') || (text.match(/(?:^|[\s(])\/([a-z][\w-]*)(?=$|[\s,.;:)])/i)?.[1] ?? '')).replace(/^\//, '');
      const tasks = EMPTY.test(get('tasks')) ? [] : get('tasks').split(/[\s,]+/).filter(t => t && !EMPTY.test(t));
      rows.push({ name, state, next, phase, skill, tasks, finished: FINISHED.test(state), active: ACTIVE.test(state) });
    }
    return rows;
  }
  return [];
}

/**
 * The stream to continue: the first row marked active, else the first open row, else null.
 */
export function activeStream(rows) {
  return rows.find(r => r.active && !r.finished) || rows.find(r => !r.finished) || null;
}

function describe(row) {
  const detail = [row.state, row.next ? `next: ${row.next}` : '', row.phase ? `phase ${row.phase}` : '']
    .filter(Boolean).join('; ');
  return detail ? `${row.name} (${detail})` : row.name;
}

/**
 * One "/compact ..." line, no newline. It names the kickoff, the status file's open rows only,
 * the rules file, the last commit and running tasks. Finished rows are never named, and nothing
 * is quoted from a file: the line points at files that can be read again.
 */
export function buildKeepList({ kickoff, status, rules, rows = [], lastCommit, extraTasks = [] }) {
  const open = rows.filter(r => !r.finished);
  const tasks = [...new Set([...open.flatMap(r => r.tasks), ...extraTasks].map(oneLine).filter(Boolean))];
  const parts = [];
  if (kickoff) parts.push(`${kickoff} is the finish line`);
  parts.push(open.length ? `open streams per ${status}: ${open.map(describe).join(', ')}` : `status in ${status} (no open streams)`);
  if (rules) parts.push(`rules in ${rules}`);
  if (lastCommit) parts.push(`last commit ${oneLine(lastCommit)}`);
  parts.push(`running tasks: ${tasks.join(', ') || 'none'}`);
  return `/compact Keep only: ${parts.join('; ')}. Drop tool output, finished streams and file contents.`;
}

/**
 * The one line that gets a fresh or just-compacted session back to work. With plain: false a
 * markdown row for the stream follows on the next line, as the SessionStart hook prints it.
 */
export function resumeLine({ kickoff, status, rules, memory, row, plain: plainOnly = false }) {
  const files = [kickoff, status, rules].filter(Boolean);
  let sentence = `Read ${files.join(', ')}${memory ? ` and the memory index (${memory}/)` : ''}`;
  if (!row) {
    sentence += `, then continue the work ${status} marks as next — no stream in it is open.`;
    return sentence;
  }
  const next = row.next || row.state || `see its row in ${status}`;
  sentence += `, then continue stream "${row.name}" (next: ${next}).`;
  if (row.skill && row.phase) sentence += ` It was mid-run in /${row.skill} at phase ${row.phase}: reload that skill and continue from that phase.`;
  else if (row.skill) sentence += ` It was mid-run in /${row.skill}: reload that skill and continue.`;
  else if (row.phase) sentence += ` It was at phase ${row.phase}: continue from that phase.`;
  if (plainOnly) return sentence.replace(/\|/g, '/');
  const cell = (v) => oneLine(v).replace(/\|/g, '\\|') || '—';
  return `${sentence}\n| ${cell(row.name)} | ${cell(row.state)} | ${cell(row.phase)} | ${cell(row.next)} |`;
}

/**
 * Return the status file with its handoff stamp replaced (or appended when absent).
 * The rest of the file is never touched.
 */
export function stampStatus(md, { ts, trigger, branch, commit, uncommitted, tasks = [], pct = null }) {
  const bits = [`Last handoff ${ts}`, `trigger ${trigger}`, `branch ${branch}`, `commit ${commit}`, `${uncommitted} uncommitted file${uncommitted === 1 ? '' : 's'}`];
  if (pct !== null && pct !== undefined) bits.push(`context ${pct}%`);
  bits.push(`running tasks: ${tasks.length ? tasks.join(', ') : 'none'}`);
  const block = `${HANDOFF_OPEN}\n_${bits.join(' · ')}_\n${HANDOFF_CLOSE}`;
  const text = String(md ?? '');
  const start = text.indexOf(HANDOFF_OPEN);
  const end = text.indexOf(HANDOFF_CLOSE, start);
  if (start > -1 && end > -1) return text.slice(0, start) + block + text.slice(end + HANDOFF_CLOSE.length);
  const sep = text === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return `${text}${sep}${block}\n`;
}
