import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { checkProject, loadProject, EXAMPLE_PROJECT, withDefaults, jobFits, personaFits, doorFits, ID_RE } from "../src/lib/persona/project.js";

const copy = (o) => JSON.parse(JSON.stringify(o));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "persona-project-"));
const paths = (r) => r.problems.map((p) => p.path);

test("the example project passes and has the promised shape", () => {
  const r = checkProject(EXAMPLE_PROJECT);
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.equal(EXAMPLE_PROJECT.personas.length, 3);
  assert.equal(EXAMPLE_PROJECT.doors.length, 3);
  assert.equal(EXAMPLE_PROJECT.doors.filter((d) => d.site_only).length, 1);
  assert.equal(EXAMPLE_PROJECT.jobs.length, 5);
  assert.ok(new Set(EXAMPLE_PROJECT.jobs.flatMap((j) => j.areas)).size >= 3);
  assert.equal(EXAMPLE_PROJECT.known.length, 2);
  assert.ok(JSON.stringify(EXAMPLE_PROJECT).includes("example.com"));
  assert.ok(!/ezi|ezihq|\bbos\b|duet|dani/i.test(JSON.stringify(EXAMPLE_PROJECT)));
});

test("a missing required field is a problem with a path, a message and a fix", () => {
  const p = copy(EXAMPLE_PROJECT);
  delete p.product.what;
  p.personas[0].context = "";
  delete p.jobs[0].steps;
  const r = checkProject(p);
  assert.equal(r.ok, false);
  assert.ok(paths(r).includes("product.what"));
  assert.ok(paths(r).includes("personas[0].context"));
  assert.ok(paths(r).includes("jobs[0].steps"));
  for (const x of r.problems) assert.ok(x.message && x.fix && typeof x.path === "string");
});

test("a job step needs a do; a door needs a start or steps; lists must not be empty", () => {
  const p = copy(EXAMPLE_PROJECT);
  p.jobs[0].steps = [{ done_when: "x" }];
  p.doors[0].start = "";
  p.doors[0].steps = [];
  assert.ok(paths(checkProject(p)).includes("jobs[0].steps[0].do"));
  assert.ok(paths(checkProject(p)).includes("doors[0]"));
  for (const k of ["personas", "doors", "jobs"]) {
    const q = copy(EXAMPLE_PROJECT);
    q[k] = [];
    assert.ok(paths(checkProject(q)).includes(k), k);
  }
});

test("a door with only steps, and a project with only the required fields, pass", () => {
  const minimal = {
    kind: "persona-project",
    v: 1,
    product: { name: "Thing", what: "Does a thing." },
    personas: [{ id: "a", name: "A", role: "owner", context: "Runs it." }],
    doors: [{ id: "d", label: "Arrives", steps: ["Open the link."] }],
    jobs: [{ id: "j", title: "Do it", steps: [{ do: "Do it." }] }],
  };
  assert.deepEqual(checkProject(minimal).problems, []);
  const full = withDefaults(minimal);
  assert.deepEqual(full.defaults, { walks: 12, jobs_per_walk: 2, minutes: 30, widths: [1280, 500] });
  assert.deepEqual(full.targets, { loops: 5, within_minutes: 30, first_aha_seconds: 120, stalls: 0 });
  assert.equal(full.words.who, "person");
  assert.equal(full.product.tester, "the tester");
  assert.deepEqual(full.jobs[0].for, { roles: [], tags: [], personas: [] });
});

test("an unknown key anywhere is a problem (a typo is never ignored)", () => {
  const p = copy(EXAMPLE_PROJECT);
  p.persona = [];
  p.personas[0].colour = "red";
  p.jobs[1].steps[0].dowhen = "x";
  p.defaults.walkz = 3;
  const r = paths(checkProject(p));
  for (const want of ["persona", "personas[0].colour", "jobs[1].steps[0].dowhen", "defaults.walkz"]) assert.ok(r.includes(want), want);
});

test("ids are slugs and unique per list; areas are slugs", () => {
  const p = copy(EXAMPLE_PROJECT);
  p.personas[0].id = "Plant Shop";
  p.doors[1].id = p.doors[0].id;
  p.jobs[0].areas = ["Stock Room"];
  p.fixing = ["Setup!"];
  const r = paths(checkProject(p));
  assert.ok(r.includes("personas[0].id"));
  assert.ok(r.includes("doors[1].id"));
  assert.ok(r.includes("jobs[0].areas[0]"));
  assert.ok(r.includes("fixing[0]"));
  assert.ok(ID_RE.test("a-b-2") && !ID_RE.test("a--b") && !ID_RE.test("A"));
});

test("a for or doors that names an unknown id is a problem", () => {
  const p = copy(EXAMPLE_PROJECT);
  p.jobs[0].for.personas = ["nobody"];
  p.jobs[1].doors = ["no-door"];
  const r = checkProject(p);
  assert.ok(paths(r).includes("jobs[0].for.personas"));
  assert.ok(paths(r).includes("jobs[1].doors"));
  assert.match(r.problems.find((x) => x.path === "jobs[1].doors").fix, /cold-app/);
});

test("types are checked: widths, numbers, booleans, words", () => {
  const p = copy(EXAMPLE_PROJECT);
  p.defaults.widths = [];
  p.defaults.walks = 0;
  p.targets.loops = "five";
  p.doors[0].exclusive = "yes";
  p.words.who = 3;
  p.words.steps.saw = 4;
  const r = paths(checkProject(p));
  for (const want of ["defaults.widths", "defaults.walks", "targets.loops", "doors[0].exclusive", "words.who", "words.steps.saw"]) assert.ok(r.includes(want), want);
});

test("job fitting: empty for fits everyone; empty doors fits every door that is not site-only; a site-only door only when listed", () => {
  const p = withDefaults(EXAMPLE_PROJECT);
  const [owner, solo, member] = p.personas;
  const [cold, , site] = p.doors;
  const job = (id) => p.jobs.find((j) => j.id === id);
  assert.equal(personaFits(job("record-a-sale"), member), true);
  assert.equal(personaFits(job("first-stock-list"), member), false);
  assert.equal(personaFits(job("first-stock-list"), owner), true);
  assert.equal(personaFits(job("first-stock-list"), solo), true);
  assert.equal(doorFits(job("record-a-sale"), site), false);
  assert.equal(doorFits(job("record-a-sale"), cold), true);
  assert.equal(jobFits(job("find-pricing"), member, site), true);
  assert.equal(jobFits(job("find-pricing"), member, cold), false);
  const tagged = { for: { roles: [], tags: ["solo"], personas: [] }, doors: [] };
  assert.equal(personaFits(tagged, solo), true);
  assert.equal(personaFits(tagged, owner), false);
  assert.equal(personaFits({ for: { roles: [], tags: [], personas: ["shop-assistant"] }, doors: [] }, member), true);
});

test("checkProject never throws, whatever it is given", () => {
  fc.assert(fc.property(fc.anything({ withNullPrototype: true, withBigInt: true }), (v) => {
    const r = checkProject(v);
    return typeof r.ok === "boolean" && Array.isArray(r.problems);
  }), { numRuns: 300 });
  for (const v of [null, undefined, 3, "x", [], () => 1, Symbol("s")]) assert.equal(checkProject(v).ok, false);
});

test("checkProject never throws on the example with one random field broken", () => {
  fc.assert(fc.property(fc.nat(40), fc.anything(), (i, junk) => {
    const p = copy(EXAMPLE_PROJECT);
    const keys = [];
    const walk = (o, at) => {
      if (o && typeof o === "object") for (const k of Object.keys(o)) { keys.push([o, k]); walk(o[k], at); }
    };
    walk(p, "");
    const [o, k] = keys[i % keys.length];
    o[k] = junk;
    const r = checkProject(p);
    return typeof r.ok === "boolean";
  }), { numRuns: 300 });
});

test("loadProject reads the file, fills defaults, and refuses in one sentence", () => {
  const dir = tmp();
  assert.throws(() => loadProject(dir), /no project\.json/);
  fs.writeFileSync(path.join(dir, "project.json"), "{ nope");
  assert.throws(() => loadProject(dir), /not valid JSON/);
  const bad = copy(EXAMPLE_PROJECT);
  delete bad.product.name;
  bad.mystery = 1;
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(bad));
  assert.throws(() => loadProject(dir), (e) => /2 problems/.test(e.message) && /product\.name/.test(e.message) && !e.message.includes("\n"));
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(EXAMPLE_PROJECT));
  const ok = loadProject(dir);
  assert.equal(ok.product.name, EXAMPLE_PROJECT.product.name);
  assert.equal(ok.doors[2].site_only, true);
});
