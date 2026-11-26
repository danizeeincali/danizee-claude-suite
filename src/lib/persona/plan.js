/**
 * Planning a round: who walks which door, with which jobs. Pure and deterministic for the same inputs (a seeded rng),
 * so a round can be made again. `recordRound` keeps what each round asked in `rounds.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { checkProject, withDefaults, jobFits, touches } from "./project.js";
import { rngFor, shuffle } from "./rng.js";
import { writeAtomic } from "./fsx.js";
import { REPORT_NAME } from "./report-shape.js";

export const ROUNDS_FILE = "rounds.json";
export const MAX_ID = 60;
const ATTEMPTS = 60;
const MAX_WALKS = 500;

const fail = (m) => {
  throw new Error(m);
};
const list = (a) => a.map((x) => `"${x}"`).join(", ");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const nnOf = (id) => Number(/^r\d+-(\d+)-/.exec(id)?.[1] ?? NaN);

/** r<round>-<nn>-<persona>-<door>, at most 60 characters, the persona and door clipped to share what is left. */
export function walkId(round, n, persona, door) {
  const head = `r${round}-${String(n).padStart(2, "0")}-`;
  const room = MAX_ID - head.length - 1;
  const half = Math.floor(room / 2);
  const pLen = Math.min(persona.length, Math.max(half, room - door.length));
  const dLen = Math.min(door.length, room - pLen);
  const cut = (s, k) => s.slice(0, k).replace(/-+$/, "");
  return `${head}${cut(persona, pLen)}-${cut(door, dLen)}`;
}

/**
 * `planRound(project, { round, walks, jobsPerWalk, seed = "r<round>", side = false, only = {doors, personas, jobs}, history })`
 * → `{ round, kind, seed, avoid, known, walks: [{ id, persona, door, jobs, width }] }`. `history` is the walks of earlier
 * rounds (`historyOf(rounds.json)`): a pair used there is not used again until every pair has been, and jobs used there
 * come after jobs not yet used.
 */
export function planRound(projectIn, opts = {}) {
  const checked = checkProject(projectIn);
  if (!checked.ok) {
    const p = checked.problems[0];
    fail(`The project file has a problem at ${p.path || "the top"}: ${p.message} ${p.fix}`);
  }
  const project = withDefaults(projectIn);
  const { round, side = false, only = {}, history = [] } = opts;
  if (!Number.isInteger(round) || round < 1) fail(`The round must be a whole number of 1 or more, not ${JSON.stringify(round)}.`);
  const walks = opts.walks ?? project.defaults.walks;
  if (!Number.isInteger(walks) || walks < 1 || walks > MAX_WALKS) fail(`The number of walks must be a whole number from 1 to ${MAX_WALKS}, not ${JSON.stringify(walks)}.`);
  const jobsPerWalk = opts.jobsPerWalk ?? project.defaults.jobs_per_walk;
  if (!Number.isInteger(jobsPerWalk) || jobsPerWalk < 1) fail(`The jobs per walk must be a whole number of 1 or more, not ${JSON.stringify(jobsPerWalk)}.`);
  const seed = opts.seed ?? `r${round}`;
  const avoid = side ? [...project.fixing] : [];

  const narrow = (items, ids, what) => {
    if (!ids || ids.length === 0) return items;
    for (const id of ids) if (!items.some((x) => x.id === id)) fail(`"${id}" is not a ${what} in the project file (${what}s: ${items.map((x) => x.id).join(", ")}).`);
    return items.filter((x) => ids.includes(x.id));
  };
  const personas = narrow(project.personas, only.personas, "persona");
  const doorsAll = narrow(project.doors, only.doors, "door");
  const jobsAll = narrow(project.jobs, only.jobs, "job");
  const doors = doorsAll.filter((d) => !touches(d.areas, avoid));
  const jobs = jobsAll.filter((j) => !touches(j.areas, avoid));
  const leftOut = [
    ...doorsAll.filter((d) => !doors.includes(d)).map((d) => `door "${d.id}" (${d.areas.filter((a) => avoid.includes(a)).join(", ")})`),
    ...jobsAll.filter((j) => !jobs.includes(j)).map((j) => `job "${j.id}" (${j.areas.filter((a) => avoid.includes(a)).join(", ")})`),
  ];
  const left = leftOut.length ? ` Left out because they touch ${list(avoid)}: ${leftOut.join(", ")}.` : "";
  if (doors.length === 0) fail(`A side round cannot be planned: no door is left to walk.${left} Change "fixing" or plan a standard round.`);
  if (jobs.length === 0 && !doors.some((d) => d.site_only)) fail(`A side round cannot be planned: no job is left to do.${left} Change "fixing" or plan a standard round.`);

  const pairs = [];
  for (const p of personas)
    for (const d of doors) {
      const fitting = jobs.filter((j) => jobFits(j, p, d));
      if (d.site_only || fitting.length) pairs.push({ persona: p, door: d, fitting });
    }
  if (pairs.length === 0) fail(`${side ? "A side round" : "A round"} cannot be planned: no persona, door and job fit together.${left} Check each job's "for" and "doors".`);

  const key = (p, d) => `${p}|${d}`;
  const pairUse0 = new Map();
  const jobUse0 = new Map();
  for (const h of history) {
    if (typeof h?.persona === "string" && typeof h?.door === "string") pairUse0.set(key(h.persona, h.door), (pairUse0.get(key(h.persona, h.door)) ?? 0) + 1);
    for (const j of Array.isArray(h?.jobs) ? h.jobs : []) jobUse0.set(j, (jobUse0.get(j) ?? 0) + 1);
  }
  const jobIndex = new Map(project.jobs.map((j, i) => [j.id, i]));
  const want = { personas: Math.min(walks, personas.length), doors: Math.min(walks, doors.length) };

  const attempt = (rng) => {
    const pairUse = new Map(pairUse0);
    const jobUse = new Map(jobUse0);
    const pRound = new Map();
    const dRound = new Map();
    const out = [];
    for (let i = 0; i < walks; i++) {
      let best = null;
      for (const c of pairs) {
        const k = [pairUse.get(key(c.persona.id, c.door.id)) ?? 0, (pRound.get(c.persona.id) ?? 0) + (dRound.get(c.door.id) ?? 0), rng.next()];
        if (!best || k[0] < best.k[0] || (k[0] === best.k[0] && (k[1] < best.k[1] || (k[1] === best.k[1] && k[2] < best.k[2])))) best = { c, k };
      }
      const { persona, door, fitting } = best.c;
      pairUse.set(key(persona.id, door.id), (pairUse.get(key(persona.id, door.id)) ?? 0) + 1);
      pRound.set(persona.id, (pRound.get(persona.id) ?? 0) + 1);
      dRound.set(door.id, (dRound.get(door.id) ?? 0) + 1);
      const order = shuffle(rng, fitting).sort((a, b) => (jobUse.get(a.id) ?? 0) - (jobUse.get(b.id) ?? 0));
      const picked = order.slice(0, jobsPerWalk).sort((a, b) => jobIndex.get(a.id) - jobIndex.get(b.id));
      for (const j of picked) jobUse.set(j.id, (jobUse.get(j.id) ?? 0) + 1);
      out.push({ persona: persona.id, door: door.id, jobs: picked.map((j) => j.id) });
    }
    const miss = Math.max(0, want.personas - new Set(out.map((w) => w.persona)).size) + Math.max(0, want.doors - new Set(out.map((w) => w.door)).size);
    return { out, miss };
  };

  const rng = rngFor(`${seed}|round${round}`);
  let best = null;
  for (let a = 0; a < ATTEMPTS; a++) {
    const r = attempt(rng);
    if (!best || r.miss < best.miss) best = r;
    if (best.miss === 0) break;
  }
  const widths = project.defaults.widths;
  return {
    round,
    kind: side ? "side" : "standard",
    seed,
    avoid,
    known: project.known.map((k) => k.id),
    walks: best.out.map((w, i) => ({ id: walkId(round, i + 1, w.persona, w.door), persona: w.persona, door: w.door, jobs: w.jobs, width: widths[i % widths.length] })),
  };
}

/** Walks from a parsed rounds.json, oldest round first; with `before`, only rounds numbered lower than it. */
export function historyOf(rounds, before = Infinity) {
  const all = rounds && typeof rounds === "object" && rounds.rounds && typeof rounds.rounds === "object" ? rounds.rounds : {};
  return Object.keys(all)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n < before)
    .sort((a, b) => a - b)
    .flatMap((n) => (Array.isArray(all[n]?.walks) ? all[n].walks : []));
}

/** What a plan misses of the rules, as sentences; empty means it holds. `only` is what the plan was narrowed to. */
export function checkCoverage(plan, projectIn, { only = {} } = {}) {
  const project = projectIn.defaults && projectIn.words ? projectIn : withDefaults(projectIn);
  const problems = [];
  const walks = Array.isArray(plan?.walks) ? plan.walks : [];
  const side = plan?.kind === "side";
  const avoid = Array.isArray(plan?.avoid) ? plan.avoid : [];
  if (side && JSON.stringify(avoid) !== JSON.stringify(project.fixing)) problems.push(`a side round must avoid exactly the areas being fixed (${project.fixing.join(", ") || "none"}), not ${avoid.join(", ") || "none"}`);
  if (!side && avoid.length) problems.push("a standard round avoids nothing");
  const seen = new Set();
  for (const w of walks) {
    if (seen.has(w.id)) problems.push(`two walks have the same id ${w.id}`);
    seen.add(w.id);
    if (typeof w.id !== "string" || w.id.length > MAX_ID || !REPORT_NAME.test(w.id)) problems.push(`walk id ${JSON.stringify(w.id)} is not a valid walk name of at most ${MAX_ID} characters`);
    const persona = project.personas.find((p) => p.id === w.persona);
    const door = project.doors.find((d) => d.id === w.door);
    if (!persona) problems.push(`walk ${w.id}: persona "${w.persona}" is not in the project`);
    if (!door) problems.push(`walk ${w.id}: door "${w.door}" is not in the project`);
    if (door && touches(door.areas, avoid)) problems.push(`walk ${w.id}: door "${door.id}" touches ${door.areas.filter((a) => avoid.includes(a)).join(", ")}, which is being fixed`);
    const jobs = Array.isArray(w.jobs) ? w.jobs : [];
    if (new Set(jobs).size !== jobs.length) problems.push(`walk ${w.id}: gets the same job twice`);
    if (door && !door.site_only && jobs.length === 0) problems.push(`walk ${w.id}: has no job, and door "${door.id}" needs one`);
    for (const id of jobs) {
      const job = project.jobs.find((j) => j.id === id);
      if (!job) problems.push(`walk ${w.id}: job "${id}" is not in the project`);
      else {
        if (persona && door && !jobFits(job, persona, door)) problems.push(`walk ${w.id}: job "${id}" does not fit ${persona.id} at door "${door.id}"`);
        if (touches(job.areas, avoid)) problems.push(`walk ${w.id}: job "${id}" touches ${job.areas.filter((a) => avoid.includes(a)).join(", ")}, which is being fixed`);
      }
    }
  }
  const spread = (what, expected, got) => {
    const missing = expected.filter((id) => !got.has(id));
    if (walks.length >= expected.length) for (const id of missing) problems.push(`${what} "${id}" is never walked`);
    else if (got.size < walks.length) problems.push(`a ${what} repeats before every ${what} has been walked`);
  };
  const ids = (items, pick) => (pick?.length ? items.filter((x) => pick.includes(x.id)) : items);
  spread("door", ids(project.doors, only.doors).filter((d) => !touches(d.areas, avoid)).map((d) => d.id), new Set(walks.map((w) => w.door)));
  spread("persona", ids(project.personas, only.personas).map((p) => p.id), new Set(walks.map((w) => w.persona)));
  return problems;
}

/** `rounds.json` of a folder, or an empty one; a file that is not readable is refused in one sentence. */
export function readRounds(dir) {
  const file = path.join(dir, ROUNDS_FILE);
  if (!fs.existsSync(file)) return { rounds: {} };
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j && typeof j === "object" && !Array.isArray(j) && (j.rounds === undefined || (j.rounds && typeof j.rounds === "object" && !Array.isArray(j.rounds)))) return { ...j, rounds: j.rounds ?? {} };
  } catch {
    // falls through to the refusal
  }
  return fail(`${file} cannot be read as the rounds file: fix it or move it away.`);
}

/**
 * Writes the plan into `rounds.json` and returns the plan as recorded. The same plan again changes nothing; a different
 * one for a recorded round is refused unless `replan`, and a replan keeps every walk that already has a report in
 * `reports/`, or named in `keep` (the walks the server says have a report), exactly as it was (it holds its number; a new
 * walk with the same number is dropped). `dryRun` returns what would be recorded and writes nothing.
 */
export function recordRound(dir, plan, { replan = false, keep = [], dryRun = false } = {}) {
  const alsoKept = new Set(keep);
  const file = path.join(dir, ROUNDS_FILE);
  const all = readRounds(dir);
  const old = all.rounds[String(plan.round)];
  let walks = plan.walks;
  if (old) {
    const same = old.kind === plan.kind && old.seed === plan.seed && JSON.stringify(old.walks) === JSON.stringify(plan.walks);
    if (!same && !replan) {
      const what = [old.kind !== plan.kind && "a different kind (side or standard)", old.seed !== plan.seed && "a different seed", JSON.stringify(old.walks) !== JSON.stringify(plan.walks) && "different walks"].filter(Boolean).join(" and ");
      fail(`Round ${plan.round} is already planned with ${plural(Array.isArray(old.walks) ? old.walks.length : 0, "walk")}, and this plan has ${what}: ask to replan it to replace it.`);
    }
    if (!same) {
      const kept = (Array.isArray(old.walks) ? old.walks : []).filter((w) => typeof w?.id === "string" && (alsoKept.has(w.id) || fs.existsSync(path.join(dir, "reports", `${w.id}.md`))));
      const held = new Set(kept.map((w) => nnOf(w.id)));
      const keptIds = new Set(kept.map((w) => w.id));
      walks = [...kept, ...plan.walks.filter((w) => !keptIds.has(w.id) && !held.has(nnOf(w.id)))].sort((a, b) => nnOf(a.id) - nnOf(b.id));
    }
  }
  const recorded = { ...plan, walks };
  if (dryRun) return recorded;
  all.rounds[String(plan.round)] = { kind: plan.kind, seed: plan.seed, walks, avoid: plan.avoid ?? [], known: plan.known ?? [], ...(old?.published === true ? { published: true } : {}) };
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(file, `${JSON.stringify(all, null, 2)}\n`);
  return recorded;
}

/** Notes in `rounds.json` that the round was sent to the server, so a later replan asks the server which walks have a report. A round that is not recorded is left alone. */
export function markPublished(dir, round) {
  const all = readRounds(dir);
  const entry = all.rounds[String(round)];
  if (!entry || entry.published === true) return;
  entry.published = true;
  writeAtomic(path.join(dir, ROUNDS_FILE), `${JSON.stringify(all, null, 2)}\n`);
}
