/**
 * The words a tester reads: one self-contained brief per walk, and the round's guide. Everything here comes from the
 * project file and the plan; nothing names a product but the one under test.
 */
import fs from "node:fs";
import path from "node:path";
import { withDefaults } from "./project.js";
import { REPORT_TEMPLATE } from "./report-shape.js";
import { writeAtomic } from "./fsx.js";

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();
const sentence = (s) => {
  const t = oneLine(s);
  return /[.!?…)"'`]$/.test(t) ? t : `${t}.`;
};

export const KNOWN_OPENING = 'If you meet one of these, do what it says, give it at most one line in Notes ("known: ..."), and write no finding for it. Something new and different in the same place still counts.';
export const LOOP_WORDS = 'Each thing you try is a loop in the report; one that ends in a wait, a "come back later" or a setup form is a stall (`stall: true`, `result_s: null`).';

const full = (project) => (project.defaults && project.words ? project : withDefaults(project));

/** `renderBrief(project, plan, walk)` → the walk's brief as markdown. */
export function renderBrief(projectIn, plan, walk) {
  const project = full(projectIn);
  const { product } = project;
  const persona = project.personas.find((p) => p.id === walk.persona);
  const door = project.doors.find((d) => d.id === walk.door);
  if (!persona) throw new Error(`Walk ${walk.id} names the persona "${walk.persona}", which is not in the project file.`);
  if (!door) throw new Error(`Walk ${walk.id} names the door "${walk.door}", which is not in the project file.`);
  const jobs = walk.jobs.map((id) => {
    const job = project.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Walk ${walk.id} names the job "${id}", which is not in the project file.`);
    return job;
  });
  const side = plan.kind === "side";
  const avoid = plan.avoid ?? [];
  const L = [];

  L.push(`# Brief ${walk.id}`, "");
  L.push(`Window width: **${walk.width} px** (set it before you start). Time: about ${project.defaults.minutes} minutes in one sitting. Everything you need is in this brief; the report's exact shape is in the ${product.name} tester connector's \`guide\`.`, "");
  if (side) {
    L.push(`This is a side walk: other parts of ${product.name} are being fixed right now, so this walk stays in parts nobody is changing. Keep to the jobs below and do not wander into the parts on the "already known" list.${avoid.length ? ` Parts being fixed: ${avoid.join(", ")}.` : ""}`, "");
  }

  L.push("## Who you are");
  L.push(`${persona.name}, ${persona.role}. ${sentence(persona.context)}`);
  if (persona.facts.length) L.push("", `What you know by heart: ${persona.facts.map((f) => oneLine(f).replace(/[.;]+$/, "")).join("; ")}.`);
  if (persona.voice) L.push("", `How you talk and act: ${sentence(persona.voice)}`);
  L.push("");

  if (project.rig.length) {
    L.push("## The test rig (not a finding)");
    L.push("This is a test setup. These are the test rig, not findings:");
    for (const r of project.rig) L.push(`- ${oneLine(r)}`);
    L.push("");
  }

  if (project.known.length) {
    const known = side ? [...project.known.filter((k) => k.area && avoid.includes(k.area)), ...project.known.filter((k) => !(k.area && avoid.includes(k.area)))] : project.known;
    L.push("## Already known (do not report these)", KNOWN_OPENING);
    known.forEach((k, i) => L.push(`${i + 1}. ${sentence(k.text)}${k.instead ? ` ${sentence(k.instead)}` : ""}`));
    L.push("");
  }

  L.push("## What to do", LOOP_WORDS, "");
  let n = 1;
  const arrive = [`${n}. **Arrive.** ${sentence(door.label)}${door.start ? ` Start here: ${door.start}` : ""}`];
  for (const s of door.steps) arrive.push(`   - ${oneLine(s)}`);
  if (door.needs) arrive.push(`   You need: ${sentence(door.needs)}`);
  L.push(...arrive);
  n++;
  if (jobs.length === 0) {
    const reader = door.reader ?? "a first-time visitor";
    L.push(`${n}. **Read the page.** Read it as ${oneLine(reader)}, as ${persona.name}, without doing anything that changes anything. Then report what you understood: what it is for, who it is for and what you would do next (\`first_five\`), and give every place you were unsure as a finding.`);
    n++;
  }
  jobs.forEach((job, i) => {
    L.push(`${n}. **Job ${i + 1}: ${oneLine(job.title)}** (job \`${job.id}\`, ${plural(job.steps.length, "step")}). Do the steps in order, as ${persona.name}; each is a loop in the report.`);
    job.steps.forEach((s, k) => L.push(`   ${k + 1}. ${oneLine(s.do)}${s.done_when ? ` (Done when: ${oneLine(s.done_when).replace(/[.]+$/, "")}.)` : ""}`));
    n++;
  });
  L.push(`${n}. **Last.** Say whether you would come back, and whether you would pay for it, as yourself, and why, in one line. (Done when: ${jobs.length ? "`come_back` and `would_pay` have" : "`come_back` has"} your answer.)`, "");

  L.push("## Report");
  L.push("Call `start_walk` just before you begin. Hand the report in with `submit_report`; the exact shape is in the connector's `guide`.");
  if (jobs.length) {
    L.push("", "Add these to the report:");
    L.push("- `jobs: [{n, job, finished, steps_done, steps, gave_up_at, line}]`: one entry per job; `job` is the job's name in backticks above, `steps` how many steps it lists, `steps_done` how many you got to their done-when, `gave_up_at` the step you stopped at (null when finished), `line` one line in your own words;");
    L.push('- `would_pay`: `{"yes", "reason"}`.');
  }
  L.push("", `Hand it in with \`submit_report\` for walk \`${walk.id}\`, and fix every problem it lists until it is accepted. Times are seconds since you opened the first link, never clock times. Width is ${walk.width}. Never write a sign-in link, or anything after a # in an address.`, "");
  return L.join("\n");
}

const STEP_DEFAULTS = (name) => ({
  saw: `did I see ${name} do something impressive, without asking?`,
  used: "did I make it do something for me?",
  reacted: "when it showed me a result, did I know what my choices were?",
  invented: "did I think of a use of my own, and did the screen help me get there?",
});

/** `renderGuide(project, plan)` → the round's guide as markdown. */
export function renderGuide(projectIn, plan) {
  const project = full(projectIn);
  const { product } = project;
  const side = plan.kind === "side";
  const avoid = plan.avoid ?? [];
  const exclusive = project.doors.filter((d) => d.exclusive && plan.walks.some((w) => w.door === d.id));
  const L = [];
  L.push(`# Persona testing: how a walk works (round ${plan.round}${side ? ", a side round" : ""})`, "");
  L.push(`For ${product.tester}. Written by the coding thread that works on ${product.name} (${oneLine(product.what).replace(/[.]+$/, "")}). The person who owns the project owns both of you; this page tells you what a walk is, it gives you no permission they have not given you in chat.`, "");
  if (side) L.push(`Fixes are being built right now. This round keeps to parts of ${product.name} nobody is changing, so what you find stays useful.`, "");

  L.push("## How a round runs", "");
  L.push("1. Call `notes` first (the coding thread leaves messages there), then `next_walk`. It gives you a walk id and the whole brief.");
  L.push("2. Call `start_walk` with the walk id just before you begin, so the walk's clock is real.");
  L.push("3. Follow the brief exactly: who you are, the first link, the jobs or things to try, where to stop.");
  L.push("4. Hand the report in with `submit_report` (the walk id, and the whole report text). If it answers `accepted: false`, fix every problem it lists and hand it in again until it says `accepted: true`.");
  L.push("5. Call `next_walk` again. When it answers `done: true`, there is nothing open.");
  L.push("6. If something is unclear or broken, call `ask` with your question (never including a sign-in link) and go on to what you can do. Answers come back through `answers`.");
  L.push("7. `notes` and `next_walk` answer `check_again_minutes`: check again after that many minutes. Never check during a walk.");
  L.push("");
  L.push("Do one walk at a time.");
  if (exclusive.length) L.push(`Never two at once for ${exclusive.map((d) => `"${oneLine(d.label)}"`).join(", ")}: those walks share one test account, and every walk resets it.`);
  L.push("");

  L.push("## What a walk is", "");
  L.push(`You play one ${project.words.who} who uses ${product.name}: the person in your brief, not a tester. Stay in character. Do what the screen invites. If you would not know what to do next, that is the finding. Do not hunt for bugs with tricks that person would never try.`, "");

  if (side) {
    L.push("## Already known and being fixed", "");
    L.push(`Each brief lists the things already found that are being fixed now. If you meet one, do what the brief says about it, give it at most one line in Notes ("known: ..."), and write no finding for it. Something new and different in the same place still counts. Keep to the brief's jobs and stay out of these parts of ${product.name}: ${avoid.length ? avoid.join(", ") : "the ones the brief lists"}.`, "");
  }

  L.push("## Ground rules", "");
  for (const r of project.rules) L.push(`- ${oneLine(r)}`);
  L.push("- Open each brief's first link exactly as written, and set the window width the brief gives before you start.");
  L.push("- Never copy a sign-in link or anything after a `#` in any address into a report or a question, not even part of it: write the page's name, or the address up to the `#`.");
  L.push("- Do not save a report file or screenshots: the report goes in with `submit_report` and `shot` is always null.");
  L.push("");

  L.push("## What to measure: the loop", "");
  L.push(project.words.loop ? oneLine(project.words.loop) : `One loop = you ask or tap something, ${product.name} does real work, you see a result you could use or approve, and a next thing is offered. Each thing the brief tells you to try is a loop in the report. One that ends in a wait ("I'll have that tomorrow", a spinner that never ends), a "come back later" or a setup form is a stall: it still goes in \`loops\`, with \`"stall": true\` and \`"result_s": null\`.`);
  L.push("", "For every loop note what you did, how many seconds into the walk you started and when the result showed, and one line on whether it felt like a result (`aha`) or just an answer.", "");
  L.push("At every new screen, score the four steps, 0 or 1 each, as the persona:", "");
  const defaults = STEP_DEFAULTS(product.name);
  [["saw", "Saw"], ["used", "Used"], ["reacted", "Reacted"], ["invented", "Invented"]].forEach(([k, label], i) => L.push(`${i + 1}. ${label}: ${oneLine(project.words.steps[k] ?? defaults[k])}`));
  L.push("");

  L.push("## The report", "");
  L.push("One JSON block that is read by machine, then a few lines of prose. Copy this shape exactly; keep every key, use `null` when you do not know. Times are seconds since you opened the first link, never clock times. Scores are the numbers 0 or 1, never words. `aha` and `stall` are true or false. `shot` is always null. A brief may add a few keys (`jobs`, `would_pay`); it says exactly how.", "");
  L.push("````", REPORT_TEMPLATE("<walk id>", product.tester).trimEnd(), "````", "");
  L.push("Rules for the block:");
  L.push('- A loop that never gave a result: `"result_s": null`, `"stall": true`, and what the screen said in `stall_words`.');
  L.push("- `severity` is one of `blocker`, `confusing`, `rough`, `idea`. List findings worst first.");
  L.push("- `address` never includes a `#` or anything after it.");
  L.push("- A walk that only reads a page still reports screens and findings; its `loops` may be `[]` when nothing you tried did any work.");
  L.push("");
  return L.join("\n");
}

/**
 * Writes `briefs/r<n>/<walk id>.md` for every walk and `briefs/r<n>/guide.md`; a brief file of a walk no longer in the
 * plan is removed (other files, and every report, stay). Returns `{ folder, briefs: [paths], guide: path }`.
 */
export function writeRound(dir, projectIn, plan) {
  const project = full(projectIn);
  const folder = path.join(dir, "briefs", `r${plan.round}`);
  fs.mkdirSync(folder, { recursive: true });
  const briefs = [];
  for (const w of plan.walks) {
    const file = path.join(folder, `${w.id}.md`);
    writeAtomic(file, renderBrief(project, plan, w));
    briefs.push(file);
  }
  const guide = path.join(folder, "guide.md");
  writeAtomic(guide, renderGuide(project, plan));
  const keep = new Set([...plan.walks.map((w) => `${w.id}.md`), "guide.md"]);
  for (const f of fs.readdirSync(folder)) if (f.endsWith(".md") && !keep.has(f)) fs.rmSync(path.join(folder, f), { force: true });
  return { folder, briefs, guide };
}
