import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { EXAMPLE_PROJECT, withDefaults, jobFits, touches } from "../src/lib/persona/project.js";
import { planRound, checkCoverage, recordRound, historyOf } from "../src/lib/persona/plan.js";
import { REPORT_NAME } from "../src/lib/persona/report-shape.js";

const project = withDefaults(EXAMPLE_PROJECT);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "persona-plan-"));
const copy = (o) => JSON.parse(JSON.stringify(o));
const pair = (w) => `${w.persona}|${w.door}`;

test("a 6-walk standard round plans with no coverage problem and covers every door and persona", () => {
  const plan = planRound(EXAMPLE_PROJECT, { round: 1, walks: 6 });
  assert.deepEqual(checkCoverage(plan, project), []);
  assert.equal(plan.kind, "standard");
  assert.equal(plan.round, 1);
  assert.equal(plan.seed, "r1");
  assert.deepEqual(plan.avoid, []);
  assert.equal(plan.walks.length, 6);
  assert.equal(new Set(plan.walks.map((w) => w.persona)).size, 3);
  assert.equal(new Set(plan.walks.map((w) => w.door)).size, 3);
  assert.equal(new Set(plan.walks.map(pair)).size, 6);
});

test("walk ids are r<round>-<nn>-<persona>-<door>, valid report names, and widths alternate", () => {
  const plan = planRound(EXAMPLE_PROJECT, { round: 3, walks: 4 });
  plan.walks.forEach((w, i) => {
    assert.equal(w.id, `r3-0${i + 1}-${w.persona}-${w.door}`);
    assert.match(w.id, REPORT_NAME);
    assert.equal(w.width, [1280, 500][i % 2]);
  });
});

test("a long id is clipped to 60 characters and stays unique", () => {
  const p = copy(EXAMPLE_PROJECT);
  const long = "a-very-long-persona-name-that-goes-on-and-on-and-on";
  p.personas = [{ ...p.personas[0], id: long }, { ...p.personas[1], id: `${long}-two` }];
  p.jobs[0].for = { roles: [], tags: [], personas: [] };
  p.jobs.forEach((j) => (j.for = { roles: [], tags: [], personas: [] }));
  p.doors[0].id = "x".repeat(40);
  p.jobs.forEach((j) => (j.doors = j.doors.map((d) => (d === "cold-app" ? p.doors[0].id : d))));
  const plan = planRound(p, { round: 12, walks: 6 });
  for (const w of plan.walks) {
    assert.ok(w.id.length <= 60, w.id);
    assert.doesNotMatch(w.id, /-$/);
    assert.match(w.id, REPORT_NAME);
  }
  assert.equal(new Set(plan.walks.map((w) => w.id)).size, plan.walks.length);
});

test("planning is deterministic for the same inputs and differs for another seed", () => {
  const a = planRound(EXAMPLE_PROJECT, { round: 1, walks: 6 });
  assert.deepEqual(planRound(EXAMPLE_PROJECT, { round: 1, walks: 6 }), a);
  const seeds = ["a", "b", "c", "d"].map((s) => JSON.stringify(planRound(EXAMPLE_PROJECT, { round: 1, walks: 6, seed: s }).walks));
  assert.ok(new Set(seeds).size > 1);
});

test("jobs rotate: every fitting job is used before one repeats, and a walk never gets one twice", () => {
  const plan = planRound(EXAMPLE_PROJECT, { round: 1, walks: 9, jobsPerWalk: 2 });
  for (const w of plan.walks) assert.equal(new Set(w.jobs).size, w.jobs.length);
  const used = new Set(plan.walks.flatMap((w) => w.jobs));
  assert.equal(used.size, project.jobs.length);
  // with one job a walk, the first jobs-count walks that can take a job use different jobs
  const one = planRound(EXAMPLE_PROJECT, { round: 1, walks: 3, jobsPerWalk: 1 });
  assert.equal(new Set(one.walks.flatMap((w) => w.jobs)).size, 3);
});

test("a site-only door gets only the jobs that list it; with none, its walk has no jobs", () => {
  const plan = planRound(EXAMPLE_PROJECT, { round: 1, walks: 9 });
  for (const w of plan.walks.filter((x) => x.door === "public-page")) assert.deepEqual(w.jobs, ["find-pricing"]);
  const p = copy(EXAMPLE_PROJECT);
  p.jobs = p.jobs.filter((j) => j.id !== "find-pricing");
  const q = planRound(p, { round: 1, walks: 6 });
  for (const w of q.walks.filter((x) => x.door === "public-page")) assert.deepEqual(w.jobs, []);
  assert.deepEqual(checkCoverage(q, withDefaults(p)), []);
});

test("history: a pair walked before is not used again until every pair has been", () => {
  let history = [];
  const seen = new Map();
  for (let round = 1; round <= 4; round++) {
    const plan = planRound(EXAMPLE_PROJECT, { round, walks: 3, history });
    assert.deepEqual(checkCoverage(plan, project), [], `round ${round}`);
    for (const w of plan.walks) {
      const n = seen.get(pair(w)) ?? 0;
      // 9 pairs, 3 a round: no pair twice in the first three rounds
      if (round <= 3) assert.equal(n, 0, `round ${round} ${pair(w)}`);
      seen.set(pair(w), n + 1);
    }
    history = history.concat(plan.walks);
  }
  assert.equal(seen.size, 9);
});

test("history also rotates jobs across rounds", () => {
  const only = { doors: ["cold-app"], personas: ["plant-shop-owner"] };
  const first = planRound(EXAMPLE_PROJECT, { round: 1, walks: 2, jobsPerWalk: 1, only });
  const second = planRound(EXAMPLE_PROJECT, { round: 2, walks: 2, jobsPerWalk: 1, only, history: first.walks });
  const all = [...first.walks, ...second.walks].flatMap((w) => w.jobs);
  assert.equal(new Set(all).size, 4);
});

test("historyOf reads rounds.json, oldest round first, optionally only before a round", () => {
  const rounds = { rounds: { 2: { walks: [{ id: "b" }] }, 1: { walks: [{ id: "a" }] }, 10: { walks: [{ id: "c" }] } } };
  assert.deepEqual(historyOf(rounds).map((w) => w.id), ["a", "b", "c"]);
  assert.deepEqual(historyOf(rounds, 2).map((w) => w.id), ["a"]);
  assert.deepEqual(historyOf(null), []);
});

test("a side round avoids the fixing areas: no job or door that touches them is dealt", () => {
  const plan = planRound(EXAMPLE_PROJECT, { round: 2, walks: 6, side: true });
  assert.equal(plan.kind, "side");
  assert.deepEqual(plan.avoid, ["setup", "billing"]);
  for (const w of plan.walks) {
    assert.ok(!w.jobs.includes("supplier-order"));
    for (const id of w.jobs) assert.ok(!touches(project.jobs.find((j) => j.id === id).areas, plan.avoid));
  }
  assert.deepEqual(checkCoverage(plan, project), []);
  assert.deepEqual(planRound(EXAMPLE_PROJECT, { round: 2, walks: 6 }).avoid, []);
});

test("a side round that would leave no door or no job refuses in one sentence naming what is left out", () => {
  const p = copy(EXAMPLE_PROJECT);
  p.fixing = ["sign-in", "pricing", "invite"];
  assert.throws(() => planRound(p, { round: 2, side: true }), (e) => /cold-app/.test(e.message) && /sign-in/.test(e.message) && !e.message.includes("\n") && /door/.test(e.message));
  const q = copy(EXAMPLE_PROJECT);
  q.fixing = ["stock", "sales", "orders", "reports"];
  q.doors = q.doors.filter((d) => !d.site_only);
  q.jobs = q.jobs.filter((j) => j.id !== "find-pricing");
  assert.throws(() => planRound(q, { round: 2, side: true }), (e) => /first-stock-list/.test(e.message) && /job/.test(e.message));
});

test("only narrows the doors, personas and jobs; an unknown id is refused", () => {
  const plan = planRound(EXAMPLE_PROJECT, { round: 1, walks: 4, only: { doors: ["cold-app"], personas: ["stall-seller", "plant-shop-owner"], jobs: ["record-a-sale"] } });
  for (const w of plan.walks) {
    assert.equal(w.door, "cold-app");
    assert.ok(["stall-seller", "plant-shop-owner"].includes(w.persona));
    assert.deepEqual(w.jobs, ["record-a-sale"]);
  }
  assert.throws(() => planRound(EXAMPLE_PROJECT, { round: 1, only: { doors: ["nope"] } }), /nope/);
});

test("planRound refuses a broken project, a bad round and walks in one sentence", () => {
  const p = copy(EXAMPLE_PROJECT);
  delete p.product.name;
  assert.throws(() => planRound(p, { round: 1 }), /product\.name/);
  assert.throws(() => planRound(EXAMPLE_PROJECT, { round: 0 }), /round/);
  assert.throws(() => planRound(EXAMPLE_PROJECT, { round: 1, walks: 0 }), /walks/);
});

test("checkCoverage names what is wrong with a hand-made plan", () => {
  const plan = planRound(EXAMPLE_PROJECT, { round: 1, walks: 6 });
  const broken = copy(plan);
  broken.walks[0].jobs = ["first-stock-list", "first-stock-list"];
  broken.walks[1].persona = "shop-assistant";
  broken.walks[1].jobs = ["first-stock-list"];
  broken.walks[2].door = "ghost";
  broken.walks[3].id = broken.walks[4].id;
  const problems = checkCoverage(broken, project);
  assert.ok(problems.some((p) => /twice/.test(p)));
  assert.ok(problems.some((p) => /does not fit/.test(p)));
  assert.ok(problems.some((p) => /ghost/.test(p)));
  assert.ok(problems.some((p) => /same id/.test(p)));
  const noDoor = copy(plan);
  noDoor.walks = noDoor.walks.filter((w) => w.door !== "public-page");
  assert.ok(checkCoverage(noDoor, project).some((p) => /public-page/.test(p)));
  const side = planRound(EXAMPLE_PROJECT, { round: 2, walks: 6, side: true });
  side.walks[0].jobs = ["supplier-order"];
  assert.ok(checkCoverage(side, project).some((p) => /supplier-order/.test(p) && /billing/.test(p)));
});

test("recordRound writes rounds.json; the same plan again reproduces it; a different one is refused unless replan", () => {
  const dir = tmp();
  const plan = planRound(EXAMPLE_PROJECT, { round: 1, walks: 4 });
  recordRound(dir, plan);
  const file = path.join(dir, "rounds.json");
  const first = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(first.rounds), ["1"]);
  assert.equal(first.rounds["1"].kind, "standard");
  assert.equal(first.rounds["1"].seed, "r1");
  assert.deepEqual(first.rounds["1"].walks, plan.walks);
  assert.deepEqual(first.rounds["1"].avoid, []);
  assert.deepEqual(first.rounds["1"].known, ["k1", "k2"]);
  recordRound(dir, planRound(EXAMPLE_PROJECT, { round: 1, walks: 4 }));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), first);
  const other = planRound(EXAMPLE_PROJECT, { round: 1, walks: 5, seed: "z" });
  assert.throws(() => recordRound(dir, other), /Round 1/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), first);
  recordRound(dir, other, { replan: true });
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).rounds["1"].walks.length, 5);
  recordRound(dir, planRound(EXAMPLE_PROJECT, { round: 2, walks: 2 }));
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).rounds).sort(), ["1", "2"]);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
});

test("a replan never drops a walk that already has a report", () => {
  const dir = tmp();
  const plan = planRound(EXAMPLE_PROJECT, { round: 1, walks: 4 });
  recordRound(dir, plan);
  fs.mkdirSync(path.join(dir, "reports"));
  const kept = plan.walks[1];
  fs.writeFileSync(path.join(dir, "reports", `${kept.id}.md`), "# Report\n");
  const again = planRound(EXAMPLE_PROJECT, { round: 1, walks: 4, seed: "other" });
  const written = recordRound(dir, again, { replan: true });
  assert.deepEqual(written.walks.find((w) => w.id === kept.id), kept);
  assert.equal(new Set(written.walks.map((w) => w.id)).size, written.walks.length);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "rounds.json"), "utf8")).rounds["1"];
  assert.deepEqual(onDisk.walks, written.walks);
  assert.ok(written.walks.every((w, i, a) => i === 0 || Number(w.id.split("-")[1]) > Number(a[i - 1].id.split("-")[1])));
});

test("recordRound refuses a rounds.json it cannot read, in one sentence, and leaves it", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "rounds.json"), "{ broken");
  assert.throws(() => recordRound(dir, planRound(EXAMPLE_PROJECT, { round: 1, walks: 2 })), /rounds\.json/);
  assert.equal(fs.readFileSync(path.join(dir, "rounds.json"), "utf8"), "{ broken");
});

const planArb = fc.record({
  round: fc.integer({ min: 1, max: 30 }),
  walks: fc.integer({ min: 1, max: 24 }),
  jobsPerWalk: fc.integer({ min: 1, max: 4 }),
  seed: fc.string({ maxLength: 8 }),
  side: fc.boolean(),
});

test("property: every walk's jobs fit its persona and door, with no job twice in a walk", () => {
  fc.assert(fc.property(planArb, ({ round, walks, jobsPerWalk, seed, side }) => {
    const plan = planRound(EXAMPLE_PROJECT, { round, walks, jobsPerWalk, seed, side });
    assert.equal(plan.walks.length, walks);
    for (const w of plan.walks) {
      const persona = project.personas.find((p) => p.id === w.persona);
      const door = project.doors.find((d) => d.id === w.door);
      assert.ok(persona && door);
      assert.ok(w.jobs.length <= jobsPerWalk);
      assert.equal(new Set(w.jobs).size, w.jobs.length);
      for (const id of w.jobs) assert.ok(jobFits(project.jobs.find((j) => j.id === id), persona, door));
      if (!door.site_only) assert.ok(w.jobs.length >= 1);
    }
    assert.deepEqual(checkCoverage(plan, project), []);
  }), { numRuns: 150 });
});

test("property: a side plan never contains an avoided area, for any fixing list", () => {
  const areas = ["setup", "billing", "stock", "sales", "orders", "reports", "pricing", "sign-in", "invite"];
  fc.assert(fc.property(fc.subarray(areas), planArb, (fixing, { round, walks, jobsPerWalk, seed }) => {
    const p = { ...copy(EXAMPLE_PROJECT), fixing };
    let plan;
    try {
      plan = planRound(p, { round, walks, jobsPerWalk, seed, side: true });
    } catch (e) {
      assert.match(e.message, /side round/i);
      return;
    }
    assert.deepEqual(plan.avoid, fixing);
    const full = withDefaults(p);
    for (const w of plan.walks) {
      assert.ok(!touches(full.doors.find((d) => d.id === w.door).areas, fixing));
      for (const id of w.jobs) assert.ok(!touches(full.jobs.find((j) => j.id === id).areas, fixing));
    }
  }), { numRuns: 200 });
});

test("property: with history, planned rounds keep coverage and spend every pair before repeating one", () => {
  fc.assert(fc.property(fc.string({ maxLength: 6 }), fc.integer({ min: 2, max: 5 }), (seed, walks) => {
    let history = [];
    const used = new Map();
    for (let round = 1; round <= 5; round++) {
      const plan = planRound(EXAMPLE_PROJECT, { round, walks, seed, history });
      for (const w of plan.walks) {
        if (used.has(pair(w))) assert.equal(used.size, 9, `${pair(w)} repeated before every pair was walked`);
        used.set(pair(w), (used.get(pair(w)) ?? 0) + 1);
      }
      history = history.concat(plan.walks);
    }
  }), { numRuns: 40 });
});
