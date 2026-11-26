import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { EXAMPLE_PROJECT, withDefaults } from "../src/lib/persona/project.js";
import { planRound } from "../src/lib/persona/plan.js";
import { renderBrief, renderGuide, writeRound } from "../src/lib/persona/brief.js";
import { REPORT_TEMPLATE, submissionProblems } from "../src/lib/persona/report-shape.js";

const copy = (o) => JSON.parse(JSON.stringify(o));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "persona-brief-"));
const standard = planRound(EXAMPLE_PROJECT, { round: 1, walks: 6 });
const side = planRound(EXAMPLE_PROJECT, { round: 2, walks: 6, side: true });
const walkAt = (plan, door) => plan.walks.find((w) => w.door === door);
const index = (text, ...needles) => needles.map((n) => text.indexOf(n));
const ascending = (xs) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));

test("a standard brief has its sections in order", () => {
  const w = walkAt(standard, "cold-app");
  const b = renderBrief(EXAMPLE_PROJECT, standard, w);
  assert.ok(b.startsWith(`# Brief ${w.id}\n`));
  assert.ok(ascending(index(b, "# Brief", "Window width: **", "## Who you are", "## The test rig (not a finding)", "## Already known (do not report these)", "## What to do", "## Report")));
  assert.match(b, new RegExp(`\\*\\*${w.width} px\\*\\*`));
  assert.match(b, /about 30 minutes in one sitting/);
  assert.doesNotMatch(b, /This is a side walk/);
});

test("who you are carries the name, role, context, facts and voice", () => {
  const w = standard.walks[0];
  const p = EXAMPLE_PROJECT.personas.find((x) => x.id === w.persona);
  const b = renderBrief(EXAMPLE_PROJECT, standard, w);
  const who = b.slice(b.indexOf("## Who you are"), b.indexOf("## The test rig"));
  for (const t of [p.name, p.role, p.context, p.voice, ...p.facts]) assert.ok(who.includes(t), t);
});

test("the rig section and the known section appear only when there is something to say", () => {
  const p = copy(EXAMPLE_PROJECT);
  p.rig = [];
  p.known = [];
  const plan = planRound(p, { round: 1, walks: 3 });
  const b = renderBrief(p, plan, plan.walks[0]);
  assert.doesNotMatch(b, /The test rig/);
  assert.doesNotMatch(b, /Already known/);
  assert.match(b, /## What to do/);
});

test("the known list is numbered, each with its instead, behind the fixed opening", () => {
  const b = renderBrief(EXAMPLE_PROJECT, standard, standard.walks[0]);
  assert.ok(b.includes("If you meet one of these, do what it says, give it at most one line in Notes (\"known: ...\"), and write no finding for it. Something new and different in the same place still counts."));
  assert.match(b, /1\. Importing stock from a spreadsheet shows a spinner for up to a minute\. Add three items by hand instead\./);
  assert.match(b, /2\. The first screen guesses the currency as dollars\. Leave it and carry on\./);
});

test("in a side round the known items whose area is being fixed come first, and the side paragraph appears", () => {
  const b = renderBrief(EXAMPLE_PROJECT, side, side.walks[0]);
  assert.ok(b.includes("This is a side walk: other parts of Tillbook are being fixed right now, so this walk stays in parts nobody is changing"));
  assert.ok(b.indexOf("This is a side walk") < b.indexOf("## Who you are"));
  assert.match(b, /1\. The first screen guesses the currency as dollars/);
  assert.match(b, /2\. Importing stock from a spreadsheet/);
});

test("what to do: arrive through the door, one numbered item per job with steps and done-when, then last", () => {
  const w = walkAt(standard, "cold-app");
  const b = renderBrief(EXAMPLE_PROJECT, standard, w);
  const todo = b.slice(b.indexOf("## What to do"), b.indexOf("## Report"));
  assert.match(todo, /1\. \*\*Arrive\.\*\*/);
  assert.ok(todo.includes("https://app.example.com/"));
  assert.ok(todo.includes("The sign-in link, given in chat."));
  assert.ok(todo.includes("Open the first link and sign in with the link you were given in chat."));
  w.jobs.forEach((id, i) => {
    const job = EXAMPLE_PROJECT.jobs.find((j) => j.id === id);
    assert.ok(todo.includes(`${i + 2}. **Job ${i + 1}: ${job.title}** (job \`${id}\`, ${job.steps.length} step${job.steps.length === 1 ? "" : "s"})`), id);
    for (const s of job.steps) assert.ok(todo.includes(`${s.do} (Done when: ${s.done_when})`));
  });
  assert.match(todo, /each (step )?is a loop in the report/i);
  assert.match(todo, new RegExp(`${w.jobs.length + 2}\\. \\*\\*Last\\.\\*\\*[^\\n]*come back[^\\n]*pay`));
});

test("the report section names start_walk, submit_report, the guide, and the job keys", () => {
  const w = walkAt(standard, "cold-app");
  const b = renderBrief(EXAMPLE_PROJECT, standard, w);
  const rep = b.slice(b.indexOf("## Report"));
  assert.match(rep, /Call `start_walk` just before you begin\. Hand the report in with `submit_report`; the exact shape is in the connector's `guide`\./);
  assert.ok(rep.includes('jobs: [{n, job, finished, steps_done, steps, gave_up_at, line}]'));
  assert.ok(rep.includes("would_pay"));
  assert.ok(rep.includes(w.id));
});

test("a site-only walk with no job says to read the page as the reader and report what they understood", () => {
  const p = copy(EXAMPLE_PROJECT);
  p.jobs = p.jobs.filter((j) => j.id !== "find-pricing");
  const plan = planRound(p, { round: 1, walks: 6 });
  const w = walkAt(plan, "public-page");
  const b = renderBrief(p, plan, w);
  assert.ok(b.includes("a shop owner who found the page through a search"));
  assert.match(b, /report what (they|you) understood/i);
  assert.doesNotMatch(b, /\*\*Job 1/);
  assert.doesNotMatch(b, /jobs: \[\{n, job/);
});

test("a site-only walk with a job lists it", () => {
  const b = renderBrief(EXAMPLE_PROJECT, standard, walkAt(standard, "public-page"));
  assert.match(b, /\*\*Job 1: The price of the product found\*\*/);
});

test("a brief that cannot be built from a walk not in the plan is refused", () => {
  assert.throws(() => renderBrief(EXAMPLE_PROJECT, standard, { id: "r1-99-x-y", persona: "nobody", door: "cold-app", jobs: [], width: 1280 }), /nobody/);
});

test("the guide has its parts, the project rules and the fixed ground rules", () => {
  const g = renderGuide(EXAMPLE_PROJECT, standard);
  for (const part of ["next_walk", "start_walk", "submit_report", "ask", "answers", "check_again_minutes", "notes"]) assert.ok(g.includes(part), part);
  for (const r of EXAMPLE_PROJECT.rules) assert.ok(g.includes(r), r);
  assert.match(g, /never copy a sign-in link or anything after a `#`/i);
  assert.match(g, /one walk at a time/i);
  assert.match(g, /never check[^.]*(during|while)[^.]*walk/i);
  assert.match(g, /Saw[^\n]*\n[^\n]*Used[^\n]*\n[^\n]*Reacted[^\n]*\n[^\n]*Invented/);
  assert.doesNotMatch(g, /side walk|being fixed right now/i);
});

test("the guide names which doors share one test account when any is exclusive, and omits it when none is", () => {
  const g = renderGuide(EXAMPLE_PROJECT, standard);
  assert.match(g, /never two at once/i);
  assert.ok(g.includes("Opens the app cold"));
  const p = copy(EXAMPLE_PROJECT);
  p.doors.forEach((d) => (d.exclusive = false));
  assert.doesNotMatch(renderGuide(p, planRound(p, { round: 1, walks: 3 })), /never two at once/i);
});

test("a side guide names the areas to stay out of", () => {
  const g = renderGuide(EXAMPLE_PROJECT, side);
  assert.match(g, /Already known and being fixed/);
  assert.ok(g.includes("setup, billing"));
  assert.match(g, /side/i);
});

test("the guide's report template is REPORT_TEMPLATE verbatim in a four-backtick fence, and its json block is accepted", () => {
  for (const [project, plan] of [[EXAMPLE_PROJECT, standard], [EXAMPLE_PROJECT, side]]) {
    const g = renderGuide(project, plan);
    const template = REPORT_TEMPLATE("<walk id>", withDefaults(project).product.tester);
    assert.ok(g.includes(`\`\`\`\`\n${template.trimEnd()}\n\`\`\`\``), "template in a four-backtick fence");
    const fenced = /````\n([\s\S]*?)\n````/.exec(g)[1];
    const json = /```json\n([\s\S]*?)\n```/.exec(fenced)[1];
    assert.doesNotThrow(() => JSON.parse(json));
    const { problems } = submissionProblems(fenced, "<walk id>");
    assert.deepEqual(problems, []);
    const again = submissionProblems(`# Report\n\n\`\`\`json\n${json}\n\`\`\`\n`, "<walk id>");
    assert.deepEqual(again.problems, []);
  }
});

test("the guide states the block rules", () => {
  const g = renderGuide(EXAMPLE_PROJECT, standard);
  assert.match(g, /severity/);
  assert.match(g, /`blocker`, `confusing`, `rough`, `idea`/);
  assert.match(g, /`"stall": true`/);
  assert.match(g, /never includes a `#`/);
});

test("words from the project replace the built-in loop and step wording", () => {
  const p = copy(EXAMPLE_PROJECT);
  p.words = { loop: "A loop is one question and one answer.", steps: { saw: "Did I see it work alone?", used: null, reacted: null, invented: null }, who: "shopkeeper" };
  const g = renderGuide(p, planRound(p, { round: 1, walks: 3 }));
  assert.ok(g.includes("A loop is one question and one answer."));
  assert.ok(g.includes("Did I see it work alone?"));
  assert.ok(g.includes("shopkeeper"));
  assert.match(g, /Used: did I make/);
});

test("writeRound writes the briefs and the guide, removes stale briefs, and never touches a report", () => {
  const dir = tmp();
  const out = writeRound(dir, EXAMPLE_PROJECT, standard);
  const folder = path.join(dir, "briefs", "r1");
  assert.deepEqual(fs.readdirSync(folder).sort(), [...standard.walks.map((w) => `${w.id}.md`), "guide.md"].sort());
  assert.equal(fs.readFileSync(path.join(folder, `${standard.walks[0].id}.md`), "utf8"), renderBrief(EXAMPLE_PROJECT, standard, standard.walks[0]));
  assert.equal(fs.readFileSync(path.join(folder, "guide.md"), "utf8"), renderGuide(EXAMPLE_PROJECT, standard));
  assert.equal(out.briefs.length, 6);
  fs.mkdirSync(path.join(dir, "reports"));
  fs.writeFileSync(path.join(dir, "reports", "r1-99-gone.md"), "keep");
  fs.writeFileSync(path.join(folder, "r1-99-gone.md"), "stale");
  fs.writeFileSync(path.join(folder, "notes.txt"), "mine");
  const smaller = planRound(EXAMPLE_PROJECT, { round: 1, walks: 3 });
  writeRound(dir, EXAMPLE_PROJECT, smaller);
  assert.deepEqual(fs.readdirSync(folder).filter((f) => f.endsWith(".md")).sort(), [...smaller.walks.map((w) => `${w.id}.md`), "guide.md"].sort());
  assert.ok(fs.existsSync(path.join(folder, "notes.txt")));
  assert.equal(fs.readFileSync(path.join(dir, "reports", "r1-99-gone.md"), "utf8"), "keep");
  assert.deepEqual(fs.readdirSync(folder).filter((f) => f.endsWith(".tmp")), []);
});

test("no product name of ours appears in any rendered brief or guide", () => {
  const all = [renderGuide(EXAMPLE_PROJECT, standard), renderGuide(EXAMPLE_PROJECT, side), ...standard.walks.map((w) => renderBrief(EXAMPLE_PROJECT, standard, w)), ...side.walks.map((w) => renderBrief(EXAMPLE_PROJECT, side, w))].join("\n");
  assert.doesNotMatch(all, /ezi|ezihq|\bbos\b|duet|dani/i);
});

test("property: every planned walk renders a brief naming its id and every job's title and steps", () => {
  const project = withDefaults(EXAMPLE_PROJECT);
  fc.assert(fc.property(fc.integer({ min: 1, max: 12 }), fc.string({ maxLength: 6 }), fc.boolean(), (walks, seed, isSide) => {
    const plan = planRound(EXAMPLE_PROJECT, { round: 1, walks, seed, side: isSide });
    for (const w of plan.walks) {
      const b = renderBrief(EXAMPLE_PROJECT, plan, w);
      assert.ok(b.includes(`# Brief ${w.id}`));
      assert.equal(b.includes("This is a side walk"), isSide);
      for (const id of w.jobs) {
        const job = project.jobs.find((j) => j.id === id);
        assert.ok(b.includes(job.title));
        for (const s of job.steps) assert.ok(b.includes(s.do));
      }
    }
  }), { numRuns: 60 });
});
