/**
 * Reading what comes back. The report's shape (find the json block, check every field, strip secrets) lives in
 * `report-shape.js`, the one module the tester connector reads reports with too; this file adds the numbers:
 * `measure` gives one walk's numbers (null when a number rests on something unreadable, named in `unreadable`),
 * `mergeFindings` groups findings, `scorecard` scores the round, and `collect(dir, round)` writes
 * `<dir>/findings-r<n>.json`. A report whose only problems are readable slips (a score written "yes") still counts here.
 *
 * What was asked comes from `rounds.json` (each walk's persona, door and jobs) and `project.json` (the product's name,
 * the targets, who each persona and door is); the brief files are never read. Everything a report says is data:
 * every string in the result is stripped of secrets before it is written.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeAtomic } from "./fsx.js";
import { MAX_LIST, MAX_REPORT_BYTES, REPORT_NAME, SEVERITY, STEPS, parseReport, safeName, show, stripDeep, stripFragments, unreadableProblem } from "./report-shape.js";

export { MAX_LIST, MAX_REPORT_BYTES, parseReport, safeName, stripDeep, stripFragments };

/** What a project that names no targets is held to. */
export const DEFAULT_TARGETS = Object.freeze({ loops: 5, within_minutes: 30, first_aha_seconds: 120, stalls: 0 });
const MAX_KNOWN_PER_WALK = 50;
const MAX_KNOWN_CHARS = 300;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const oneLine = (s, max = 80) => stripFragments(String(s ?? "")).replace(/\s+/g, " ").trim().slice(0, max);
const couldNot = (e) => `could not be read: ${oneLine(e?.message ?? e)}`;

/** The project's targets, each key taken only when it is a sensible number, else the default. */
export function targetsOf(project) {
  const t = isObj(project?.targets) ? project.targets : {};
  const pick = (k, min) => (typeof t[k] === "number" && Number.isFinite(t[k]) && t[k] >= min ? t[k] : DEFAULT_TARGETS[k]);
  return { loops: pick("loops", 0), within_minutes: pick("within_minutes", 1), first_aha_seconds: pick("first_aha_seconds", 1), stalls: pick("stalls", 0) };
}

/**
 * The numbers for one walk, from seconds since its start. A number that rests on a value the report did not give
 * readably is null and named in `unreadable`; an empty loops list is a real zero, a missing one is not. `neverAha` is true
 * when every aha is known and none came (so `secondsToFirstAha` is null for a known reason), false when one came, and null
 * when that rests on something unreadable. `loopsWithin` counts the loops that gave a result within `withinMinutes`.
 */
export function measure(r, { withinMinutes = DEFAULT_TARGETS.within_minutes } = {}) {
  const unreadable = [];
  const loops = r.loops;
  const known = (name, ok, value) => {
    if (ok) return value();
    unreadable.push(name);
    return null;
  };
  const L = loops ?? [];
  const stallsKnown = loops !== null && L.every((l) => l.stall !== null);
  const done = L.filter((l) => l.stall === false);
  const timesKnown = stallsKnown && done.every((l) => l.result_s !== null);
  const ahaKnown = stallsKnown && done.every((l) => l.aha !== null);
  // A reduce, never a spread: a call takes only so many arguments, and a report may hold far more loops than that.
  const firstOf = (xs) => xs.reduce((a, l) => (a === null || l.result_s < a ? l.result_s : a), null);
  const m = {
    loopsCompleted: known("loopsCompleted", stallsKnown, () => done.length),
    loopsWithAha: known("loopsWithAha", ahaKnown, () => done.filter((l) => l.aha).length),
    stalls: known("stalls", stallsKnown, () => L.length - done.length),
    secondsToFirstResult: known("secondsToFirstResult", timesKnown, () => firstOf(done)),
    secondsToFirstAha: known("secondsToFirstAha", timesKnown && ahaKnown, () => firstOf(done.filter((l) => l.aha))),
    loopsWithin: known("loopsWithin", timesKnown, () => done.filter((l) => l.result_s <= withinMinutes * 60).length),
  };
  m.neverAha = timesKnown && ahaKnown ? !done.some((l) => l.aha) : null;
  const steps = {};
  const firstZero = {};
  for (const k of STEPS) {
    const S = r.screens;
    steps[k] = S !== null && S.every((s) => s[k] !== null) ? S.reduce((a, s) => a + s[k], 0) : null;
    if (steps[k] === null) unreadable.push(`steps.${k}`);
    // The first screen that scored 0, false when none did, null when an unreadable score comes first.
    firstZero[k] = null;
    if (S !== null) {
      const i = S.findIndex((s) => s[k] !== 1);
      firstZero[k] = i < 0 ? false : S[i][k] === 0 ? { n: S[i].n, screen: S[i].screen } : null;
    }
  }
  return { ...m, steps, firstZero, unreadable };
}

/**
 * A walk's own numbers when it carried jobs: jobs started and finished, steps done of steps listed, loops and stalls per
 * sitting (only when the report uses `sitting`; a loop with no sitting is then counted apart), whether the product
 * remembered an earlier sitting, and would pay.
 */
export function deepMeasure(r) {
  const jobs = r.jobs ?? [];
  const usesSitting = [...(r.loops ?? []), ...(r.screens ?? [])].some((x) => Number.isInteger(x.sitting));
  const sittings = {};
  let loopsWithoutSitting = 0;
  if (usesSitting) {
    for (const l of r.loops ?? []) {
      if (!Number.isInteger(l.sitting)) {
        loopsWithoutSitting++;
        continue;
      }
      const s = (sittings[l.sitting] ??= { loops: 0, stalls: 0 });
      s.loops++;
      if (l.stall === true) s.stalls++;
    }
  }
  return {
    jobsStarted: jobs.length,
    jobsFinished: jobs.filter((j) => j.finished === true).length,
    stepsDone: jobs.reduce((a, j) => a + (j.steps_done ?? 0), 0),
    steps: jobs.reduce((a, j) => a + (j.steps ?? 0), 0),
    sittings,
    loopsWithoutSitting,
    remembered: r.remembered?.yes ?? null,
    missed: (r.remembered?.missed ?? []).filter((x) => typeof x === "string"),
    wouldPay: r.would_pay?.yes ?? null,
    wouldPayReason: r.would_pay?.reason ?? null,
  };
}

/** A deep round's totals over its walks' `deepMeasure`s. */
function deepSummary(ms) {
  const sum = (f) => ms.reduce((a, m) => a + f(m), 0);
  const yesNo = (key) => ({ yes: ms.filter((m) => m[key] === true).length, no: ms.filter((m) => m[key] === false).length, known: ms.filter((m) => m[key] !== null).length });
  const sittings = {};
  for (const m of ms)
    for (const [k, v] of Object.entries(m.sittings)) {
      const s = (sittings[k] ??= { loops: 0, stalls: 0 });
      s.loops += v.loops;
      s.stalls += v.stalls;
    }
  return {
    walks: ms.length,
    jobsStarted: sum((m) => m.jobsStarted),
    jobsFinished: sum((m) => m.jobsFinished),
    stepsDone: sum((m) => m.stepsDone),
    steps: sum((m) => m.steps),
    sittings,
    loopsWithoutSitting: sum((m) => m.loopsWithoutSitting),
    remembered: yesNo("remembered"),
    wouldPay: yesNo("wouldPay"),
  };
}

/** Reads a json file of the working folder: `{ value }` when readable, `{ missing: true }` when absent, `{ problem }` otherwise. */
function readJson(dir, file) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, file), "utf8");
  } catch (e) {
    return e?.code === "ENOENT" ? { missing: true } : { problem: couldNot(e) };
  }
  try {
    return { value: JSON.parse(text.replace(/^﻿/, "")) };
  } catch (e) {
    return { problem: couldNot(e) };
  }
}

/**
 * `clock-r<n>.json` when present: the real time each walk took, `[{ id, started, received, clock_minutes }]` (or
 * `{ walks: [...] }`), as a map of walk id to minutes. Absent: null. Unreadable: null, with a line in `unreadable`.
 */
function readClock(dir, round, unreadable) {
  const file = `clock-r${round}.json`;
  const j = readJson(dir, file);
  if (j.missing) return null;
  if (j.problem) {
    unreadable.push({ file, problem: j.problem });
    return null;
  }
  const list = Array.isArray(j.value) ? j.value : Array.isArray(j.value?.walks) ? j.value.walks : null;
  if (!list) {
    unreadable.push({ file, problem: "could not be read: it holds no list of walks" });
    return null;
  }
  const map = new Map();
  for (const x of list) if (x && typeof x.id === "string" && typeof x.clock_minutes === "number" && Number.isFinite(x.clock_minutes) && x.clock_minutes >= 0) map.set(x.id, x.clock_minutes);
  return map;
}

const STOP = new Set(["the", "a", "an", "to", "of", "is", "it", "in", "on", "and", "for", "i", "my", "me", "do", "that", "this", "was", "are", "be", "at", "with"]);
const words = (s) => new Set(String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)));
/** Two titles are alike when their significant words overlap by at least 0.6 (Jaccard). Kept strict: under-merging is the safe side. */
const alike = (a, b) => {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / (x.size + y.size - n) >= 0.6;
};

/** Where a finding happened: host and path of its address (no query, no fragment), else its screen name normalised; null when neither. */
export function findingKey(f) {
  if (f.address) {
    try {
      const u = new URL(f.address);
      let end = u.pathname.length;
      while (end > 0 && u.pathname[end - 1] === "/") end--;
      return `${u.host.toLowerCase()}${u.pathname.slice(0, end).toLowerCase()}`;
    } catch {
      // Not a web address: fall through to the screen name.
    }
  }
  const s = String(f.screen ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (["the", "a", "an"].includes(s[0])) s.shift();
  const k = s.filter((w) => w !== "screen" && w !== "page").join(" ");
  return k || null;
}

const rank = (s) => (s === null ? SEVERITY.length : SEVERITY.indexOf(s));

/** Findings from many walks merged when the place is the same and the title is alike every title already in the group. */
export function mergeFindings(walks) {
  const groups = [];
  for (const w of [...walks].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)))
    for (const f of w.report.findings ?? []) {
      const key = findingKey(f);
      const g = key === null ? null : groups.find((x) => x.key === key && x.titles.every((t) => alike(t, f.title)));
      const ev = { walk: w.report.id ?? w.file, finding: f.n, severity: f.severity, said: f.persona_said, happened: stripFragments(f.what_happened ?? "") || null, shot: f.shot };
      if (g) {
        g.evidence.push(ev);
        g.titles.push(f.title);
        if (rank(f.severity) < rank(g.severity)) g.severity = f.severity;
      } else groups.push({ key, titles: [f.title], title: f.title, severity: f.severity, screen: f.screen, address: f.address, expected: f.expected, evidence: [ev] });
    }
  for (const g of groups) g.walks = new Set(g.evidence.map((e) => e.walk)).size;
  // A finding's id comes from what it is (its place and its first title), never from where it ranks, so a late report
  // that outranks it does not change it. Two place-less findings with the same title get a counted suffix, in file order.
  const seen = new Set();
  for (const g of groups) {
    const base = `${g.key ?? "no-place"}\n${String(g.titles[0] ?? "").toLowerCase()}`;
    for (let n = 1; ; n++) {
      const id = `f-${createHash("sha256").update(n === 1 ? base : `${base}\n${n}`).digest("hex").slice(0, 8)}`;
      if (!seen.has(id)) {
        seen.add(id);
        g.id = id;
        break;
      }
    }
  }
  groups.sort((a, b) => rank(a.severity) - rank(b.severity) || b.walks - a.walks);
  return groups.map(({ key, titles, id, ...g }, i) => ({ id, rank: i + 1, ...g }));
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const ROW_MEASURES = ["loopsWithin", "secondsToFirstAha", "stalls"];

/**
 * One row of walks: mean loops within the target minutes, median seconds to first aha, stalls; unknowns skipped, counted,
 * never met. A walk that never had an aha (every aha known, none true) counts as never in the median, later than any
 * time: when the median lands on never, `medianSecondsToFirstAha` is null, `firstAha.medianNever` is true and the target is missed.
 */
function row(items, T) {
  const m = items.map((i) => i.m);
  const unread = (x, k) => (x.unreadable ?? []).includes(k);
  const loops = avg(m.filter((x) => !unread(x, "loopsWithin") && x.loopsWithin !== null).map((x) => x.loopsWithin));
  const reachedTimes = m.filter((x) => !unread(x, "secondsToFirstAha") && x.secondsToFirstAha !== null).map((x) => x.secondsToFirstAha);
  const never = m.filter((x) => !unread(x, "secondsToFirstAha") && x.secondsToFirstAha === null && x.neverAha === true).length;
  const known = reachedTimes.length + never;
  const mid = median([...reachedTimes, ...Array(never).fill(Infinity)]);
  const medianNever = mid === Infinity;
  const aha = mid === null || medianNever ? null : mid;
  const under = reachedTimes.filter((t) => t < T.first_aha_seconds).length;
  const stallsKnown = m.filter((x) => !unread(x, "stalls") && x.stalls !== null);
  const stalls = stallsKnown.length ? stallsKnown.reduce((a, x) => a + x.stalls, 0) : null;
  const allStalls = stallsKnown.length === m.length;
  return {
    walks: items.length,
    unreadable: m.filter((x) => ROW_MEASURES.some((k) => unread(x, k))).length,
    loopsWithin: loops,
    medianSecondsToFirstAha: aha,
    firstAha: { median: aha, medianNever, never, reached: reachedTimes.length, known, reachedMedian: median(reachedTimes) },
    ahaUnderTarget: { walks: under, of: known },
    stalls,
    meets: {
      loops: loops === null ? null : loops >= T.loops,
      firstAha: medianNever ? false : aha === null ? null : aha < T.first_aha_seconds,
      stalls: stalls === null ? null : stalls > T.stalls ? false : allStalls ? true : null,
    },
  };
}

/** Walks that end on a page read without signing in: screens and findings only. */
function siteRow(items) {
  const steps = {};
  for (const k of STEPS) {
    const xs = items.map((i) => i.m.steps?.[k]).filter((x) => x !== null && x !== undefined);
    steps[k] = xs.length ? xs.reduce((a, b) => a + b, 0) : null;
  }
  return { walks: items.length, unreadable: items.filter((i) => STEPS.some((k) => i.m.steps?.[k] === null || i.m.steps?.[k] === undefined)).length, steps, findings: items.reduce((a, i) => a + (i.findings ?? 0), 0) };
}

/**
 * `items` are `{ m: measure(report), persona, door, siteOnly (true, false or null when the door is not known), reader?, findings? }`.
 * Walks through a site-only door are scored apart in `siteOnly`; in a site-only round every walk whose door is not a known
 * app door is one of them. A round with only such walks also gets `siteWalks`, their loop numbers by door and by reader.
 */
export function scorecard(items, { targets = DEFAULT_TARGETS, siteOnlyRound = false } = {}) {
  const T = { ...DEFAULT_TARGETS, ...targets };
  const isSite = siteOnlyRound ? (i) => i.siteOnly !== false : (i) => i.siteOnly === true;
  const app = items.filter((i) => !isSite(i));
  const by = (keyOf, from) => {
    const g = new Map();
    for (const i of from) {
      const k = String(keyOf(i));
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(i);
    }
    // Keys come from the project and the rounds file: an own property is defined on the result, so "__proto__" is a row like any other.
    const out = {};
    for (const [k, v] of [...g].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) Object.defineProperty(out, k, { value: row(v, T), enumerable: true, writable: true, configurable: true });
    return out;
  };
  const doorKey = (i) => i.door ?? "unknown";
  const site = items.filter(isSite);
  const card = { targets: T, overall: row(app, T), perPersona: by((i) => i.persona ?? "unknown", app), perDoor: by(doorKey, app), siteOnly: siteRow(site) };
  if (site.length && (siteOnlyRound || !app.length)) card.siteWalks = { overall: row(site, T), perPersona: by((i) => (i.reader ? `reader:${i.reader}` : i.persona ?? "unknown"), site), perDoor: by(doorKey, site) };
  return card;
}

/** The `known:` lines of a report's notes: after optional list markers, case aside, with something after the colon. */
function knownLines(notes) {
  const out = [];
  for (const line of String(notes ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:(?:[-*+•]|\d+[.)])\s+)?known:\s*(.*\S)\s*$/i.exec(line);
    if (!m) continue;
    out.push(m[1].replace(/\s+/g, " ").slice(0, MAX_KNOWN_CHARS));
    if (out.length >= MAX_KNOWN_PER_WALK) break;
  }
  return out;
}

/** The project file as far as this reader needs it: tolerant of every missing key, never throws. */
function readProject(dir, unreadable) {
  const j = readJson(dir, "project.json");
  if (j.problem) unreadable.push({ file: "project.json", problem: j.problem });
  const p = isObj(j.value) ? j.value : {};
  const personas = new Map();
  for (const x of Array.isArray(p.personas) ? p.personas : []) if (isObj(x) && typeof x.id === "string") personas.set(x.id, { role: typeof x.role === "string" ? x.role : null, context: typeof x.context === "string" ? x.context : null });
  const doors = new Map();
  for (const x of Array.isArray(p.doors) ? p.doors : []) if (isObj(x) && typeof x.id === "string") doors.set(x.id, { siteOnly: x.site_only === true, reader: typeof x.reader === "string" && x.reader.trim() ? x.reader : null });
  const name = typeof p.product?.name === "string" && p.product.name.trim() ? p.product.name.trim() : "the product";
  return { name, targets: targetsOf(p), personas, doors, secretPaths: (Array.isArray(p.secret_paths) ? p.secret_paths : []).filter((s) => typeof s === "string") };
}

/**
 * Reads `<dir>/reports/r<round>-*.md`, `project.json` and `rounds.json`, writes `<dir>/findings-r<round>.json` and returns it,
 * every string stripped. A file whose name is no walk of the round is listed in `unreadable` under its sanitised name.
 */
export function collect(dir, round, { now = Date.now() } = {}) {
  const unreadable = [];
  const project = readProject(dir, unreadable);
  const opts = { secretPaths: project.secretPaths };
  const rj = readJson(dir, "rounds.json");
  if (rj.problem) unreadable.push({ file: "rounds.json", problem: rj.problem });
  const entry = isObj(rj.value?.rounds) && Object.hasOwn(rj.value.rounds, String(round)) && isObj(rj.value.rounds[String(round)]) ? rj.value.rounds[String(round)] : null;
  const recorded = new Map();
  for (const w of Array.isArray(entry?.walks) ? entry.walks : []) if (isObj(w) && typeof w.id === "string" && REPORT_NAME.test(w.id)) recorded.set(w.id, w);
  const asked = [...recorded.keys()];
  // With no record of the round the name pattern alone decides which files are walks.
  const known = entry !== null;
  const reportsDir = path.join(dir, "reports");
  const files = fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).filter((f) => f.startsWith(`r${round}-`) && f.endsWith(".md")).sort() : [];
  const metaOf = (id) => {
    const w = recorded.get(id);
    const persona = typeof w?.persona === "string" ? w.persona : null;
    const door = typeof w?.door === "string" ? w.door : null;
    const p = persona ? project.personas.get(persona) : null;
    const d = door ? project.doors.get(door) : null;
    return { persona, door, role: p?.role ?? null, context: p?.context ?? null, siteOnly: d ? d.siteOnly : null, reader: d?.reader ?? null, jobs: Array.isArray(w?.jobs) ? w.jobs.filter((j) => typeof j === "string") : [] };
  };
  const walks = [];
  for (const file of files) {
    const id = file.replace(/\.md$/, "");
    if (!REPORT_NAME.test(id) || (known && !recorded.has(id))) {
      unreadable.push({ file: safeName(file), problem: "no walk with this name" });
      continue;
    }
    const full = path.join(reportsDir, file);
    // One report that still throws (for any reason) costs only itself, never the round.
    try {
      const st = fs.statSync(full);
      // Sized before it is read: a report over the cap is never loaded, let alone parsed.
      if (st.size > MAX_REPORT_BYTES) {
        unreadable.push({ file, problem: "too large" });
        continue;
      }
      const report = parseReport(fs.readFileSync(full, "utf8"), opts);
      const bad = unreadableProblem(report);
      if (bad) {
        unreadable.push({ file, problem: bad });
        continue;
      }
      if (report.id !== null && report.id !== id) report.problems.push(`id ${show(report.id)} is not the file name; the file name ${id} is used`);
      report.id = id;
      if (!recorded.has(id)) report.problems.push("this walk is not in rounds.json");
      const meta = metaOf(id);
      walks.push({ file, report, m: measure(report, { withinMinutes: project.targets.within_minutes }), meta, findings: report.findings?.length ?? 0, known: knownLines(report.notes) });
    } catch (e) {
      unreadable.push({ file, problem: couldNot(e) });
    }
  }
  const askedMetas = asked.map((id) => ({ id, ...metaOf(id) }));
  // A site-only round is known from what was asked, not from the reports that came back.
  const siteOnlyRound = askedMetas.length > 0 && askedMetas.every((m) => m.siteOnly === true);
  // A deep round (whole jobs) too: every walk that is not a site-only one carries jobs.
  const appAsked = askedMetas.filter((m) => m.siteOnly !== true);
  const deepRound = !siteOnlyRound && appAsked.length > 0 && appAsked.every((m) => m.jobs.length > 0);
  const clock = readClock(dir, round, unreadable);
  const deepOf = new Map(deepRound ? walks.map((w) => [w.report.id, deepMeasure(w.report)]) : []);
  const items = walks.map((w) => ({ m: w.m, persona: w.meta.persona ?? "unknown", door: w.meta.door, siteOnly: w.meta.siteOnly, reader: w.meta.reader, findings: w.findings }));
  const knownItems = walks.flatMap((w) => w.known.map((text) => ({ walk: w.report.id, text })));
  const result = stripDeep(
    {
      round,
      kind: entry?.kind === "side" ? "side" : "standard",
      product: project.name,
      ...(siteOnlyRound ? { siteOnlyRound: true } : {}),
      ...(deepRound ? { deepRound: true, deep: deepSummary([...deepOf.values()]) } : {}),
      briefs: asked.length,
      reports: walks.length,
      missing: asked.filter((id) => !walks.some((w) => w.report.id === id)),
      unreadable,
      known_met: { count: knownItems.length, items: knownItems },
      scorecard: scorecard(items, { targets: project.targets, siteOnlyRound }),
      findings: mergeFindings(walks),
      walks: walks.map((w) => ({
        id: w.report.id,
        persona: w.meta.persona ?? "unknown",
        door: w.meta.door,
        role: w.meta.role,
        context: w.meta.context,
        siteOnly: w.meta.siteOnly === true,
        reader: w.meta.reader,
        width: w.report.width,
        screens: w.report.screens?.length ?? null,
        finished: w.report.finished,
        why_not_finished: w.report.why_not_finished,
        measures: w.m,
        problems: w.report.problems,
        first_five: w.report.first_five,
        come_back: w.report.come_back,
        questions: w.report.questions,
        notes: w.report.notes,
        known_met: w.known,
        ...(deepRound ? { deep: deepOf.get(w.report.id) } : {}),
        ...(clock ? { clock: clock.has(w.report.id) ? { real_minutes: clock.get(w.report.id), tester_minutes: w.report.minutes } : null } : {}),
      })),
    },
    opts,
  );
  writeAtomic(path.join(dir, `findings-r${round}.json`), JSON.stringify(result, null, 2));
  return result;
}
