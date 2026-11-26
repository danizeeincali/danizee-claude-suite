import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fc from "fast-check";
import {
  DEEP_KEYS, MAX_LIST, MAX_REPORT_BYTES, REPORT_NAME, REPORT_TEMPLATE, SEVERITY, SITTINGS, STEPS, UNREADABLE,
  parseReport, safeName, show, stripDeep, stripFragments, submissionProblems, unreadableProblem,
} from "../src/lib/persona/report-shape.js";

const DATA = (id, over = {}) => ({
  id,
  tester: "A tester",
  started_utc: "2026-11-26T10:00:00Z",
  minutes: 31,
  width: 1280,
  finished: true,
  why_not_finished: null,
  loops: [
    { n: 1, start_s: 20, result_s: 70, did: "asked what can you do", got: "a list", aha: true, stall: false, stall_words: null },
    { n: 2, start_s: 120, result_s: 270, did: "asked for an invoice", got: "a draft", aha: false, stall: false, stall_words: null },
    { n: 3, start_s: 300, result_s: null, did: "asked for a quote", got: "nothing", aha: false, stall: true, stall_words: "tomorrow" },
  ],
  screens: [
    { n: 1, screen: "Home", address: "https://app.example.com/", saw: 1, used: 1, reacted: 1, invented: 0, line: "clear" },
    { n: 2, screen: "Team", address: "https://app.example.com/team", saw: 1, used: 0, reacted: 0, invented: 0, line: "empty" },
  ],
  findings: [{ n: 1, title: "Home hides the button", severity: "confusing", screen: "Home", address: "https://app.example.com/home", persona_said: "where?", what_happened: "I looked.", expected: "a button", shot: "01-home.png" }],
  first_five: { understood: "an assistant", thought_first: "who is this", did: "asked" },
  come_back: { yes: true, reason: "it drafted my reply" },
  questions: [],
  ...over,
});
const fence = (body, tag = "json") => `# Report x\n\n\`\`\`${tag}\n${body}\n\`\`\`\n\n## Notes\nThe page was slow.\n`;
const REPORT = (id, over) => fence(JSON.stringify(DATA(id, over), null, 2));
const probs = (r, re) => r.problems.filter((p) => re.test(p));
const SECRET = "eyJwcm9maWxlIjp7InYiOjF9fQabc123";
const DATE = "2026-11-26";
const MAC = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".replace(/A{20}/, "AAAAAAAAAAAAAAAAAAAA");

describe("stripFragments", () => {
  it("takes anything after # off addresses, keeps headings and issue numbers", () => {
    const out = stripFragments("see https://app.example.com/sign-in#abc.def and app.example.com/x#y or /tester/day-one#e30 now\n### F1 title\nissue #3 stays");
    assert.doesNotMatch(out, /abc\.def|#y|e30/);
    assert.match(out, /### F1 title/);
    assert.match(out, /issue #3 stays/);
    assert.match(out, /https:\/\/app\.example\.com\/sign-in(?!#)/);
  });
  it("takes off %23-encoded fragments, fragments after a query, and long tokens after # anywhere", () => {
    const t = [
      `https://app.example.com/a%23${SECRET}`,
      `app.example.com/b%23${SECRET}`,
      `/tester/day-one?x=1&y=2#${SECRET}`,
      `/from/rota?ref=a%23${SECRET}`,
      `the link ended in #${SECRET} I think`,
      `or %23${SECRET} encoded`,
      "issue #3 and ### heading stay",
    ].join("\n");
    const out = stripFragments(t);
    assert.ok(!out.includes(SECRET.slice(0, 20)));
    assert.ok(out.includes("/tester/day-one?x=1&y=2"));
    assert.ok(out.includes("issue #3 and ### heading stay"));
  });
  it("takes the fragment off a host with any top-level domain of 2 to 24 letters", () => {
    for (const tld of ["io", "com", "museum", "photography", "a".repeat(24)]) {
      assert.ok(!stripFragments(`go to app.example.${tld}/p#ab now`).includes("#ab"), tld);
      assert.ok(!stripFragments(`go to app.example.${tld}#ab now`).includes("#ab"), tld);
    }
  });
  it("takes off a date or code plus key pair, also split by a line break, and a fragment on a long scheme or host", () => {
    const KEY = "K".repeat(10) + "q".repeat(10) + "Z".repeat(10) + "x".repeat(10) + "R".repeat(5);
    assert.doesNotMatch(stripFragments(`x #${DATE}.${KEY} y`), /KKKK|qqqq|ZZZZ/);
    assert.equal(stripFragments(`x #${DATE}.abcdefghijkl y`), "x  y");
    assert.equal(stripFragments(`x %23abc%2Edefghijklmnopqrstu y`), "x  y");
    const out = stripFragments(`the link was #${DATE}.${KEY.slice(0, 20)}\n${KEY.slice(20)} and more`);
    assert.ok(!out.includes(KEY.slice(0, 10)) && !out.includes(KEY.slice(30)));
    assert.ok(!stripFragments(`${"a".repeat(60)}://x.com/p#ab`).includes("#ab"));
    assert.ok(!stripFragments(`${"a".repeat(80)}.com/p#ab`).includes("#ab"));
    assert.ok(!stripFragments(`https://x.com/${"p".repeat(2000)}#ab`).includes("#ab"));
  });
  it("leaves ordinary prose, anchors, issue numbers, walk ids and long words alone", () => {
    for (const t of [
      "The pricing section (#pricing) showed the price.",
      "see #pricing and #1 and issue #42",
      "### F1 title",
      "Finding #3: the button was grey.",
      "r1-03-projects-team-member-short-link-solofounder",
      "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch is a long word.",
      "internationalization and antidisestablishmentarianism",
      "https://example.com/blog/how-to-get-paid-faster-as-a-solo-electrician-in-2026",
      "I clicked Start, then Next.\nThen it said: Done.",
      "1.5 seconds, v2.3.1, e.g. this, file.md",
    ]) assert.equal(stripFragments(t), t);
  });
  it("has no fixed secret path: without secretPaths nothing after a path is dropped for its own sake", () => {
    assert.equal(stripFragments("go to /_door/tester?x=1 now"), "go to /_door/tester?x=1 now");
  });
  it("drops everything after each secret path up to whitespace, keeping the path", () => {
    const o = { secretPaths: ["/_door/tester", "/sign-in/guest"] };
    assert.equal(stripFragments("see https://app.example.com/_door/tester?x=1#whatever then", o), "see https://app.example.com/_door/tester then");
    assert.equal(stripFragments("a /sign-in/guest/abc123 b", o), "a /sign-in/guest b");
    assert.equal(stripFragments("a /other/path?x=1 b", o), "a /other/path?x=1 b");
  });
  it("matches a secret path with / written %2F, in any case", () => {
    const o = { secretPaths: ["/_door/tester"] };
    assert.equal(stripFragments("go https://app.example.com%2F_door%2Ftester%3Fk=SECRETVALUE then", { secretPaths: ["/_door/tester"] }).includes("SECRETVALUE"), false);
    assert.equal(stripFragments("x /_door%2Ftester?k=SECRETVALUE y", o), "x /_door%2Ftester y");
    assert.equal(stripFragments("x /_DOOR/Tester/SECRETVALUE y", o), "x /_DOOR/Tester y");
  });
  it("ignores empty, one-character and non-string secret paths and a missing options object", () => {
    for (const secretPaths of [[""], ["/"], [null, 5, {}], []]) assert.equal(stripFragments("a /x/y b", { secretPaths }), "a /x/y b");
    assert.equal(stripFragments("a b", undefined), "a b");
    assert.equal(stripFragments(undefined), "");
    assert.equal(stripFragments(null), "");
  });
  it("escapes regex characters in a secret path", () => {
    const o = { secretPaths: ["/a.b+c"] };
    assert.equal(stripFragments("x /a.b+cSECRET y", o), "x /a.b+c y");
    assert.equal(stripFragments("x /aXb+cSECRET y", o), "x /aXb+cSECRET y");
  });
});

describe("stripDeep and show", () => {
  it("strips every string in a value, keys untouched, other types unchanged, and passes secretPaths through", () => {
    const o = { secretPaths: ["/_door/tester"] };
    const v = { [`k#${SECRET}`]: [`a #${SECRET} b`, 3, null, true, { z: "/_door/tester/SECRETVALUE end" }] };
    const out = stripDeep(v, o);
    assert.deepEqual(Object.keys(out), [`k#${SECRET}`]);
    const arr = out[`k#${SECRET}`];
    assert.equal(arr[0], "a  b");
    assert.deepEqual(arr.slice(1, 4), [3, null, true]);
    assert.equal(arr[4].z, "/_door/tester end");
    assert.equal(stripDeep({ z: "/_door/tester/SECRETVALUE end" }).z, "/_door/tester/SECRETVALUE end");
    assert.equal(stripDeep(5), 5);
    assert.equal(stripDeep(undefined), undefined);
  });
  it("show clips long strings after stripping and never quotes part of a key", () => {
    assert.equal(show("short"), '"short"');
    assert.equal(show("x".repeat(50)), `"${"x".repeat(40)}…"`);
    assert.ok(!show(`my link #${DATE}.${MAC}`).includes("AAAA"));
    assert.equal(show(5), "5");
    assert.equal(show(undefined), "undefined");
  });
});

describe("safeName and REPORT_NAME", () => {
  it("keeps [A-Za-z0-9._-], turns the rest into ? and cuts at 80", () => {
    assert.equal(safeName("a b/c.d_e-f"), "a?b?c.d_e-f");
    assert.equal(safeName("x".repeat(200)).length, 80);
    assert.equal(safeName(5), "5");
  });
  it("REPORT_NAME wants r<round>- then lower-case letters, digits and hyphens", () => {
    assert.ok(REPORT_NAME.test("r1-01-goods-owner"));
    assert.ok(!REPORT_NAME.test("R1-01"));
    assert.ok(!REPORT_NAME.test("r1-"));
    assert.ok(!REPORT_NAME.test("r1-A"));
    assert.ok(!REPORT_NAME.test("1-a"));
  });
});

describe("constants", () => {
  it("export the shape's constants", () => {
    assert.deepEqual(SEVERITY, ["blocker", "confusing", "rough", "idea"]);
    assert.deepEqual(STEPS, ["saw", "used", "reacted", "invented"]);
    assert.deepEqual(DEEP_KEYS, ["jobs", "remembered", "would_pay"]);
    assert.equal(SITTINGS, 9);
    assert.equal(MAX_LIST, 500);
    assert.equal(MAX_REPORT_BYTES, 1024 * 1024);
    assert.equal(UNREADABLE.length, 4);
  });
});

describe("parseReport: the json block", () => {
  const r = parseReport(REPORT("r1-01-goods-owner-start-box"));
  it("reads every field of the shape with no problems", () => {
    assert.deepEqual(r.problems, []);
    assert.equal(r.id, "r1-01-goods-owner-start-box");
    assert.equal(r.tester, "A tester");
    assert.equal(r.started_utc, "2026-11-26T10:00:00Z");
    assert.equal(r.minutes, 31);
    assert.equal(r.width, 1280);
    assert.equal(r.finished, true);
    assert.equal(r.why_not_finished, null);
    assert.equal(r.loops.length, 3);
    assert.equal(r.loops[2].result_s, null);
    assert.equal(r.loops[2].stall, true);
    assert.equal(r.loops[2].stall_words, "tomorrow");
    assert.equal(r.screens[1].screen, "Team");
    assert.equal(r.findings[0].severity, "confusing");
    assert.equal(r.findings[0].shot, "01-home.png");
    assert.equal(r.first_five.understood, "an assistant");
    assert.deepEqual(r.come_back, { yes: true, reason: "it drafted my reply" });
    assert.match(r.notes, /The page was slow\./);
  });
  it("finds the block under ```json, a bare ``` and CRLF line ends", () => {
    const body = JSON.stringify(DATA("a"), null, 2);
    const bare = parseReport(fence(body, ""));
    assert.equal(bare.id, "a");
    assert.equal(probs(bare, /no json tag/).length, 1);
    const crlf = parseReport(fence(body, "JSON").replace(/\n/g, "\r\n"));
    assert.equal(crlf.id, "a");
    assert.deepEqual(crlf.problems, []);
  });
  it("takes the first json block when the tester copied an outer fence too", () => {
    const text = `\`\`\`\`\n# Report a\n\n\`\`\`json\n${JSON.stringify(DATA("a"))}\n\`\`\`\n\`\`\`\`\n`;
    assert.equal(parseReport(text).id, "a");
  });
  it("repairs a trailing comma and // comments, and says so", () => {
    const body = JSON.stringify(DATA("a"), null, 2).replace('"questions": []', '"questions": [], // none today').replace(/\n}$/, ",\n}");
    const p = parseReport(fence(body));
    assert.equal(p.id, "a");
    assert.equal(probs(p, /trailing comma/).length, 1);
    assert.equal(probs(p, /comment/).length, 1);
    const url = parseReport(fence(JSON.stringify(DATA("a", { questions: ["is https://test.example.com/ right?"] }))));
    assert.deepEqual(url.questions, ["is https://test.example.com/ right?"]);
    assert.deepEqual(url.problems, []);
  });
  it("reports a broken block with the line and column, and never throws", () => {
    const p = parseReport(fence('{\n  "id": "a",\n  "minutes": 3x\n}'));
    assert.equal(p.id, null);
    assert.equal(probs(p, /^the json block could not be read: .*line 3/).length, 1);
    for (const junk of ["", "hello", "```json\n[1,2]\n```", "```json\nnull\n```", null, undefined, 42]) {
      const q = parseReport(junk);
      assert.ok(Array.isArray(q.problems) && q.problems.length > 0);
      assert.equal(q.loops, null);
    }
    assert.ok(parseReport("no block here").problems.includes("no fenced json block"));
  });
  it("names every missing key and an unexpected one", () => {
    const d = DATA("a");
    delete d.loops;
    delete d.width;
    const p = parseReport(fence(JSON.stringify({ ...d, mood: "ok" })));
    assert.equal(p.loops, null);
    assert.equal(p.width, null);
    for (const line of ["missing key loops", "missing key width", "unexpected key mood (ignored)"]) assert.ok(p.problems.includes(line), line);
  });
  it("a 150 KB broken block reports line and column quickly, and no error line quotes the block", () => {
    const filler = Array.from({ length: 3000 }, (_, i) => `  "k${i}": "${"x".repeat(40)}",`).join("\n");
    const t = Date.now();
    const r = parseReport(fence(`{\n${filler}\n  "bad": nope here\n}`));
    assert.ok(Date.now() - t < 2000);
    assert.match(r.problems.join("\n"), /line \d+ column \d+/);
    const q = parseReport(fence(`{"id": "SECRETWORDS here", "x": nope, "y": "more SECRETWORDS"}`));
    const line = q.problems.find((x) => /could not be read/.test(x));
    assert.doesNotMatch(line, /SECRET|is not valid JSON|\.\.\./);
  });
  it("unreadableProblem names the problem that made a whole report unreadable, else null", () => {
    assert.equal(unreadableProblem(parseReport("nothing")), "no fenced json block");
    assert.match(unreadableProblem(parseReport(fence("{ broken"))), /^the json block could not be read/);
    assert.equal(unreadableProblem(parseReport("```json\n[1]\n```")), "the json block is not an object");
    assert.equal(unreadableProblem(parseReport(5)), "the report is not text");
    assert.equal(unreadableProblem(parseReport(REPORT("a"))), null);
  });
  it("cuts a list longer than MAX_LIST and says so", () => {
    const q = Array.from({ length: MAX_LIST + 5 }, (_, i) => `q${i}`);
    const p = parseReport(REPORT("a", { questions: q }));
    assert.equal(p.questions.length, MAX_LIST);
    assert.equal(probs(p, /entries; only the first/).length, 1);
  });
});

describe("parseReport: strict values", () => {
  const one = (loop) => parseReport(REPORT("a", { loops: [{ n: 1, start_s: 10, result_s: 40, did: "x", got: "y", aha: true, stall: false, stall_words: null, ...loop }] }));
  it("accepts yes/no/true/false/1/0 for a boolean with a slip, and refuses anything else", () => {
    for (const [v, want] of [["yes", true], ["No", false], ["true", true], [1, true], [0, false]]) {
      const p = one({ stall: v, aha: v, ...(want ? { result_s: null, stall_words: "wait" } : {}) });
      assert.equal(p.loops[0].stall, want);
      assert.equal(p.loops[0].aha, want);
      assert.equal(probs(p, /format slip/).length, 2);
    }
    const bad = one({ aha: "maybe" });
    assert.equal(bad.loops[0].aha, null);
    assert.equal(probs(bad, /loop 1: aha: "maybe" is not true or false/).length, 1);
  });
  it("accepts true/false and yes/no for screen scores as 1/0 with a slip, and refuses anything else", () => {
    const p = parseReport(REPORT("a", { screens: [{ n: 1, screen: "Home", address: null, saw: true, used: "no", reacted: "✓", invented: 2, line: "" }] }));
    assert.equal(p.screens[0].saw, 1);
    assert.equal(p.screens[0].used, 0);
    assert.equal(p.screens[0].reacted, null);
    assert.equal(p.screens[0].invented, null);
    assert.equal(probs(p, /format slip/).length, 2);
    assert.equal(probs(p, /screen 1: reacted/).length, 1);
  });
  it("refuses times that are clock times, text, negative, out of order or far past the walk", () => {
    assert.equal(one({ start_s: "10:02" }).loops[0].start_s, null);
    assert.equal(one({ result_s: "140" }).loops[0].result_s, null);
    assert.equal(one({ start_s: -5 }).loops[0].start_s, null);
    const backwards = one({ start_s: 100, result_s: 40 });
    assert.equal(backwards.loops[0].result_s, null);
    assert.equal(probs(backwards, /result_s 40 is before start_s 100/).length, 1);
    const wrapped = one({ result_s: 86330 });
    assert.equal(wrapped.loops[0].result_s, null);
    assert.equal(probs(wrapped, /longer than the walk/).length, 1);
    assert.equal(one({ result_s: 31 * 60 + 600 }).loops[0].result_s, 2460);
  });
  it("calls a loop with no result and no stall unreadable rather than a completed loop", () => {
    const p = one({ result_s: null });
    assert.equal(p.loops[0].stall, null);
    assert.equal(probs(p, /loop 1: no result_s but stall is false/).length, 1);
  });
  it("refuses an unknown severity, and reads a capitalised one with a slip", () => {
    const f = (severity) => parseReport(REPORT("a", { findings: [{ ...DATA("a").findings[0], severity }] }));
    assert.equal(f("weird").findings[0].severity, null);
    assert.equal(probs(f("weird"), /finding 1: severity "weird"/).length, 1);
    assert.equal(f("Blocker").findings[0].severity, "blocker");
    assert.equal(probs(f("Blocker"), /format slip/).length, 1);
  });
  it("checks the header: width, minutes, started_utc and finished", () => {
    const p = parseReport(REPORT("a", { width: "1280px", minutes: 0, started_utc: "17:05", finished: "sort of" }));
    for (const k of ["width", "minutes", "started_utc", "finished"]) assert.equal(p[k], null);
    assert.equal(probs(p, /^(width|minutes|started_utc|finished):/).length, 4);
  });
  it("takes a # part off an address, says so without repeating it, and refuses a non-web address", () => {
    const p = parseReport(REPORT("a", { screens: [{ n: 1, screen: "Door", address: "https://app.example.com/sign-in#SECRETSECRETSECRETSECRET", saw: 1, used: 1, reacted: 1, invented: 1, line: "" }, { n: 2, screen: "Odd", address: "somewhere", saw: 1, used: 1, reacted: 1, invented: 1, line: "" }] }));
    assert.equal(p.screens[0].address, "https://app.example.com/sign-in");
    assert.equal(p.screens[1].address, null);
    assert.equal(probs(p, /screen 1: address had a # part/).length, 1);
    assert.ok(!JSON.stringify(p).includes("SECRET"));
  });
  it("strips fragments from every string, including prose and notes", () => {
    const p = parseReport(REPORT("a", { questions: ["why did /tester/day-one#e30eyJwcm9maWxlIjp7In0 open?"] }) + "\nhttps://app.example.com/x%23eyJwcm9maWxlIjp7In0abc\n");
    assert.doesNotMatch(JSON.stringify(p), /eyJwcm9maWxl/);
  });
});

describe("parseReport: the deep keys and sittings 1 to 9", () => {
  const DEEP = (id) => DATA(id, {
    loops: [
      { n: 1, sitting: 1, start_s: 20, result_s: 70, did: "a", got: "b", aha: true, stall: false, stall_words: null },
      { n: 2, sitting: 9, start_s: 120, result_s: null, did: "c", got: "d", aha: false, stall: true, stall_words: "w" },
    ],
    screens: [{ n: 1, sitting: 5, screen: "Home", address: "https://app.example.com/", saw: 1, used: 1, reacted: 1, invented: 0, line: "ok" }],
    jobs: [
      { n: 1, job: "quote", finished: false, steps_done: 2, steps: 5, gave_up_at: 3, line: "no link" },
      { n: 2, job: "find", finished: true, steps_done: 4, steps: 4, gave_up_at: null, line: "found" },
    ],
    remembered: { yes: false, missed: ["the hours"] },
    would_pay: { yes: true, reason: "saves evenings" },
  });
  it("reads sittings up to 9, jobs, remembered and would_pay with no problem lines", () => {
    const r = parseReport(fence(JSON.stringify(DEEP("r4-01-x"))));
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.loops.map((l) => l.sitting), [1, 9]);
    assert.equal(r.screens[0].sitting, 5);
    assert.deepEqual(r.jobs[0], { n: 1, job: "quote", finished: false, steps_done: 2, steps: 5, gave_up_at: 3, line: "no link" });
    assert.deepEqual(r.remembered, { yes: false, missed: ["the hours"] });
    assert.deepEqual(r.would_pay, { yes: true, reason: "saves evenings" });
  });
  it("a report without deep keys has none on it", () => {
    const r = parseReport(REPORT("r3-01-x"));
    assert.ok(!("jobs" in r) && !("remembered" in r) && !("would_pay" in r));
    assert.ok(!("sitting" in r.loops[0]) && !("sitting" in r.screens[0]));
  });
  it("refuses sitting 0 and 10, a job count past its steps, a bad would_pay and a non-list missed", () => {
    for (const bad of [0, 10, 1.5, "2"]) {
      const d = DEEP("r4-01-x");
      d.loops[0].sitting = bad;
      const r = parseReport(fence(JSON.stringify(d)));
      assert.equal(r.loops[0].sitting, null, String(bad));
      assert.equal(probs(r, /loop 1: sitting: .* is not a whole number from 1 to 9/).length, 1);
    }
    const d = DEEP("r4-01-x");
    d.jobs[0].steps_done = 7;
    d.would_pay.yes = "maybe";
    d.remembered.missed = "hours";
    const r = parseReport(fence(JSON.stringify(d)));
    const all = r.problems.join("\n");
    assert.match(all, /job 1: steps_done 7 is more than steps 5/);
    assert.match(all, /would_pay.yes: "maybe" is not true or false/);
    assert.match(all, /remembered.missed: "hours" is not a list/);
    assert.equal(r.jobs[0].steps_done, null);
  });
});

describe("secretPaths through parseReport and submissionProblems", () => {
  const o = { secretPaths: ["/_door/tester"] };
  const text = REPORT("r1-01-a", { tester: "see /_door/tester/SECRETVALUE1", questions: ["opened https://app.example.com%2F_door%2Ftester%3Fk=SECRETVALUE2 ok?"] }) + "\nnotes /_door/tester/SECRETVALUE3 end\n";
  it("parseReport drops what follows a secret path, in fields and notes, only when given the option", () => {
    const withOpt = JSON.stringify(parseReport(text, o));
    assert.doesNotMatch(withOpt, /SECRETVALUE/);
    assert.match(withOpt, /\/_door\/tester end/);
    assert.match(JSON.stringify(parseReport(text)), /SECRETVALUE1/);
  });
  it("a secret path also covers a block that could not be read and a text with no block", () => {
    assert.doesNotMatch(JSON.stringify(parseReport("no block /_door/tester/SECRETVALUE", o)), /SECRETVALUE/);
  });
  it("submissionProblems passes it through to the report it returns", () => {
    const { report, problems } = submissionProblems(text, "r1-01-a", o);
    assert.doesNotMatch(JSON.stringify(report), /SECRETVALUE/);
    assert.doesNotMatch(JSON.stringify(problems), /SECRETVALUE/);
    assert.doesNotMatch(JSON.stringify(submissionProblems(REPORT("r1-01-a", { id: "/_door/tester/SECRETVALUE9" }), "r1-01-a", o)), /SECRETVALUE9/);
  });
});

describe("submissionProblems and REPORT_TEMPLATE", () => {
  it("accepts the template as written, for the id it was made for", () => {
    assert.deepEqual(submissionProblems(REPORT_TEMPLATE("r1-01-a"), "r1-01-a").problems, []);
    assert.deepEqual(submissionProblems(REPORT_TEMPLATE("r9-12-some-walk", "Pat"), "r9-12-some-walk").problems, []);
    assert.deepEqual(submissionProblems(REPORT_TEMPLATE(), "<walk id>").problems, []);
  });
  it("the template has a heading, one json block with every key, example.com addresses and a Notes section", () => {
    const t = REPORT_TEMPLATE("r1-01-a", "Pat");
    assert.match(t, /^# Report r1-01-a\n/);
    assert.match(t, /\n## Notes\n/);
    assert.equal(t.match(/```json/g).length, 1);
    const r = parseReport(t);
    assert.equal(r.tester, "Pat");
    for (const k of ["id", "tester", "started_utc", "minutes", "width", "finished", "why_not_finished", "loops", "screens", "findings", "first_five", "come_back", "questions"]) assert.ok(k in r, k);
    for (const s of r.screens) assert.match(s.address, /example\.com/);
    assert.deepEqual(REPORT_TEMPLATE("x"), REPORT_TEMPLATE("x", "the tester"));
  });
  it("refuses a report for another walk, and every slip", () => {
    const wrong = submissionProblems(REPORT_TEMPLATE("r1-01-a"), "r1-02-b");
    assert.equal(wrong.problems.length, 1);
    assert.match(wrong.problems[0], /is not this walk's id/);
    assert.ok(submissionProblems(REPORT("r1-01-a", { finished: "yes" }), "r1-01-a").problems.length > 0);
    assert.ok(submissionProblems("nothing here", "r1-01-a").problems.includes("no fenced json block"));
    assert.equal(submissionProblems("nothing here", "r1-01-a").problems.length, 1);
  });
});

describe("property tests", () => {
  const B64 = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"];
  const fakeKey = fc.array(fc.constantFrom(...B64), { minLength: 36, maxLength: 36 }).map((a) => `FAKEKEY${a.join("")}`);
  const piece = fc.oneof(
    fc.string({ maxLength: 20 }),
    fc.constantFrom("#", "%23", "%2F", "/", "https://app.example.com/", "app.example.io", "/_door/tester", "#abc", "\n", " ", "(", ")", "```", "issue #3", "### H", "?x=1&y=2", "."),
    fakeKey.map((k) => `#${k}`),
    fakeKey.map((k) => `https://app.example.com/p#2026-11-26.${k}`),
    fakeKey,
  );
  const textArb = fc.array(piece, { maxLength: 12 }).map((a) => a.join(""));
  const optsArb = fc.constantFrom({}, { secretPaths: ["/_door/tester"] }, { secretPaths: ["/a/b", "/sign-in"] });

  it("stripping twice equals stripping once", () => {
    fc.assert(fc.property(textArb, optsArb, (t, o) => {
      const once = stripFragments(t, o);
      assert.equal(stripFragments(once, o), once);
      const deep = stripDeep({ a: [t], b: { c: t } }, o);
      assert.deepEqual(stripDeep(deep, o), deep);
    }), { numRuns: 1500 });
  });
  it("no output contains # followed by 20 or more of [A-Za-z0-9_.~%+=-]", () => {
    const re = /#[A-Za-z0-9_.~%+=-]{20,}/;
    fc.assert(fc.property(textArb, optsArb, (t, o) => {
      assert.doesNotMatch(stripFragments(t, o), re);
      assert.doesNotMatch(JSON.stringify(stripDeep({ x: t }, o)).replace(/\\n/g, "\n"), re);
    }), { numRuns: 1500 });
  });
  it("a fake key in random surrounding text never survives stripFragments or stripDeep", () => {
    const shape = fc.constantFrom("hash", "pct", "key", "pair", "url");
    const around = fc.string({ maxLength: 20 });
    fc.assert(fc.property(fakeKey, shape, around, around, (key, s, pre, post) => {
      const secret = { hash: `#${key}`, pct: `%23${key}`, key, pair: `${DATE}.${key}`, url: `https://app.example.com/p#${key}` }[s];
      const text = `${pre} ${secret} ${post}`;
      for (const out of [stripFragments(text), stripDeep({ x: [text] }).x[0]]) {
        for (let i = 0; i + 10 <= key.length; i++) if (!(pre + post).includes(key.slice(i, i + 10))) assert.ok(!out.includes(key.slice(i, i + 10)));
      }
    }), { numRuns: 1000 });
  });
  it("secretPaths: nothing after the path survives, however its / is written", () => {
    const tail = fc.stringMatching(/^[A-Za-z0-9_.~=-]{1,30}$/);
    fc.assert(fc.property(tail, fc.boolean(), fc.constantFrom("/", "?", "#", ""), (rest, enc, join) => {
      const p = enc ? "%2F_door%2Ftester" : "/_door/tester";
      const out = stripFragments(`before ${p}${join}SECRET${rest} after`, { secretPaths: ["/_door/tester"] });
      assert.ok(!out.includes("SECRET"));
      assert.ok(out.startsWith("before ") && out.endsWith(" after"));
    }), { numRuns: 500 });
  });
  it("parseReport never throws and always returns a problems array", () => {
    fc.assert(fc.property(fc.oneof(textArb, fc.anything()), (raw) => {
      assert.ok(Array.isArray(parseReport(raw).problems));
    }), { numRuns: 500 });
  });
});

describe("the module is portable", () => {
  const src = fs.readFileSync(new URL("../src/lib/persona/report-shape.js", import.meta.url), "utf8");
  it("has no node: import and no import of any kind", () => {
    assert.doesNotMatch(src, /["'`]node:/);
    assert.doesNotMatch(src, /\bfrom\s+["']/);
    assert.doesNotMatch(src, /^\s*import\s/m);
    assert.doesNotMatch(src, /\brequire\(/);
  });
  it("names no product, site or person", () => {
    for (const w of ["Ezi", "ezihq", "Duet", "Dani"]) assert.ok(!src.toLowerCase().includes(w.toLowerCase()), w);
  });
});
