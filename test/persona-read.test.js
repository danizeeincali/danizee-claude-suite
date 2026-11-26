import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collect, deepMeasure, findingKey, mergeFindings, measure, scorecard, parseReport, stripFragments, DEFAULT_TARGETS } from "../src/lib/persona/read.js";

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "persona-read-"));
  dirs.push(d);
  return d;
};

const DATA = (id, over = {}) => ({
  id,
  tester: "A tester",
  started_utc: "2026-11-26T10:00:00Z",
  minutes: 31,
  width: 1280,
  finished: true,
  why_not_finished: null,
  loops: [
    { n: 1, start_s: 20, result_s: 70, did: "asked what it can do", got: "a list", aha: true, stall: false, stall_words: null },
    { n: 2, start_s: 120, result_s: 270, did: "asked for a rota", got: "a draft", aha: false, stall: false, stall_words: null },
    { n: 3, start_s: 300, result_s: null, did: "asked for a swap", got: "nothing", aha: false, stall: true, stall_words: "try later" },
    { n: 4, start_s: 600, result_s: 2400, did: "late one", got: "answer", aha: true, stall: false, stall_words: null },
  ],
  screens: [
    { n: 1, screen: "Home", address: "https://app.example.com/", saw: 1, used: 1, reacted: 1, invented: 0, line: "clear" },
    { n: 2, screen: "Rota", address: "https://app.example.com/rota", saw: 0, used: 1, reacted: 1, invented: 0, line: "where is publish" },
    { n: 3, screen: "Team", address: "https://app.example.com/team", saw: 1, used: 0, reacted: 0, invented: 0, line: "empty" },
  ],
  findings: [{ n: 1, title: "Home hides the rota button", severity: "confusing", screen: "Home", address: "https://app.example.com/home", persona_said: "where do I press?", what_happened: "I looked for a minute.", expected: "a button on the card", shot: "01-home.png" }],
  first_five: { understood: "a rota app", thought_first: "who is this for", did: "asked what it can do" },
  come_back: { yes: true, reason: "it drafted my rota" },
  questions: [],
  ...over,
});
const fence = (body, tag = "json") => `# Report x\n\n\`\`\`${tag}\n${body}\n\`\`\`\n\n## Notes\nThe page was slow.\n`;
const REPORT = (id, over) => fence(JSON.stringify(DATA(id, over), null, 2));
const probs = (r, re) => r.problems.filter((p) => re.test(p));

const PROJECT = {
  kind: "persona-project",
  v: 1,
  product: { name: "Rota", what: "A staff rota app." },
  personas: [
    { id: "cafe-owner", name: "Maya", role: "owner", context: "Runs a six-seat cafe." },
    { id: "part-timer", name: "Sam", role: "staff", context: "Works weekends." },
  ],
  doors: [
    { id: "cold-app", label: "Opens the app cold", start: "https://app.example.com/" },
    { id: "landing", label: "Reads the front page", start: "https://example.com/", site_only: true, reader: "a shop owner reading the front page" },
  ],
  targets: { loops: 5, within_minutes: 30, first_aha_seconds: 120, stalls: 0 },
};
const walkOf = (n, persona, door, jobs = []) => ({ id: `r1-0${n}-${persona}-${door}`, persona, door, jobs, width: 1280 });

/** A working folder: project.json, rounds.json and reports (all old enough to be read). */
function folder({ project = PROJECT, rounds, reports = {}, round = 1 } = {}) {
  const dir = tmp();
  if (project) fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project));
  if (rounds) fs.writeFileSync(path.join(dir, "rounds.json"), JSON.stringify({ rounds: { [round]: rounds } }));
  fs.mkdirSync(path.join(dir, "reports"));
  for (const [id, text] of Object.entries(reports)) fs.writeFileSync(path.join(dir, "reports", `${id}.md`), text);
  return dir;
}
const LATER = () => ({ now: Date.now() + 60000 });

describe("stripFragments (from the report shape)", () => {
  it("takes anything after # off addresses, keeps headings and issue numbers", () => {
    const out = stripFragments("see https://app.example.com/sign-in#abc.def and /sign/x#e30 now\n### F1 title\nissue #3 stays");
    assert.doesNotMatch(out, /abc\.def|e30/);
    assert.match(out, /### F1 title/);
    assert.match(out, /issue #3 stays/);
  });
});

describe("measure", () => {
  const m = measure(parseReport(REPORT("a")));
  it("counts loops, aha, stalls and seconds from the walk's start", () => {
    assert.deepEqual({ ...m, steps: undefined, firstZero: undefined }, { loopsCompleted: 3, loopsWithAha: 2, stalls: 1, secondsToFirstResult: 70, secondsToFirstAha: 70, loopsWithin: 2, neverAha: false, steps: undefined, firstZero: undefined, unreadable: [] });
  });
  it("totals the four steps and finds the first screen that scored 0", () => {
    assert.deepEqual(m.steps, { saw: 2, used: 2, reacted: 2, invented: 0 });
    assert.deepEqual(m.firstZero, { saw: { n: 2, screen: "Rota" }, used: { n: 3, screen: "Team" }, reacted: { n: 3, screen: "Team" }, invented: { n: 1, screen: "Home" } });
  });
  it("counts loops within the project's own minutes", () => {
    assert.equal(measure(parseReport(REPORT("a")), { withinMinutes: 5 }).loopsWithin, 2);
    assert.equal(measure(parseReport(REPORT("a")), { withinMinutes: 1 }).loopsWithin, 0);
    assert.equal(measure(parseReport(REPORT("a")), { withinMinutes: 60 }).loopsWithin, 3);
  });
  it("an empty loops list is a real zero; a missing or broken one is unknown, never zero", () => {
    const zero = measure(parseReport(REPORT("a", { loops: [] })));
    assert.equal(zero.loopsCompleted, 0);
    assert.equal(zero.stalls, 0);
    assert.equal(zero.secondsToFirstAha, null);
    const missing = measure(parseReport(fence("{ broken")));
    assert.equal(missing.loopsCompleted, null);
    assert.equal(missing.stalls, null);
    assert.equal(missing.loopsWithin, null);
    for (const k of ["loopsCompleted", "stalls", "loopsWithin", "secondsToFirstAha"]) assert.ok(missing.unreadable.includes(k), k);
  });
  it("one unreadable time makes only the measures that need it unknown", () => {
    const d = DATA("a");
    d.loops[0].result_s = "10:01:10";
    const x = measure(parseReport(REPORT("a", { loops: d.loops })));
    assert.equal(x.stalls, 1);
    assert.equal(x.loopsCompleted, 3);
    assert.equal(x.loopsWithin, null);
    assert.equal(x.secondsToFirstResult, null);
    assert.ok(x.unreadable.includes("loopsWithin") && x.unreadable.includes("secondsToFirstAha"));
    assert.ok(!x.unreadable.includes("stalls") && !x.unreadable.includes("loopsCompleted"));
  });
  it("an unreadable stall makes stall counts unknown", () => {
    const d = DATA("a");
    d.loops[1].stall = "no, it worked";
    const x = measure(parseReport(REPORT("a", { loops: d.loops })));
    assert.equal(x.stalls, null);
    assert.ok(x.unreadable.includes("stalls"));
  });
  it("an unreadable score makes that step's total and first zero unknown, the others stay", () => {
    const d = DATA("a");
    d.screens[0].saw = "✓";
    const x = measure(parseReport(REPORT("a", { screens: d.screens })));
    assert.equal(x.steps.saw, null);
    assert.equal(x.firstZero.saw, null);
    assert.equal(x.steps.used, 2);
    const all = measure(parseReport(REPORT("a", { screens: [{ n: 1, screen: "Home", address: null, saw: 1, used: 1, reacted: 1, invented: 1, line: "" }] })));
    assert.equal(all.firstZero.saw, false);
  });
  const loop = (n, over = {}) => ({ n, start_s: n * 10, result_s: n * 10 + 50, did: "x", got: "y", aha: false, stall: false, stall_words: null, ...over });
  it("says never when every aha is known and none is true, and not when one is unreadable", () => {
    const never = measure({ loops: [loop(1), loop(2)], screens: [] });
    assert.equal(never.secondsToFirstAha, null);
    assert.equal(never.neverAha, true);
    assert.ok(!never.unreadable.includes("secondsToFirstAha"));
    const unread = measure({ loops: [loop(1, { aha: null })], screens: [] });
    assert.equal(unread.neverAha, null);
    assert.ok(unread.unreadable.includes("secondsToFirstAha"));
    assert.equal(measure({ loops: [loop(1, { aha: true })], screens: [] }).secondsToFirstAha, 60);
    assert.equal(measure({ loops: [], screens: [] }).neverAha, true);
  });
  it("takes the first result of 200k loops without throwing", () => {
    const N = 200000;
    const loops = Array.from({ length: N }, (_, i) => loop(i + 1, { result_s: N - i, aha: true }));
    const r = measure({ loops, screens: [] });
    assert.equal(r.secondsToFirstResult, 1);
    assert.equal(r.loopsCompleted, N);
  });
});

describe("deepMeasure", () => {
  const deep = (over = {}) => DATA("a", { jobs: [{ n: 1, job: "first-rota", finished: false, steps_done: 2, steps: 5, gave_up_at: 3, line: "no" }, { n: 2, job: "swap", finished: true, steps_done: 4, steps: 4, gave_up_at: null, line: "ok" }], remembered: { yes: false, missed: ["the hours"] }, would_pay: { yes: true, reason: "saves time" }, ...over });
  it("counts jobs, steps, remembered and would pay; no sittings when none is used", () => {
    const m = deepMeasure(parseReport(fence(JSON.stringify(deep()))));
    assert.deepEqual(m, { jobsStarted: 2, jobsFinished: 1, stepsDone: 6, steps: 9, sittings: {}, loopsWithoutSitting: 0, remembered: false, missed: ["the hours"], wouldPay: true, wouldPayReason: "saves time" });
  });
  it("counts loops and stalls per sitting only when the report uses sitting", () => {
    const d = deep();
    d.loops = d.loops.map((l, i) => (i === 3 ? l : { ...l, sitting: i === 0 ? 1 : 2 }));
    const m = deepMeasure(parseReport(fence(JSON.stringify(d))));
    assert.deepEqual(m.sittings, { 1: { loops: 1, stalls: 0 }, 2: { loops: 2, stalls: 1 } });
    assert.equal(m.loopsWithoutSitting, 1);
  });
  it("a report with no deep keys gives zeros and unknowns, not a throw", () => {
    const m = deepMeasure(parseReport(REPORT("a")));
    assert.equal(m.jobsStarted, 0);
    assert.equal(m.remembered, null);
    assert.equal(m.wouldPay, null);
  });
});

const F = (title, screen, address, severity = "rough") => ({ n: 1, title, severity, screen, address, persona_said: "", what_happened: "", expected: "", shot: null });
const walk = (id, ...findings) => ({ file: `${id}.md`, report: { id, findings: findings.map((f, i) => ({ ...f, n: i + 1 })) } });

describe("findingKey", () => {
  it("uses host and path from the address, never the query or fragment, case and trailing slash aside", () => {
    assert.equal(findingKey(F("t", "x", "https://App.Example.com/home/?tab=2")), "app.example.com/home");
    assert.equal(findingKey(F("t", "x", "https://app.example.com/")), "app.example.com");
  });
  it("else the screen name, lower-case, without a leading article or the word screen or page", () => {
    assert.equal(findingKey(F("t", "The Home screen", null)), "home");
    assert.equal(findingKey(F("t", "home page", null)), "home");
    assert.equal(findingKey(F("t", "Rota editor", null)), "rota editor");
    assert.equal(findingKey(F("t", "", null)), null);
  });
  it("a long slash run in an address does not slow it", () => {
    const t = Date.now();
    findingKey(F("t", "x", `https://a.example.com/${"/".repeat(200000)}`));
    assert.ok(Date.now() - t < 2000);
  });
});

describe("mergeFindings", () => {
  it("merges the same place with a similar title, keeps every walk, ranks by severity then count", () => {
    const merged = mergeFindings([
      walk("w1", F("Home hides the rota button", "Home", "https://app.example.com/home", "confusing")),
      walk("w2", F("The rota button is hidden on Home", "Home", "https://app.example.com/home?x=1", "confusing")),
      walk("w3", F("Something else entirely about colours", "Settings", "https://app.example.com/settings", "idea")),
    ]);
    const top = merged.find((g) => g.title.includes("rota"));
    assert.equal(top.walks, 2);
    assert.deepEqual(top.evidence.map((e) => e.walk).sort(), ["w1", "w2"]);
    assert.deepEqual(merged.map((g) => g.severity), ["confusing", "idea"]);
  });
  it("keeps the worst severity of a group, and a finding with no readable severity ranks last", () => {
    const merged = mergeFindings([walk("w1", F("Home hides the rota button", "Home", null, "rough")), walk("w2", F("Home hides the rota button", "Home screen", null, "blocker")), walk("w3", F("Team list is empty", "Team", null, null)), walk("w4", F("Bad colour", "Settings", null, "idea"))]);
    assert.deepEqual(merged.map((g) => g.severity), ["blocker", "idea", null]);
  });
  it("does not over-merge different screens, different pages, or titles alike only pairwise", () => {
    assert.equal(mergeFindings([walk("w1", F("Send button is hidden", "Rota editor", null)), walk("w2", F("Send button is hidden", "Rota list", null))]).length, 2);
    assert.equal(mergeFindings([walk("w1", F("Send button is hidden", "x", "https://app.example.com/rota/new")), walk("w2", F("Send button is hidden", "x", "https://app.example.com/swap/new"))]).length, 2);
    const c = mergeFindings([walk("w1", F("rota send button hidden", "Home", null)), walk("w2", F("rota send button hidden grey", "Home", null)), walk("w3", F("send button grey small", "Home", null))]);
    assert.deepEqual(c.map((g) => g.walks).sort(), [1, 2]);
    assert.equal(mergeFindings([walk("w1", F("Rota send button is hidden", "Home", null)), walk("w2", F("Rota send button is too small", "Home", null))]).length, 2);
  });
  it("does not under-merge the same page written with a query, a slash or capitals, or the same screen with an article", () => {
    const a = mergeFindings([walk("w1", F("Home hides the rota button", "Home", "https://app.example.com/home")), walk("w2", F("Home hides the rota button", "Home", "https://APP.example.com/home/?tab=today"))]);
    assert.equal(a.length, 1);
    assert.deepEqual(a[0].evidence.map((e) => e.walk), ["w1", "w2"]);
    assert.equal(mergeFindings([walk("w1", F("No way to undo", "The Home screen", null)), walk("w2", F("no way to undo!", "home page", null))]).length, 1);
  });
  it("never merges findings with no place at all", () => {
    assert.equal(mergeFindings([walk("w1", F("Same", "", null)), walk("w2", F("Same", "", null))]).length, 2);
  });
  it("ids are f- plus 8 hex, keep a separate rank, and are unique even for place-less twins", () => {
    const m = mergeFindings([walk("r1-01", F("Title 1 about thing", "Home", "https://app.example.com/p1"), F("same words", null, null), F("same words", null, null))]);
    for (const f of m) assert.match(f.id, /^f-[0-9a-f]{8}$/);
    assert.equal(new Set(m.map((f) => f.id)).size, 3);
    assert.deepEqual(m.map((f) => f.rank), [1, 2, 3]);
  });
  it("a late report that outranks existing findings leaves their ids unchanged", () => {
    const a = (w) => walk(w, F("Title 1 about thing", "Home", "https://app.example.com/p1", "idea"), F("Title 2 about thing", "Home", "https://app.example.com/p2", "rough"));
    const early = mergeFindings([a("r1-01")]);
    const late = mergeFindings([a("r1-01"), walk("r1-02", F("Brand new problem", "New", "https://app.example.com/new", "blocker"))]);
    const idOf = (list, title) => list.find((f) => f.title === title).id;
    assert.equal(idOf(late, "Title 1 about thing"), idOf(early, "Title 1 about thing"));
    assert.equal(idOf(late, "Title 2 about thing"), idOf(early, "Title 2 about thing"));
    assert.equal(late[0].title, "Brand new problem");
    assert.equal(late[0].rank, 1);
  });
  it("the id does not change when a later report joins, nor with walk order", () => {
    const a = walk("r1-01", F("Title 1 about thing", "Home", "https://app.example.com/p1"));
    const b = walk("r1-02", F("Title 1 about thing too", "Home", "https://app.example.com/p1"));
    const alone = mergeFindings([a]);
    assert.equal(mergeFindings([a, b])[0].id, alone[0].id);
    assert.equal(mergeFindings([b, a])[0].id, alone[0].id);
  });
  it("keeps what_happened in each evidence entry, stripped", () => {
    const f = { n: 1, title: "t", severity: "rough", screen: "Home", address: null, persona_said: "hm", what_happened: `went to https://app.example.com/x#${"Q".repeat(43)} then stuck`, expected: null, shot: null };
    const m = mergeFindings([{ file: "r1-01.md", report: { id: "r1-01", findings: [f] } }]);
    assert.match(m[0].evidence[0].happened, /then stuck/);
    assert.doesNotMatch(JSON.stringify(m), /QQQQQQQQ/);
  });
  for (const w of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    it(`a screen named ${w} merges and is unrated-safe`, () => {
      const m = mergeFindings([walk("a", F("same thing", w, null)), walk("b", F("same thing", w, null))]);
      assert.equal(m.length, 1);
      assert.equal(m[0].walks, 2);
    });
  }
});

describe("scorecard", () => {
  const good = { loopsWithin: 6, secondsToFirstAha: 60, stalls: 0, neverAha: false, unreadable: [], steps: { saw: 1, used: 1, reacted: 1, invented: 1 } };
  const bad = { loopsWithin: 2, secondsToFirstAha: 300, stalls: 2, neverAha: false, unreadable: [], steps: { saw: 0, used: 0, reacted: 0, invented: 0 } };
  const unknown = { loopsWithin: null, secondsToFirstAha: null, stalls: null, neverAha: null, unreadable: ["loopsWithin", "secondsToFirstAha", "stalls"], steps: { saw: null, used: null, reacted: null, invented: null } };
  const site = { loopsWithin: 0, secondsToFirstAha: null, stalls: 0, neverAha: true, unreadable: [], steps: { saw: 2, used: 0, reacted: 1, invented: 0 } };
  const it1 = (m, persona, door, over = {}) => ({ m, persona, door, siteOnly: false, ...over });
  it("scores per persona, per door and overall against the targets", () => {
    const s = scorecard([it1(good, "cafe-owner", "cold-app"), it1(bad, "part-timer", "invite"), it1(good, "cafe-owner", "invite")]);
    assert.deepEqual(s.targets, DEFAULT_TARGETS);
    assert.equal(s.overall.walks, 3);
    assert.equal(s.overall.meets.stalls, false);
    assert.deepEqual(s.perPersona["cafe-owner"].meets, { loops: true, firstAha: true, stalls: true });
    assert.equal(s.perDoor.invite.walks, 2);
    assert.equal(s.perDoor["cold-app"].meets.loops, true);
  });
  it("uses the project's targets", () => {
    const t = { loops: 7, within_minutes: 10, first_aha_seconds: 30, stalls: 3 };
    const s = scorecard([it1(good, "p", "d")], { targets: t });
    assert.deepEqual(s.targets, t);
    assert.deepEqual(s.overall.meets, { loops: false, firstAha: false, stalls: true });
  });
  it("skips unknown measures in averages and medians, counts the walk as unreadable, never meets on nothing", () => {
    const s = scorecard([it1(good, "a", "d"), it1(unknown, "a", "d")]);
    assert.equal(s.overall.walks, 2);
    assert.equal(s.overall.unreadable, 1);
    assert.equal(s.overall.loopsWithin, 6);
    assert.equal(s.overall.medianSecondsToFirstAha, 60);
    assert.equal(s.overall.meets.stalls, null);
    assert.deepEqual(scorecard([it1(unknown, "a", "d")]).overall.meets, { loops: null, firstAha: null, stalls: null });
  });
  it("scores site-only walks apart, in their own row", () => {
    const s = scorecard([it1(good, "a", "cold-app", { findings: 1 }), { m: site, persona: "a", door: "landing", siteOnly: true, findings: 3 }]);
    assert.equal(s.overall.walks, 1);
    assert.equal(s.perDoor.landing, undefined);
    assert.deepEqual(s.siteOnly, { walks: 1, unreadable: 0, steps: { saw: 2, used: 0, reacted: 1, invented: 0 }, findings: 3 });
    assert.equal(s.siteWalks, undefined);
  });
  it("a round of only site walks scores them by door and by reader", () => {
    const s = scorecard([{ m: site, persona: "a", door: "landing", siteOnly: true, reader: "a shop owner", findings: 1 }, { m: site, persona: "b", door: "landing", siteOnly: true, reader: "a shop owner", findings: 0 }], { siteOnlyRound: true });
    assert.equal(s.overall.walks, 0);
    assert.equal(s.siteWalks.overall.walks, 2);
    assert.deepEqual(Object.keys(s.siteWalks.perPersona), ["reader:a shop owner"]);
    assert.deepEqual(Object.keys(s.siteWalks.perDoor), ["landing"]);
  });
  it("a walk with no known door in a site-only round is a site walk", () => {
    const s = scorecard([{ m: site, persona: "a", door: null, siteOnly: null, findings: 0 }], { siteOnlyRound: true });
    assert.equal(s.siteOnly.walks, 1);
    assert.equal(s.overall.walks, 0);
    assert.equal(scorecard([{ m: good, persona: "a", door: null, siteOnly: null }]).overall.walks, 1);
  });
  const loop = (n, over = {}) => ({ n, start_s: n * 10, result_s: n * 10 + 50, did: "x", got: "y", aha: false, stall: false, stall_words: null, ...over });
  const row = (loops) => it1(measure({ loops, screens: [] }), "a", "d");
  it("one aha at 60 s and three never is missed, with never as the median", () => {
    const o = scorecard([row([loop(1, { start_s: 10, result_s: 60, aha: true })]), row([loop(1), loop(2)]), row([loop(1), loop(2), loop(3)]), row([loop(1)])]).overall;
    assert.equal(o.medianSecondsToFirstAha, null);
    assert.deepEqual(o.firstAha, { median: null, medianNever: true, never: 3, reached: 1, known: 4, reachedMedian: 60 });
    assert.deepEqual(o.ahaUnderTarget, { walks: 1, of: 4 });
    assert.equal(o.meets.firstAha, false);
  });
  it("a never sorts after every time: three reached and one never keeps a real median", () => {
    const o = scorecard([30, 50, 70].map((t) => row([loop(1, { start_s: 0, result_s: t, aha: true })])).concat(row([loop(1)]))).overall;
    assert.equal(o.medianSecondsToFirstAha, 60);
    assert.equal(o.firstAha.never, 1);
    assert.equal(o.firstAha.reached, 3);
    assert.equal(o.meets.firstAha, true);
  });
  it("unreadable walks stay out of the median and the counts", () => {
    const o = scorecard([row([loop(1, { aha: null })]), row([loop(1, { start_s: 0, result_s: 90, aha: true })])]).overall;
    assert.deepEqual({ known: o.firstAha.known, reached: o.firstAha.reached, median: o.firstAha.median, unreadable: o.unreadable }, { known: 1, reached: 1, median: 90, unreadable: 1 });
    const none = scorecard([row([loop(1, { aha: null })])]).overall;
    assert.equal(none.firstAha.known, 0);
    assert.equal(none.meets.firstAha, null);
  });
  for (const w of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    it(`a persona or door named ${w} is scored under its own row`, () => {
      const s = scorecard([it1(good, w, w), it1(good, "owner", `${w}`)]);
      assert.equal(s.overall.walks, 2);
      assert.deepEqual(Object.keys(s.perDoor), [w]);
      assert.deepEqual(Object.keys(s.perPersona).sort(), [w, "owner"].sort());
      assert.equal(Object.getOwnPropertyDescriptor(s.perDoor, w).value.walks, 2);
    });
  }
});

describe("collect", () => {
  const ROUND = { kind: "standard", seed: "r1", avoid: [], walks: [walkOf(1, "cafe-owner", "cold-app", ["first-rota"]), walkOf(2, "part-timer", "cold-app", ["swap"]), walkOf(3, "cafe-owner", "landing"), walkOf(4, "part-timer", "landing")] };
  const ids = ROUND.walks.map((w) => w.id);

  it("reads a round's reports and writes findings with no fragment in it", () => {
    const secret = { findings: [{ ...DATA("x").findings[0], address: "https://app.example.com/home#secretpartsecretpartsecret" }] };
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: REPORT(ids[0], secret), [ids[1]]: REPORT(ids[1], secret), [ids[2]]: REPORT(ids[2], { loops: [] }), "r2-01-other": REPORT("r2-01-other") } });
    const res = collect(dir, 1, LATER());
    assert.equal(res.round, 1);
    assert.equal(res.kind, "standard");
    assert.equal(res.product, "Rota");
    assert.equal(res.briefs, 4);
    assert.equal(res.reports, 3);
    assert.deepEqual(res.missing, [ids[3]]);
    assert.equal(res.scorecard.overall.walks, 2);
    assert.equal(res.scorecard.siteOnly.walks, 1);
    assert.deepEqual(Object.keys(res.scorecard.perPersona).sort(), ["cafe-owner", "part-timer"]);
    assert.equal(res.findings[0].walks, 3);
    const w = res.walks.find((x) => x.id === ids[0]);
    assert.deepEqual({ persona: w.persona, door: w.door, role: w.role, context: w.context, siteOnly: w.siteOnly }, { persona: "cafe-owner", door: "cold-app", role: "owner", context: "Runs a six-seat cafe.", siteOnly: false });
    const site = res.walks.find((x) => x.id === ids[2]);
    assert.equal(site.siteOnly, true);
    assert.equal(site.reader, "a shop owner reading the front page");
    const file = fs.readFileSync(path.join(dir, "findings-r1.json"), "utf8");
    assert.doesNotMatch(file, /secretpart/);
    assert.equal(JSON.parse(file).round, 1);
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes(".tmp")), []);
  });

  it("the top-level keys of the findings file", () => {
    const dir = folder({ rounds: { ...ROUND, walks: ROUND.walks.map((w) => ({ ...w, jobs: [] })) }, reports: { [ids[0]]: REPORT(ids[0]) } });
    assert.deepEqual(Object.keys(collect(dir, 1, LATER())), ["round", "kind", "product", "briefs", "reports", "missing", "unreadable", "known_met", "scorecard", "findings", "walks"]);
  });

  it("the report's id not being its file name is noted, and the file name is the walk", () => {
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: REPORT("r1-99-typo") } });
    const res = collect(dir, 1, LATER());
    assert.equal(res.walks[0].id, ids[0]);
    assert.ok(res.walks[0].problems.some((p) => p.includes("r1-99-typo")));
    assert.ok(!res.missing.includes(ids[0]));
  });

  it("copes with no reports folder, no project file and no rounds file at all", () => {
    const dir = tmp();
    const res = collect(dir, 3);
    assert.equal(res.reports, 0);
    assert.equal(res.briefs, 0);
    assert.deepEqual(res.findings, []);
    assert.equal(res.product, "the product");
    assert.deepEqual(res.unreadable, []);
  });

  it("a report with no json block is not counted, stays missing and is listed", () => {
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: REPORT(ids[0]), [ids[1]]: 'I walked it and then\n```json\n{ "id": ' } });
    const res = collect(dir, 1, LATER());
    assert.equal(res.reports, 1);
    assert.ok(res.missing.includes(ids[1]));
    assert.equal(res.unreadable.length, 1);
    assert.equal(res.unreadable[0].file, `${ids[1]}.md`);
    assert.match(res.unreadable[0].problem, /json/);
  });

  it("a report modified in the last 15 seconds is skipped as still being written", () => {
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: REPORT(ids[0]) } });
    const mtime = fs.statSync(path.join(dir, "reports", `${ids[0]}.md`)).mtimeMs;
    const fresh = collect(dir, 1, { now: mtime + 5000 });
    assert.equal(fresh.reports, 0);
    assert.deepEqual(fresh.unreadable, [{ file: `${ids[0]}.md`, problem: "still being written" }]);
    assert.ok(fresh.missing.includes(ids[0]));
    const later = collect(dir, 1, { now: mtime + 20000 });
    assert.equal(later.reports, 1);
    assert.deepEqual(later.unreadable, []);
  });

  it("a report dated ahead of the clock is read normally", () => {
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: REPORT(ids[0]) } });
    const f = path.join(dir, "reports", `${ids[0]}.md`);
    const ahead = new Date(Date.now() + 3600000);
    fs.utimesSync(f, ahead, ahead);
    assert.equal(collect(dir, 1).reports, 1);
  });

  it("a report over 1 MB is not parsed: it is 'too large' and another report is read normally", () => {
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: REPORT(ids[0]), [ids[1]]: REPORT(ids[1], { questions: ["x".repeat(2 * 1024 * 1024)] }) } });
    const res = collect(dir, 1, LATER());
    assert.equal(res.reports, 1);
    assert.deepEqual(res.unreadable, [{ file: `${ids[1]}.md`, problem: "too large" }]);
    assert.ok(res.missing.includes(ids[1]));
  });

  it("a report of exactly 1 MB is still read", () => {
    const base = REPORT(ids[0], { why_not_finished: "" });
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: `${base}${"n".repeat(1024 * 1024 - Buffer.byteLength(base))}` } });
    assert.equal(fs.statSync(path.join(dir, "reports", `${ids[0]}.md`)).size, 1024 * 1024);
    assert.equal(collect(dir, 1, LATER()).reports, 1);
  });

  it("a report that still throws while it is read costs only itself", () => {
    const deep = "[".repeat(5000) + "]".repeat(5000);
    const hostile = JSON.stringify(DATA(ids[1])).replace('"did":"asked what it can do"', `"did":${deep}`);
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: REPORT(ids[0]), [ids[1]]: fence(hostile) } });
    const res = collect(dir, 1, LATER());
    assert.equal(res.reports, 1);
    assert.equal(res.unreadable.length, 1);
    assert.equal(res.unreadable[0].file, `${ids[1]}.md`);
    assert.match(res.unreadable[0].problem, /^could not be read: /);
    assert.ok(res.unreadable[0].problem.length <= 120);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "findings-r1.json"), "utf8")).reports, 1);
  });

  it("a dangling symlink is listed as could not be read and the rest is collected", () => {
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: REPORT(ids[0]) } });
    fs.symlinkSync(path.join(dir, "nowhere.md"), path.join(dir, "reports", `${ids[1]}.md`));
    const res = collect(dir, 1, LATER());
    assert.equal(res.reports, 1);
    assert.equal(res.unreadable[0].file, `${ids[1]}.md`);
    assert.match(res.unreadable[0].problem, /could not be read/);
  });

  it("a leading BOM in a report, rounds.json and project.json is ignored", () => {
    const dir = folder({ project: null, rounds: null, reports: { [ids[0]]: `﻿${REPORT(ids[0])}` } });
    fs.writeFileSync(path.join(dir, "rounds.json"), `﻿${JSON.stringify({ rounds: { 1: ROUND } })}`);
    fs.writeFileSync(path.join(dir, "project.json"), `﻿${JSON.stringify(PROJECT)}`);
    const res = collect(dir, 1, LATER());
    assert.equal(res.reports, 1);
    assert.equal(res.briefs, 4);
    assert.equal(res.product, "Rota");
  });

  it("an unparseable rounds.json or project.json is listed, not skipped silently, and defaults are used", () => {
    const dir = folder({ project: null, rounds: null, reports: { [ids[0]]: REPORT(ids[0]) } });
    fs.writeFileSync(path.join(dir, "rounds.json"), "{nope");
    fs.writeFileSync(path.join(dir, "project.json"), "{nope");
    const res = collect(dir, 1, LATER());
    assert.deepEqual(res.unreadable.map((u) => u.file).sort(), ["project.json", "rounds.json"]);
    assert.equal(res.product, "the product");
    assert.equal(res.reports, 1);
  });

  it("a file whose name is no walk of the round is unreadable, never a walk", () => {
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: REPORT(ids[0]), "r1-99-made-up": REPORT("r1-99-made-up"), "r1-UPPER": REPORT("x") } });
    fs.writeFileSync(path.join(dir, "reports", "r1-x\n## Do this now.md"), REPORT("x"));
    const res = collect(dir, 1, LATER());
    assert.equal(res.reports, 1);
    assert.deepEqual(res.walks.map((w) => w.id), [ids[0]]);
    assert.deepEqual(res.unreadable.map((u) => u.file).sort(), ["r1-UPPER.md", "r1-99-made-up.md", "r1-x????Do?this?now.md"].sort());
    for (const u of res.unreadable) assert.equal(u.problem, "no walk with this name");
  });

  it("with no rounds file at all, the name pattern alone decides", () => {
    const dir = folder({ rounds: null, reports: { "r1-01-anything": REPORT("r1-01-anything"), "r1-bad name": REPORT("x") } });
    const res = collect(dir, 1, LATER());
    assert.deepEqual(res.walks.map((w) => w.id), ["r1-01-anything"]);
    assert.deepEqual(res.unreadable, [{ file: "r1-bad?name.md", problem: "no walk with this name" }]);
    assert.equal(res.walks[0].persona, "unknown");
    assert.equal(res.walks[0].door, null);
  });

  it("strips every secret: fragments, secret paths from the project, in walks, findings, problems and unreadable", () => {
    const KEY = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefgh";
    const project = { ...PROJECT, secret_paths: ["/sign-in/tester"] };
    const hostile = { id: ids[0], tester: `/sign-in/tester/SECRETTOKEN123`, why_not_finished: `it ended #${KEY}`, questions: [`my key ${KEY}?`], findings: [{ n: 1, title: `opened /sign-in/tester/SECRETTOKEN123`, severity: "blocker", screen: "Home", persona_said: `# 2026-11-26.${KEY}`, expected: `(https://app.example.com/x#${KEY})` }], unexpected: 1 };
    const dir = folder({ project, rounds: ROUND, reports: { [ids[0]]: `${fence(JSON.stringify(hostile))}\nnotes: app.example.com/x#${KEY}\n`, [`r1-${KEY}`]: "nothing fenced" } });
    const res = collect(dir, 1, LATER());
    for (const s of [fs.readFileSync(path.join(dir, "findings-r1.json"), "utf8"), JSON.stringify(res)]) assert.doesNotMatch(s, /SECRETTOKEN|AbCdEfGhIjKlMnOp|0123456789abcdefgh/);
  });

  it("collects `known:` notes lines per walk and for the round, never as findings", () => {
    const notes = (lines) => `# Report\n\n\`\`\`json\n${JSON.stringify(DATA(ids[0], { findings: [] }))}\n\`\`\`\n\n## Notes\n${lines}\n`;
    const text = notes("Slow page.\nknown: the time zone is guessed\n- Known: sign-in email lands in spam\n* KNOWN:   \n1. known: numbered one\n  known: indented\nnot known: this one is not\nunknown: nor this");
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: text, [ids[1]]: notes("known: the time zone is guessed") } });
    const res = collect(dir, 1, LATER());
    const w = res.walks.find((x) => x.id === ids[0]);
    assert.deepEqual(w.known_met, ["the time zone is guessed", "sign-in email lands in spam", "numbered one", "indented"]);
    assert.equal(res.known_met.count, 5);
    assert.deepEqual(res.known_met.items.map((i) => i.walk), [ids[0], ids[0], ids[0], ids[0], ids[1]]);
    assert.deepEqual(res.findings, []);
  });

  it("a round of only site-only doors is a site-only round from what was asked, even with no report back", () => {
    const dir = folder({ rounds: { ...ROUND, walks: [walkOf(1, "cafe-owner", "landing"), walkOf(2, "part-timer", "landing")] } });
    const res = collect(dir, 1);
    assert.equal(res.siteOnlyRound, true);
    assert.equal(res.reports, 0);
    const mixed = collect(folder({ rounds: ROUND }), 1);
    assert.equal(mixed.siteOnlyRound, undefined);
  });

  it("a round whose app walks carry jobs is deep, with the deep summary and real minutes beside the tester's own", () => {
    const deep = (over = {}) => DATA("x", { jobs: [{ n: 1, job: "first-rota", finished: false, steps_done: 2, steps: 5, gave_up_at: 3, line: "no" }, { n: 2, job: "swap", finished: true, steps_done: 4, steps: 4, gave_up_at: null, line: "ok" }], remembered: { yes: false, missed: ["hours"] }, would_pay: { yes: true, reason: "saves time" }, minutes: 92, ...over });
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: fence(JSON.stringify({ ...deep(), id: ids[0] })), [ids[1]]: fence(JSON.stringify({ ...deep({ would_pay: { yes: false, reason: "not yet" }, remembered: { yes: true, missed: [] } }), id: ids[1] })) } });
    fs.writeFileSync(path.join(dir, "clock-r1.json"), JSON.stringify([{ id: ids[0], started: "2026-11-27T10:00:00Z", received: "2026-11-27T12:10:00Z", clock_minutes: 130 }]));
    const res = collect(dir, 1, LATER());
    assert.equal(res.deepRound, true);
    assert.equal(res.deep.walks, 2);
    assert.equal(res.deep.jobsStarted, 4);
    assert.equal(res.deep.jobsFinished, 2);
    assert.equal(res.deep.stepsDone, 12);
    assert.deepEqual(res.deep.remembered, { yes: 1, no: 1, known: 2 });
    assert.deepEqual(res.deep.wouldPay, { yes: 1, no: 1, known: 2 });
    assert.deepEqual(res.deep.sittings, {});
    assert.deepEqual(res.walks.find((w) => w.id === ids[0]).clock, { real_minutes: 130, tester_minutes: 92 });
    assert.equal(res.walks.find((w) => w.id === ids[1]).clock, null);
    assert.equal(res.walks.find((w) => w.id === ids[0]).deep.jobsFinished, 1);
  });

  it("a round with no jobs has no deep keys, and a broken clock file is named, never thrown", () => {
    const dir = folder({ rounds: { ...ROUND, walks: ROUND.walks.map((w) => ({ ...w, jobs: [] })) }, reports: { [ids[0]]: REPORT(ids[0]) } });
    fs.writeFileSync(path.join(dir, "clock-r1.json"), "{nope");
    const res = collect(dir, 1, LATER());
    assert.ok(!("deepRound" in res) && !("deep" in res));
    assert.ok(res.unreadable.some((u) => u.file === "clock-r1.json"));
  });

  it("records a side round's kind and uses the project's targets and minutes", () => {
    const project = { ...PROJECT, targets: { loops: 2, within_minutes: 5, first_aha_seconds: 60, stalls: 1 } };
    const dir = folder({ project, rounds: { ...ROUND, kind: "side" }, reports: { [ids[0]]: REPORT(ids[0]) } });
    const res = collect(dir, 1, LATER());
    assert.equal(res.kind, "side");
    assert.deepEqual(res.scorecard.targets, project.targets);
    assert.equal(res.walks[0].measures.loopsWithin, 2);
  });

  it("reads only the round's own files: another round's walks are not this round's", () => {
    const dir = folder({ rounds: ROUND, reports: { [ids[0]]: REPORT(ids[0]) } });
    assert.equal(collect(dir, 2, LATER()).reports, 0);
  });
});
