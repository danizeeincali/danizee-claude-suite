/**
 * Marathon deadlines — the stop condition of a timed run (/w-marathon-times, /w-bug-hunt).
 *
 * A time spec is either a duration ("5h", "90m", "1h30m", "2.5 hours") counted from now,
 * or a clock time with a time zone ("12pm PST", "17:30 Europe/London", "tomorrow 9am ET",
 * "2026-10-23 08:00 UTC"). Both parse to one absolute deadline. The model never does the
 * arithmetic: `cli.js deadline` says how much time is left and whether to wrap up.
 *
 * US zone abbreviations name the zone, not the offset: "PST" in October means Pacific
 * wall-clock time (PDT then), which is what a person typing "12pm PST" means.
 */

export const MAX_MINUTES = 7 * 24 * 60; // the in-session wake-up expires after seven days
export const MIN_MINUTES = 1;

export const TZ_ALIASES = {
  PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles', PT: 'America/Los_Angeles', PACIFIC: 'America/Los_Angeles',
  MST: 'America/Denver', MDT: 'America/Denver', MT: 'America/Denver', MOUNTAIN: 'America/Denver',
  CST: 'America/Chicago', CDT: 'America/Chicago', CT: 'America/Chicago', CENTRAL: 'America/Chicago',
  EST: 'America/New_York', EDT: 'America/New_York', ET: 'America/New_York', EASTERN: 'America/New_York',
  AKST: 'America/Anchorage', AKDT: 'America/Anchorage', HST: 'Pacific/Honolulu',
  UTC: 'UTC', GMT: 'UTC', Z: 'UTC',
  BST: 'Europe/London', CET: 'Europe/Berlin', CEST: 'Europe/Berlin',
  JST: 'Asia/Tokyo', AEST: 'Australia/Sydney', AEDT: 'Australia/Sydney'
};

const UNIT_MINUTES = { d: 1440, h: 60, m: 1 };
const UNIT = /^(d|days?|h|hrs?|hours?|m|mins?|minutes?)$/i;

function unitMinutes(u) {
  const k = u.toLowerCase()[0];
  return UNIT_MINUTES[k];
}

/**
 * "5h", "90m", "1h30m", "1h 30m", "2.5 hours", "1 day" → minutes, or null when the text is
 * not a duration. Bare numbers are refused: "5" could mean hours or minutes.
 */
export function parseDuration(text) {
  const s = String(text ?? '').trim().replace(/^for\s+/i, '');
  if (!s) return null;
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/gi;
  let total = 0;
  let consumed = '';
  let m;
  while ((m = re.exec(s)) !== null) {
    if (!UNIT.test(m[2])) return null;
    total += Number(m[1]) * unitMinutes(m[2]);
    consumed += m[0];
  }
  if (!consumed || consumed.replace(/\s+/g, '') !== s.replace(/\s+|,|and/gi, '')) return null;
  return Math.round(total);
}

/** True when the zone is one the runtime knows. */
export function validZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** A zone token → { zone } (IANA) or { offsetMin } (fixed offset), or null when it is not a zone. */
export function parseZone(token) {
  const t = String(token ?? '').trim();
  if (!t) return null;
  const alias = TZ_ALIASES[t.toUpperCase()];
  if (alias) return { zone: alias, label: t.toUpperCase() };
  const off = /^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(t);
  if (off && (/^(UTC|GMT)/i.test(t) || /^[+-]\d{2}:?\d{2}$/.test(t))) {
    const h = Number(off[2]);
    const mi = Number(off[3] || 0);
    if (h > 14 || mi > 59) return null;
    return { offsetMin: (off[1] === '-' ? -1 : 1) * (h * 60 + mi), label: t.toUpperCase() };
  }
  if (t.includes('/') && validZone(t)) return { zone: t, label: t };
  return null;
}

/** Wall-clock parts of an instant in a zone. */
function partsIn(ms, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}

function offsetMsAt(ms, tz) {
  const p = partsIn(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * A wall-clock time in a zone → epoch ms. In a fall-back overlap the first occurrence wins; a
 * time inside a spring-forward gap (02:30 on the night clocks jump to 03:00) lands just after it.
 */
export function zonedToUtc({ y, mo, d, h, mi }, where) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (where.offsetMin !== undefined) return guess - where.offsetMin * 60_000;
  const off = offsetMsAt(guess, where.zone);
  const t = guess - off;
  const off2 = offsetMsAt(t, where.zone);
  if (off2 === off) return t;
  const t2 = guess - off2;
  const p = partsIn(t2, where.zone);
  // t2 shows the asked wall time → it is right; otherwise the time does not exist and t is past the gap.
  return p.h === h && p.mi === mi ? t2 : t;
}

function todayIn(nowMs, where) {
  if (where.offsetMin !== undefined) {
    const x = new Date(nowMs + where.offsetMin * 60_000);
    return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate() };
  }
  const p = partsIn(nowMs, where.zone);
  return { y: p.y, mo: p.mo, d: p.d };
}

function addDays({ y, mo, d }, n) {
  const x = new Date(Date.UTC(y, mo - 1, d + n));
  return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate() };
}

/** "12pm", "12:30 pm", "noon", "midnight", "17:00", "9am" → { h, mi }, or null. */
export function parseClock(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (s === 'noon') return { h: 12, mi: 0 };
  if (s === 'midnight') return { h: 0, mi: 0 };
  let m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2] || 0);
    if (h < 1 || h > 12 || mi > 59) return null;
    const pm = m[3].startsWith('p');
    return { h: (h % 12) + (pm ? 12 : 0), mi };
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return { h, mi };
  }
  return null;
}

function systemZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** Human-readable deadline in the zone it was given in. */
export function formatIn(ms, where) {
  if (where.offsetMin !== undefined) {
    const x = new Date(ms + where.offsetMin * 60_000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())} ${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())} ${where.label}`;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: where.zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  }).format(new Date(ms));
}

/** "2h 05m" style. */
export function formatMinutes(min) {
  const n = Math.max(0, Math.round(min));
  const d = Math.floor(n / 1440);
  const h = Math.floor((n % 1440) / 60);
  const m = n % 60;
  if (d) return `${d}d ${h}h ${String(m).padStart(2, '0')}m`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

/**
 * Parse a time spec against `now`. Returns
 * { spec, kind: 'duration'|'clock', start, deadline, minutes, zone, zone_assumed, rolled, deadline_local }
 * or throws an Error naming what was wrong. `defaultZone` is used when a clock time names none.
 */
export function parseTimeSpec(spec, { now = Date.now(), defaultZone = null } = {}) {
  const raw = String(spec ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) throw new Error('no time given — use a duration (5h, 90m, 1h30m) or a clock time with a zone (12pm PST)');
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();

  const dur = parseDuration(raw);
  if (dur !== null) {
    if (dur < MIN_MINUTES) throw new Error(`"${raw}" is under ${MIN_MINUTES} minute`);
    if (dur > MAX_MINUTES) throw new Error(`"${raw}" is over 7 days — the in-session wake-up expires after seven days; split the run`);
    const deadline = nowMs + dur * 60_000;
    const where = { zone: defaultZone && validZone(defaultZone) ? defaultZone : systemZone() };
    return { spec: raw, kind: 'duration', start: new Date(nowMs).toISOString(), deadline: new Date(deadline).toISOString(),
      minutes: dur, zone: where.zone, zone_assumed: false, rolled: false, deadline_local: formatIn(deadline, where), absolute: absoluteSpec(deadline) };
  }

  let tokens = raw.replace(/^(until|till|til|by|at)\s+/i, '').split(' ');
  // Zone: the last token, or "UTC +2" written as two tokens.
  let where = null;
  if (tokens.length > 2 && /^(UTC|GMT)$/i.test(tokens[tokens.length - 2]) && /^[+-]\d{1,2}(:?\d{2})?$/.test(tokens[tokens.length - 1])) {
    where = parseZone(tokens[tokens.length - 2] + tokens[tokens.length - 1]);
    if (where) tokens = tokens.slice(0, -2);
  }
  if (!where && tokens.length > 1) {
    where = parseZone(tokens[tokens.length - 1]);
    if (where) tokens = tokens.slice(0, -1);
  }
  let zoneAssumed = false;
  if (!where) {
    const z = defaultZone && validZone(defaultZone) ? defaultZone : systemZone();
    where = { zone: z, label: z };
    zoneAssumed = true;
  }

  // Day: "today", "tomorrow" or YYYY-MM-DD before the time.
  let day = null;
  let explicitToday = false;
  const first = (tokens[0] || '').toLowerCase();
  if (first === 'today' || first === 'tomorrow') {
    day = addDays(todayIn(nowMs, where), first === 'tomorrow' ? 1 : 0);
    explicitToday = first === 'today';
    tokens = tokens.slice(1);
  } else {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tokens[0] || '');
    if (dm) {
      day = { y: Number(dm[1]), mo: Number(dm[2]), d: Number(dm[3]) };
      const check = new Date(Date.UTC(day.y, day.mo - 1, day.d));
      if (check.getUTCMonth() + 1 !== day.mo || check.getUTCDate() !== day.d) throw new Error(`"${tokens[0]}" is not a calendar date`);
      tokens = tokens.slice(1);
    }
  }

  const clock = parseClock(tokens.join(' '));
  if (!clock) {
    throw new Error(`cannot read "${raw}" — use a duration (5h, 90m, 1h30m) or a clock time with a zone (12pm PST, 17:30 Europe/London, tomorrow 9am ET)`);
  }

  let rolled = false;
  let ms;
  if (day) {
    ms = zonedToUtc({ ...day, ...clock }, where);
    if (ms <= nowMs) throw new Error(`"${raw}" is already past (${formatIn(ms, where)})${explicitToday ? ' — say tomorrow' : ''}`);
  } else {
    ms = zonedToUtc({ ...todayIn(nowMs, where), ...clock }, where);
    if (ms <= nowMs) {
      ms = zonedToUtc({ ...addDays(todayIn(nowMs, where), 1), ...clock }, where);
      rolled = true;
    }
  }
  const minutes = Math.round((ms - nowMs) / 60_000);
  if (minutes < MIN_MINUTES) throw new Error(`"${raw}" is under ${MIN_MINUTES} minute away`);
  if (minutes > MAX_MINUTES) throw new Error(`"${raw}" is over 7 days away — the in-session wake-up expires after seven days; split the run`);
  return { spec: raw, kind: 'clock', start: new Date(nowMs).toISOString(), deadline: new Date(ms).toISOString(), minutes,
    zone: where.zone ?? where.label, zone_assumed: zoneAssumed, rolled, deadline_local: formatIn(ms, where), absolute: absoluteSpec(ms) };
}

/** The deadline as a spec that always means the same instant: "2026-10-22 19:00 UTC". */
export function absoluteSpec(ms) {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/**
 * Split command arguments into the time and the rest: the longest leading run of words (at
 * most six) that parses as a time. "12pm PST checkout flow" → { time: "12pm PST", rest: "checkout flow" }.
 * Throws when no leading words parse.
 */
export function splitTimeSpec(text, opts = {}) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  let lastError = null;
  for (let n = Math.min(6, words.length); n >= 1; n--) {
    try {
      const parsed = parseTimeSpec(words.slice(0, n).join(' '), opts);
      return { time: parsed.spec, rest: words.slice(n).join(' '), parsed };
    } catch (err) { if (!lastError || n === 1) lastError = err; }
  }
  throw lastError || new Error('no time given — use a duration (5h, 90m, 1h30m) or a clock time with a zone (12pm PST)');
}

/**
 * Minutes held back at the end for the wrap-up (finish the step in hand, write-up, /bc, page):
 * pct of the whole run, clamped to [min, max], never more than half the run.
 */
export function wrapUpMinutes(totalMinutes, timed = {}) {
  const pct = Number.isFinite(timed.wrap_up_pct) ? timed.wrap_up_pct : 10;
  const lo = Number.isFinite(timed.wrap_up_min_minutes) ? timed.wrap_up_min_minutes : 10;
  const hi = Number.isFinite(timed.wrap_up_max_minutes) ? timed.wrap_up_max_minutes : 60;
  const want = Math.min(Math.max(Math.round(totalMinutes * pct / 100), lo), hi);
  return Math.max(0, Math.min(want, Math.floor(totalMinutes / 2)));
}

/**
 * Where a deadline stands at `now`:
 *  - work: keep starting steps;
 *  - wrap_up: start nothing new, finish the step in hand, write up and finish;
 *  - over: the deadline has passed — stop now, write up what is there.
 */
export function deadlineState(d, now = Date.now()) {
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();
  const end = Date.parse(d.deadline);
  const start = Date.parse(d.start);
  const wrapAt = end - (d.wrap_up_minutes ?? 0) * 60_000;
  const phase = nowMs >= end ? 'over' : nowMs >= wrapAt ? 'wrap_up' : 'work';
  const total = Math.max(1, end - start);
  return {
    phase,
    deadline: d.deadline,
    deadline_local: d.deadline_local,
    wrap_up_at: new Date(wrapAt).toISOString(),
    remaining_minutes: Math.max(0, Math.floor((end - nowMs) / 60_000)),
    work_minutes_left: Math.max(0, Math.floor((wrapAt - nowMs) / 60_000)),
    elapsed_pct: Math.min(100, Math.max(0, Math.round(((nowMs - start) / total) * 100))),
    remaining: formatMinutes((end - nowMs) / 60_000)
  };
}

/** One status line: "Deadline: Thu, Oct 22, 12:00 PM PDT — 2h 05m left (work)". */
export function deadlineLine(d, now = Date.now()) {
  const st = deadlineState(d, now);
  const what = st.phase === 'over' ? 'time is up' : st.phase === 'wrap_up' ? `${st.remaining} left — wrap up, start nothing new` : `${st.remaining} left`;
  return `Deadline: ${d.deadline_local} — ${what} (${st.phase})`;
}
