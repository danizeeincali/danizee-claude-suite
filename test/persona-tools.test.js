import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as shape from "../src/lib/persona/report-shape.js";
import { callTool, toolsFor, TOOLS, CAPS, RETENTION_DAYS, checkAgainMinutes, CODING_ONLY } from "../src/lib/persona/tools.js";
import { openStore } from "../src/lib/persona/sqlite.js";
import { NOW, MIN, DAY, call, report, accept, published, count, dump } from "./helpers/persona-fixtures.js";

const TESTER = { role: "tester" };
const iso = (ms) => new Date(ms).toISOString();

describe("the tools and their roles", () => {
  it("every tool has owner words, an input schema and one role", () => {
    for (const t of TOOLS) {
      assert.ok(t.description.length > 20, t.name);
      assert.equal(t.inputSchema.type, "object");
      assert.ok(t.role === "tester" || t.role === "coding", t.name);
    }
    assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length);
  });

  it("the tester has eight tools, the coding thread has every one, and the listed definitions carry no role key", () => {
    const tester = toolsFor("tester").map((t) => t.name);
    assert.deepEqual(tester.sort(), ["answers", "ask", "get_brief", "guide", "next_walk", "notes", "start_walk", "submit_report"]);
    const coding = toolsFor("coding").map((t) => t.name);
    assert.equal(coding.length, 18);
    for (const n of ["publish_round", "close_round", "post_note", "clear_notes", "list_reports", "get_report", "export_round", "open_questions", "answer", "rounds"]) {
      assert.ok(coding.includes(n), n);
      assert.ok(!tester.includes(n), n);
    }
    for (const t of [...toolsFor("tester"), ...toolsFor("coding")]) {
      assert.deepEqual(Object.keys(t).sort(), ["annotations", "description", "inputSchema", "name"]);
    }
    // Anything that is not the coding role is the tester.
    assert.deepEqual(toolsFor(undefined).map((t) => t.name).sort(), tester.sort());
  });

  it("a tester calling a coding tool is refused in words and nothing is written", async () => {
    const db = openStore();
    for (const name of ["publish_round", "close_round", "post_note", "clear_notes", "list_reports", "get_report", "export_round", "open_questions", "answer", "rounds"]) {
      const r = await call(db, name, {}, TESTER);
      assert.equal(r.isError, true, name);
      assert.deepEqual(r.data, { error: CODING_ONLY });
    }
    const pub = await call(db, "publish_round", { round: 1, briefs: [{ id: "r1-01-a", brief: "x" }] }, TESTER);
    assert.equal(pub.isError, true);
    assert.equal(count(db, "persona_briefs"), 0);
    // The coding role may call the tester's tools too.
    assert.equal((await call(db, "guide", {}, { role: "coding" })).isError, false);
    assert.equal((await call(db, "guide", {}, TESTER)).isError, false);
  });

  it("an unknown tool or bad arguments is an answer in words, never a throw", async () => {
    const db = openStore();
    assert.equal((await call(db, "nope")).isError, true);
    const bad = await call(db, "get_brief", { id: 5 });
    assert.equal(bad.isError, true);
    assert.match(bad.data.error, /id/);
    assert.equal((await call(db, "get_brief", { id: "r1-01-x", extra: 1 })).isError, true);
    assert.equal((await call(db, "next_walk", [])).isError, true);
    assert.equal((await callTool("next_walk", {}, { db: undefined, now: NOW })).isError, true);
    assert.equal((await callTool(7, {}, { db, now: NOW })).isError, true);
  });

  it("a database that throws is the one generic sentence, with nothing of the error in it", async () => {
    const db = { prepare: () => { throw new Error("secret detail /etc/passwd"); } };
    const r = await call(db, "notes");
    assert.equal(r.isError, true);
    assert.match(r.data.error, /couldn't be read/);
    assert.ok(!JSON.stringify(r.data).includes("passwd"));
  });

  it("works over a store with no batch", async () => {
    const real = openStore();
    const plain = { prepare: (sql) => real.prepare(sql) };
    assert.equal((await call(plain, "publish_round", { round: 1, briefs: [{ id: "r1-01-a", brief: "x" }] })).isError, false);
    assert.equal((await call(plain, "next_walk", {}, TESTER)).data.id, "r1-01-a");
  });

  it("descriptions name no product and no site path", () => {
    for (const t of TOOLS) assert.doesNotMatch(JSON.stringify(t), /\/api\/|\b(ezi|ezihq|bos|duet|dani)\b/i, t.name);
    assert.match(TOOLS.find((t) => t.name === "publish_round").description, /POST <this server>\/bundle/);
    assert.match(TOOLS.find((t) => t.name === "export_round").description, /GET <this server>\/export\?code=<code>/);
  });
});

describe("one validator", () => {
  it("the connector reads reports with the report-shape module and nothing in the tools needs Node", () => {
    const src = readFileSync(new URL("../src/lib/persona/tools.js", import.meta.url), "utf8");
    assert.match(src, /from "\.\/report-shape\.js"/);
    assert.doesNotMatch(src, /from "node:|require\(|import\("node:/);
  });

  it("the template report is accepted as it stands", async () => {
    const db = await published(openStore());
    assert.deepEqual((await accept(db, "r1-01-florist")).data, { accepted: true, version: 1, clock_minutes: 0 });
  });
});

describe("publish_round, next_walk, get_brief, guide", () => {
  it("publishes a round and hands out its walks in order until each has an accepted report", async () => {
    const db = await published(openStore());
    assert.deepEqual((await call(db, "guide", {}, TESTER)).data, { round: 1, guide: "Guide for round 1." });
    const first = (await call(db, "next_walk", {}, TESTER)).data;
    assert.deepEqual({ ...first, start: undefined }, { id: "r1-01-florist", round: 1, brief: "Brief for r1-01-florist.", check_again_minutes: 1, start: undefined });
    assert.match(first.start, /start_walk/);
    assert.deepEqual((await call(db, "get_brief", { id: "r1-02-plumber" }, TESTER)).data, { id: "r1-02-plumber", round: 1, brief: "Brief for r1-02-plumber." });
    assert.equal((await call(db, "get_brief", { id: "r1-09-none" }, TESTER)).isError, true);
    await accept(db, "r1-01-florist");
    assert.equal((await call(db, "next_walk", {}, TESTER)).data.id, "r1-02-plumber");
    // A rejected report never counts: the walk is still next.
    await call(db, "start_walk", { id: "r1-02-plumber" }, TESTER);
    assert.equal((await call(db, "submit_report", { id: "r1-02-plumber", report: "no block" }, TESTER)).data.accepted, false);
    assert.equal((await call(db, "next_walk", {}, TESTER)).data.id, "r1-02-plumber");
    await accept(db, "r1-02-plumber");
    await accept(db, "r1-03-cafe");
    const done = (await call(db, "next_walk", {}, TESTER)).data;
    assert.equal(done.done, true);
    assert.equal("id" in done, false);
  });

  it("replaces a round's briefs, keeps the guide when none is given, and refuses to drop a walk with an accepted report", async () => {
    const db = await published(openStore());
    await accept(db, "r1-01-florist");
    await call(db, "start_walk", { id: "r1-02-plumber" });
    await call(db, "submit_report", { id: "r1-02-plumber", report: "rejected words" });
    const refused = await call(db, "publish_round", { round: 1, briefs: [{ id: "r1-02-plumber", brief: "New." }] });
    assert.equal(refused.isError, true);
    assert.match(refused.data.error, /r1-01-florist/);
    assert.equal((await call(db, "get_brief", { id: "r1-03-cafe" })).isError, false);
    const ok = await call(db, "publish_round", { round: 1, briefs: [{ id: "r1-01-florist", brief: "Florist again." }, { id: "r1-04-new", brief: "New walk." }] });
    assert.deepEqual(ok.data, { round: 1, briefs: 2, dropped: ["r1-02-plumber", "r1-03-cafe"] });
    assert.equal((await call(db, "get_brief", { id: "r1-03-cafe" })).isError, true);
    assert.equal((await call(db, "get_brief", { id: "r1-01-florist" })).data.brief, "Florist again.");
    assert.equal((await call(db, "guide")).data.guide, "Guide for round 1.");
    // A dropped walk's start is dropped with it.
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM persona_walks WHERE walk_id = 'r1-02-plumber'").get().n, 0);
  });

  it("checks ids, duplicates and caps", async () => {
    const db = openStore();
    const err = async (args) => (await call(db, "publish_round", args)).isError;
    assert.equal(await err({ round: 1, briefs: [{ id: "r2-01-wrong-round", brief: "x" }] }), true);
    assert.equal(await err({ round: 1, briefs: [{ id: "R1-01-Caps", brief: "x" }] }), true);
    assert.equal(await err({ round: 1, briefs: [{ id: "r1-01-a", brief: "x" }, { id: "r1-01-a", brief: "y" }] }), true);
    assert.equal(await err({ round: 1, briefs: [] }), true);
    assert.equal(await err({ round: 0, briefs: [{ id: "r0-01-a", brief: "x" }] }), true);
    assert.equal(await err({ round: 1 }), true);
    assert.equal(await err({ round: 1, briefs: [{ id: "r1-01-a", brief: "x".repeat(CAPS.briefBytes + 1) }] }), true);
    assert.equal(await err({ round: 1, guide: "x".repeat(CAPS.briefBytes + 1), briefs: [{ id: "r1-01-a", brief: "x" }] }), true);
    assert.equal(await err({ round: 1, briefs: Array.from({ length: CAPS.rowsPerRound + 1 }, (_, i) => ({ id: `r1-${i}`, brief: "x" })) }), true);
    assert.equal(await err({ round: 1, briefs: [{ id: "r1-01-a", brief: "x".repeat(CAPS.briefBytes) }] }), false);
    // Bytes, not characters: 64 KB of three-byte characters is a third as many.
    assert.equal(await err({ round: 1, briefs: [{ id: "r1-01-a", brief: "…".repeat(Math.floor(CAPS.briefBytes / 3) + 1) }] }), true);
  });

  it("no query binds more than 100 parameters, even when publish_round drops hundreds of walks", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `r1-${String(i).padStart(3, "0")}-walk`);
    const db = await published(openStore(), 1, ids);
    await accept(db, ids[299]);
    const refused = await call(db, "publish_round", { round: 1, briefs: [{ id: ids[0], brief: "Only one." }] });
    assert.equal(refused.isError, true);
    assert.ok(refused.data.error.includes(ids[299]));
    assert.ok(!refused.data.error.includes(ids[1]));
    const ok = await call(db, "publish_round", { round: 1, briefs: [{ id: ids[299], brief: "Kept." }] });
    assert.equal(ok.data.dropped.length, 299);
  });
});

describe("guide", () => {
  it("answers the guide of the round named, else of the round next_walk serves, else of the latest round that has one", async () => {
    const db = openStore();
    assert.deepEqual((await call(db, "guide")).data, { round: null, guide: "No guide has been published yet. Ask the coding thread with ask." });
    await published(db, 1, ["r1-01-a"]);
    await published(db, 2, ["r2-01-b"]);
    assert.deepEqual((await call(db, "guide")).data, { round: 2, guide: "Guide for round 2." });
    assert.deepEqual((await call(db, "guide", { round: 1 })).data, { round: 1, guide: "Guide for round 1." });
    assert.match((await call(db, "guide", { round: 7 })).data.guide, /No guide has been published for round 7/);
    // Round 2 is done: round 1 is served, so its guide is.
    await accept(db, "r2-01-b");
    assert.deepEqual((await call(db, "guide")).data, { round: 1, guide: "Guide for round 1." });
    // Everything done: the latest round that has a guide.
    await accept(db, "r1-01-a");
    assert.deepEqual((await call(db, "guide")).data, { round: 2, guide: "Guide for round 2." });
    // A round without a guide falls back to the latest that has one.
    await call(db, "publish_round", { round: 3, briefs: [{ id: "r3-01-c", brief: "x" }] });
    assert.deepEqual((await call(db, "guide")).data, { round: 2, guide: "Guide for round 2." });
    assert.equal((await call(db, "guide", { round: 0 })).isError, true);
  });

  it("publishing again without a guide keeps the one there; with one replaces it", async () => {
    const db = await published(openStore(), 1, ["r1-01-a"]);
    await call(db, "publish_round", { round: 1, briefs: [{ id: "r1-01-a", brief: "y" }] });
    assert.equal((await call(db, "guide", { round: 1 })).data.guide, "Guide for round 1.");
    await call(db, "publish_round", { round: 1, guide: "New guide.", briefs: [{ id: "r1-01-a", brief: "y" }] });
    assert.equal((await call(db, "guide", { round: 1 })).data.guide, "New guide.");
  });
});

describe("rounds served newest open first", () => {
  async function two() {
    const db = openStore();
    await published(db, 5, ["r5-01-a", "r5-02-b"]);
    await published(db, 6, ["r6-01-c"]);
    return db;
  }

  it("serves the newest round with an open walk; when it is done it serves the older round", async () => {
    const db = await two();
    assert.equal((await call(db, "next_walk", {}, TESTER)).data.id, "r6-01-c");
    await accept(db, "r6-01-c");
    const next = (await call(db, "next_walk", {}, TESTER)).data;
    assert.equal(next.id, "r5-01-a");
    assert.equal(next.round, 5);
    await accept(db, "r5-01-a");
    assert.equal((await call(db, "next_walk", {}, TESTER)).data.id, "r5-02-b");
    await accept(db, "r5-02-b");
    assert.equal((await call(db, "next_walk", {}, TESTER)).data.done, true);
  });

  it("with a round given it serves that round only", async () => {
    const db = await two();
    assert.equal((await call(db, "next_walk", { round: 5 }, TESTER)).data.id, "r5-01-a");
    await accept(db, "r6-01-c");
    assert.equal((await call(db, "next_walk", { round: 6 }, TESTER)).data.done, true);
    assert.equal((await call(db, "next_walk", { round: 9 }, TESTER)).data.done, true);
    assert.equal((await call(db, "next_walk", { round: 0 }, TESTER)).isError, true);
  });

  it("a closed round is never served, and a given closed round answers done and closed", async () => {
    const db = await two();
    assert.deepEqual((await call(db, "close_round", { round: 6 })).data, { round: 6, closed: true });
    const next = (await call(db, "next_walk", {}, TESTER)).data;
    assert.equal(next.id, "r5-01-a");
    const closed = (await call(db, "next_walk", { round: 6 }, TESTER)).data;
    assert.equal(closed.done, true);
    assert.equal(closed.closed, true);
    await call(db, "close_round", { round: 5 });
    const none = (await call(db, "next_walk", {}, TESTER)).data;
    assert.equal(none.done, true);
    assert.equal("closed" in none, false);
    // Reopening serves it again.
    assert.deepEqual((await call(db, "close_round", { round: 6, reopen: true })).data, { round: 6, closed: false });
    assert.equal((await call(db, "next_walk", {}, TESTER)).data.id, "r6-01-c");
  });

  it("a report for a walk of a closed round is refused in words, and kept nowhere", async () => {
    const db = await two();
    await call(db, "start_walk", { id: "r6-01-c" }, TESTER);
    await call(db, "close_round", { round: 6 });
    const r = await call(db, "submit_report", { id: "r6-01-c", report: report("r6-01-c") }, TESTER);
    assert.equal(r.isError, true);
    assert.equal(r.data.error, "Round 6 is closed.");
    assert.equal(count(db, "persona_reports"), 0);
    await call(db, "close_round", { round: 6, reopen: true });
    assert.equal((await call(db, "submit_report", { id: "r6-01-c", report: report("r6-01-c") }, TESTER)).data.accepted, true);
  });

  it("a closed round's reports stay readable, and publishing it again opens it", async () => {
    const db = await two();
    await accept(db, "r6-01-c");
    await call(db, "close_round", { round: 6 });
    assert.equal((await call(db, "list_reports", { round: 6 })).data.walks[0].status, "accepted");
    assert.equal((await call(db, "get_report", { id: "r6-01-c" })).data.status, "accepted");
    assert.equal((await call(db, "export_round", { round: 6 })).isError, false);
    await call(db, "publish_round", { round: 6, briefs: [{ id: "r6-01-c", brief: "Again." }, { id: "r6-02-d", brief: "More." }] });
    assert.equal((await call(db, "rounds")).data.rounds[0].closed, false);
    assert.equal((await call(db, "next_walk", {}, TESTER)).data.id, "r6-02-d");
  });

  it("close_round checks its arguments and needs briefs", async () => {
    const db = await two();
    assert.equal((await call(db, "close_round", { round: 9 })).isError, true);
    assert.equal((await call(db, "close_round", {})).isError, true);
    assert.equal((await call(db, "close_round", { round: 5, reopen: "yes" })).isError, true);
    assert.equal((await call(db, "close_round", { round: 5, extra: 1 })).isError, true);
    // Closing twice is harmless.
    await call(db, "close_round", { round: 5 });
    assert.equal((await call(db, "close_round", { round: 5 })).data.closed, true);
    // A closed round keeps its guide.
    assert.equal((await call(db, "guide", { round: 5 })).data.guide, "Guide for round 5.");
  });
});

describe("rounds", () => {
  it("lists every round newest first with its counts", async () => {
    const db = openStore();
    assert.deepEqual((await call(db, "rounds")).data, { rounds: [] });
    await published(db, 2, ["r2-01-a", "r2-02-b", "r2-03-c"], NOW);
    await call(db, "publish_round", { round: 3, briefs: [{ id: "r3-01-d", brief: "x" }] }, { now: NOW + MIN });
    await accept(db, "r2-01-a", NOW + 2 * MIN);
    await call(db, "close_round", { round: 3 }, { now: NOW + 3 * MIN });
    assert.deepEqual((await call(db, "rounds")).data, {
      rounds: [
        { round: 3, briefs: 1, accepted: 0, open: 1, closed: true, has_guide: false, updated: iso(NOW + 3 * MIN) },
        { round: 2, briefs: 3, accepted: 1, open: 2, closed: false, has_guide: true, updated: iso(NOW) },
      ],
    });
    assert.equal((await call(db, "rounds", { x: 1 })).isError, true);
  });
});

describe("submit_report", () => {
  it("every walk must be started: a report for a walk never started is refused, stores nothing, and the clock counts from the start", async () => {
    const db = await published(openStore());
    const r = await call(db, "submit_report", { id: "r1-01-florist", report: report("r1-01-florist") }, TESTER);
    assert.deepEqual(r.data, { accepted: false, problems: ["r1-01-florist was never started: call start_walk with this id just before you begin the walk, then hand the report in."] });
    assert.equal(r.isError, false);
    assert.equal(count(db, "persona_reports"), 0);
    await call(db, "start_walk", { id: "r1-01-florist" }, { ...TESTER, now: NOW });
    const ok = await call(db, "submit_report", { id: "r1-01-florist", report: report("r1-01-florist") }, { ...TESTER, now: NOW + 31 * MIN });
    assert.deepEqual(ok.data, { accepted: true, version: 1, clock_minutes: 31 });
    const listed = (await call(db, "list_reports", { round: 1 })).data.walks[0];
    assert.deepEqual(listed, { id: "r1-01-florist", status: "accepted", version: 1, received: iso(NOW + 31 * MIN), problems: 0, started: iso(NOW), clock_minutes: 31 });
  });

  it("rejects words for scores with the reader's exact problem text, and stores the rejected report", async () => {
    const db = await published(openStore());
    await call(db, "start_walk", { id: "r1-01-florist" });
    const words = report("r1-01-florist").replace('"saw": 1', '"saw": "yes"').replace('"used": 0', '"used": "good"');
    const r = await call(db, "submit_report", { id: "r1-01-florist", report: words });
    assert.deepEqual(r.data, { accepted: false, version: 1, problems: ['screen 1: saw: format slip, "yes" read as 1', 'screen 1: used: "good" is not 0 or 1 (not used)'] });
    const listed = await call(db, "list_reports", { round: 1 });
    assert.equal(listed.data.walks[0].status, "rejected");
    assert.equal(listed.data.walks[0].problems, 2);
    const got = await call(db, "get_report", { id: "r1-01-florist" });
    assert.equal(got.data.status, "rejected");
    assert.equal(got.data.problems.length, 2);
  });

  it("lists every problem in plain words: a missing key, no json block, a wrong id", async () => {
    const db = await published(openStore());
    await call(db, "start_walk", { id: "r1-01-florist" });
    const missing = report("r1-01-florist").replace('  "width": 1280,\n', "");
    assert.deepEqual((await call(db, "submit_report", { id: "r1-01-florist", report: missing })).data.problems, ["missing key width"]);
    assert.deepEqual((await call(db, "submit_report", { id: "r1-01-florist", report: "I liked it." })).data.problems, ["no fenced json block"]);
    assert.deepEqual((await call(db, "submit_report", { id: "r1-01-florist", report: report("r1-02-plumber") })).data.problems, ['id: "r1-02-plumber" is not this walk\'s id "r1-01-florist"']);
  });

  it("refuses a walk that has no brief, without storing anything", async () => {
    const db = await published(openStore());
    const r = await call(db, "submit_report", { id: "r1-77-ghost", report: report("r1-77-ghost") });
    assert.equal(r.isError, true);
    assert.match(r.data.error, /No brief/);
    assert.equal(count(db, "persona_reports"), 0);
  });

  it("every submission is a new version; the latest accepted one is the walk's report", async () => {
    const db = await published(openStore());
    await accept(db, "r1-01-florist");
    await call(db, "submit_report", { id: "r1-01-florist", report: report("r1-01-florist").replace("Two or three lines.", "Second take.") });
    const third = await call(db, "submit_report", { id: "r1-01-florist", report: "broken" });
    assert.equal(third.data.version, 3);
    const got = await call(db, "get_report", { id: "r1-01-florist" });
    assert.equal(got.data.version, 2);
    assert.equal(got.data.status, "accepted");
    assert.deepEqual(got.data.problems, []);
    assert.match(got.data.report, /Second take\./);
    assert.doesNotMatch((await call(db, "get_report", { id: "r1-01-florist", version: 1 })).data.report, /Second take\./);
    assert.equal((await call(db, "get_report", { id: "r1-01-florist", version: 3 })).data.status, "rejected");
    assert.equal((await call(db, "get_report", { id: "r1-01-florist", version: 9 })).isError, true);
    assert.equal((await call(db, "get_report", { id: "r1-02-plumber" })).isError, true);
    const walks = (await call(db, "list_reports", { round: 1 })).data.walks;
    assert.deepEqual(walks.map((w) => [w.id, w.status, w.version]), [["r1-01-florist", "accepted", 2], ["r1-02-plumber", "none", null], ["r1-03-cafe", "none", null]]);
    assert.deepEqual(walks[1], { id: "r1-02-plumber", status: "none", version: null, received: null, problems: 0, started: null, clock_minutes: null });
  });

  it("strips secrets before storing: nothing after a # of an address, no link key, and each secret path with what follows", async () => {
    const db = await published(openStore());
    await call(db, "start_walk", { id: "r1-01-florist" });
    const key = "Zx9_kQ2-mP7wLr4TbN8vYc3HdJ6sFa1GeU5oIi0Kq-W";
    const text = `${report("r1-01-florist")}\nSigned in at https://app.example.com/#2026-11-25.${key} then https://app.example.com/_in/tester/abc123 and https://test.example.com/start#ref=secret-part.`;
    const r = await call(db, "submit_report", { id: "r1-01-florist", report: text }, { secretPaths: ["/_in/tester"] });
    assert.equal(r.data.accepted, true);
    const stored = (await call(db, "get_report", { id: "r1-01-florist" })).data.report;
    for (const s of [key, "abc123", "secret-part"]) assert.ok(!stored.includes(s), s);
    assert.ok(stored.includes("https://test.example.com/start"));
    assert.ok(!dump(db).includes(key));
    // Without the path given, the path is not special.
    await call(db, "start_walk", { id: "r1-02-plumber" });
    await call(db, "submit_report", { id: "r1-02-plumber", report: `${report("r1-02-plumber")}\nhttps://app.example.com/_in/tester/zzz999` });
    assert.match((await call(db, "get_report", { id: "r1-02-plumber" })).data.report, /zzz999/);
    // A # in an address is a rejection and the secret still never reaches the table.
    await call(db, "start_walk", { id: "r1-03-cafe" });
    const hashed = report("r1-03-cafe").replace('"address": "https://app.example.com/",\n      "saw"', `"address": "https://app.example.com/#2026-11-25.${key}",\n      "saw"`);
    const rej = await call(db, "submit_report", { id: "r1-03-cafe", report: hashed });
    assert.deepEqual(rej.data.problems, ["screen 1: address had a # part; it was removed"]);
    assert.ok(!dump(db).includes(key));
  });

  it("caps a report at 256 KB and a round at 500 reports", async () => {
    const db = await published(openStore());
    await call(db, "start_walk", { id: "r1-01-florist" });
    const big = await call(db, "submit_report", { id: "r1-01-florist", report: report("r1-01-florist") + "x".repeat(CAPS.reportBytes) });
    assert.equal(big.isError, true);
    assert.match(big.data.error, /256 KB/);
    const ins = db.raw.prepare("INSERT INTO persona_reports (walk_id, version, body, status, problems, received_at) VALUES ('r1-02-plumber', ?, 'x', 'rejected', '[]', ?)");
    for (let v = 1; v <= CAPS.rowsPerRound; v++) ins.run(v, iso(NOW));
    const full = await call(db, "submit_report", { id: "r1-01-florist", report: report("r1-01-florist") });
    assert.equal(full.isError, true);
    assert.match(full.data.error, /500/);
  });

  it("a report with thousands of problems comes back rejected with a capped list, stored far under the column's limit", async () => {
    const db = await published(openStore());
    await call(db, "start_walk", { id: "r1-01-florist" });
    const loops = Array.from({ length: 500 }, () => ({ n: "x", start_s: "x", result_s: "x", did: 1, got: 1, aha: "x", stall: "x", stall_words: 1 }));
    const screens = Array.from({ length: 500 }, () => ({ n: "x", screen: 1, address: "nope", line: 1, saw: "x", used: "x", reacted: "x", invented: "x" }));
    const noisy = "```json\n" + JSON.stringify({ id: "r1-01-florist", tester: "t", started_utc: null, minutes: 30, width: 1280, finished: true, why_not_finished: null, loops, screens, findings: [], first_five: null, come_back: null, questions: [] }) + "\n```\n";
    assert.ok(new TextEncoder().encode(noisy).length < CAPS.reportBytes);
    const all = shape.submissionProblems(noisy, "r1-01-florist").problems;
    assert.ok(JSON.stringify(all).length > 262_144);
    const r = await call(db, "submit_report", { id: "r1-01-florist", report: noisy });
    assert.equal(r.isError, false);
    assert.equal(r.data.accepted, false);
    assert.equal(r.data.problems.length, CAPS.problemsShown + 1);
    assert.deepEqual(r.data.problems.slice(0, CAPS.problemsShown), all.slice(0, CAPS.problemsShown));
    assert.equal(r.data.problems.at(-1), `…and ${all.length - CAPS.problemsShown} more problems; fix these and hand it in again to see the rest.`);
    const stored = db.raw.prepare("SELECT problems FROM persona_reports").get();
    assert.ok(stored.problems.length < 262_144 / 4);
    assert.deepEqual(JSON.parse(stored.problems), { total: all.length, lines: r.data.problems });
    assert.deepEqual((await call(db, "get_report", { id: "r1-01-florist" })).data.problems, r.data.problems);
    assert.equal((await call(db, "list_reports", { round: 1 })).data.walks[0].problems, all.length);
  });

  it("one walk stuck handing in again is stopped at 30 versions, and every other walk still hands in", async () => {
    const db = await published(openStore());
    await call(db, "start_walk", { id: "r1-01-florist" });
    for (let v = 1; v <= CAPS.versionsPerWalk; v++) assert.equal((await call(db, "submit_report", { id: "r1-01-florist", report: "still wrong" })).data.version, v);
    const stuck = await call(db, "submit_report", { id: "r1-01-florist", report: report("r1-01-florist") });
    assert.equal(stuck.isError, true);
    assert.equal(stuck.data.error, `r1-01-florist already has ${CAPS.versionsPerWalk} versions, the most a walk keeps. Ask the coding thread with ask instead of handing it in again.`);
    assert.equal((await accept(db, "r1-02-plumber")).data.accepted, true);
  });
});

describe("start_walk and the real clock", () => {
  it("stamps the server's time; the first call wins", async () => {
    const db = await published(openStore());
    assert.deepEqual((await call(db, "start_walk", { id: "r1-01-florist" }, { now: NOW })).data, { id: "r1-01-florist", started: iso(NOW), already: false });
    assert.deepEqual((await call(db, "start_walk", { id: "r1-01-florist" }, { now: NOW + 5 * MIN })).data, { id: "r1-01-florist", started: iso(NOW), already: true });
    assert.equal((await call(db, "start_walk", { id: "r1-09-none" })).isError, true);
  });

  it("a walk with no accepted report and a start over 3 hours old can be started again; an accepted walk keeps its start", async () => {
    const db = await published(openStore());
    await call(db, "start_walk", { id: "r1-01-florist" }, { now: NOW });
    assert.equal((await call(db, "start_walk", { id: "r1-01-florist" }, { now: NOW + 3 * 3_600_000 })).data.already, true);
    const again = await call(db, "start_walk", { id: "r1-01-florist" }, { now: NOW + 3 * 3_600_000 + 1 });
    assert.deepEqual(again.data, { id: "r1-01-florist", started: iso(NOW + 3 * 3_600_000 + 1), already: false });
    await accept(db, "r1-02-plumber", NOW);
    assert.equal((await call(db, "start_walk", { id: "r1-02-plumber" }, { now: NOW + 5 * DAY })).data.already, true);
  });

  it("publishing a walk again does not reset its start", async () => {
    const db = await published(openStore());
    await call(db, "start_walk", { id: "r1-01-florist" }, { now: NOW });
    await call(db, "publish_round", { round: 1, briefs: [{ id: "r1-01-florist", brief: "Again." }] }, { now: NOW + MIN });
    assert.equal((await call(db, "start_walk", { id: "r1-01-florist" }, { now: NOW + 2 * MIN })).data.already, true);
  });
});

describe("questions and answers", () => {
  it("a question waits until it is answered; answers come back newest last, from a time on", async () => {
    const db = await published(openStore());
    const q1 = await call(db, "ask", { id: "r1-01-florist", question: "Should I press Send on the draft?" }, TESTER);
    const q2 = await call(db, "ask", { question: "Is the test business reset between walks?" }, { ...TESTER, now: NOW + 1000 });
    assert.equal(typeof q1.data.question_id, "number");
    assert.deepEqual((await call(db, "open_questions")).data.questions.map((q) => q.question_id), [q1.data.question_id, q2.data.question_id]);
    assert.deepEqual((await call(db, "open_questions")).data.questions[0], { question_id: q1.data.question_id, id: "r1-01-florist", question: "Should I press Send on the draft?", asked: iso(NOW) });
    assert.deepEqual((await call(db, "answers", {}, TESTER)).data, { answers: [] });
    await call(db, "answer", { question_id: q2.data.question_id, text: "Yes, every walk starts fresh." }, { now: NOW + 5000 });
    await call(db, "answer", { question_id: q1.data.question_id, text: "Never. Press Don't send." }, { now: NOW + 9000 });
    const a = (await call(db, "answers", {}, TESTER)).data.answers;
    assert.deepEqual(a.map((x) => x.question_id), [q2.data.question_id, q1.data.question_id]);
    assert.deepEqual(a[1], { question_id: q1.data.question_id, id: "r1-01-florist", question: "Should I press Send on the draft?", answer: "Never. Press Don't send.", answered: iso(NOW + 9000) });
    assert.deepEqual((await call(db, "answers", { since: iso(NOW + 5000) }, TESTER)).data.answers.map((x) => x.question_id), [q1.data.question_id]);
    assert.deepEqual((await call(db, "open_questions")).data.questions, []);
    // Answering again replaces the answer.
    await call(db, "answer", { question_id: q1.data.question_id, text: "Changed." }, { now: NOW + 20_000 });
    assert.equal((await call(db, "answers", {}, TESTER)).data.answers.at(-1).answer, "Changed.");
  });

  it("a question that is only a key is refused in plain words and never stored", async () => {
    const db = await published(openStore());
    for (const question of ["#2026-11-25.Zx9_kQ2-mP7wLr4TbN8vYc3HdJ6sFa1GeU5oIi0Kq-W", "  Zx9_kQ2-mP7wLr4TbN8vYc3HdJ6sFa1GeU5oIi0Kq-WabcdefgH ?"]) {
      const r = await call(db, "ask", { question }, TESTER);
      assert.equal(r.isError, true);
      assert.equal(r.data.error, "The question was only a link or key, which is never stored; say it in words.");
    }
    assert.equal(count(db, "persona_questions"), 0);
    const only = await call(db, "ask", { question: "?" }, TESTER);
    assert.equal(only.data.error, "The question needs words; say it in words.");
    const withKey = await call(db, "ask", { question: "Why did Zx9_kQ2-mP7wLr4TbN8vYc3HdJ6sFa1GeU5oIi0Kq-WabcdefgH fail?" }, TESTER);
    assert.equal(withKey.isError, false);
    assert.equal((await call(db, "open_questions")).data.questions[0].question, "Why did  fail?");
  });

  it("a secret path is stripped from a question", async () => {
    const db = await published(openStore());
    await call(db, "ask", { question: "Opened https://app.example.com/_in/tester/abc123 and it failed" }, { ...TESTER, secretPaths: ["/_in/tester"] });
    assert.ok(!dump(db).includes("abc123"));
  });

  it("checks the walk, the question and the caps", async () => {
    const db = await published(openStore());
    assert.equal((await call(db, "ask", { id: "r1-77-ghost", question: "?" }, TESTER)).isError, true);
    assert.equal((await call(db, "ask", { question: "" }, TESTER)).isError, true);
    assert.equal((await call(db, "ask", { question: "x".repeat(CAPS.textBytes + 1) }, TESTER)).isError, true);
    assert.equal((await call(db, "answer", { question_id: 999, text: "x" })).isError, true);
    const q = await call(db, "ask", { question: "ok?" }, TESTER);
    assert.equal((await call(db, "answer", { question_id: q.data.question_id, text: "x".repeat(CAPS.textBytes + 1) })).isError, true);
    assert.equal((await call(db, "answers", { since: "yesterday" }, TESTER)).isError, true);
    const ins = db.raw.prepare("INSERT INTO persona_questions (walk_id, text, asked_at) VALUES (NULL, 'q', ?)");
    for (let i = 1; i < CAPS.questions; i++) ins.run(iso(NOW));
    const full = await call(db, "ask", { question: "one more?" }, TESTER);
    assert.equal(full.isError, true);
    assert.match(full.data.error, /2000/);
  });

  it("the question cap counts only unanswered questions still kept, so answering one makes room", async () => {
    const db = await published(openStore());
    const ins = db.raw.prepare("INSERT INTO persona_questions (walk_id, text, asked_at) VALUES (NULL, 'q', ?)");
    for (let i = 0; i < CAPS.questions; i++) ins.run(iso(NOW));
    assert.equal((await call(db, "ask", { question: "one more?" }, TESTER)).isError, true);
    assert.equal((await call(db, "answer", { question_id: 1, text: "Answered." })).isError, false);
    assert.equal((await call(db, "ask", { question: "now?" }, TESTER)).isError, false);
    db.raw.prepare("UPDATE persona_questions SET asked_at = ? WHERE id <= 10").run(iso(NOW - (RETENTION_DAYS + 1) * DAY));
    assert.equal((await call(db, "ask", { question: "and now?" }, TESTER)).isError, false);
  });
});

describe("retention", () => {
  it("a write deletes every row older than 90 days; a read deletes nothing", async () => {
    const db = await published(openStore(), 1, ["r1-01-old"]);
    const old = iso(NOW - (RETENTION_DAYS + 1) * DAY);
    db.raw.prepare("UPDATE persona_briefs SET updated_at = ?").run(old);
    db.raw.prepare("UPDATE persona_rounds SET updated_at = ?").run(old);
    db.raw.prepare("INSERT INTO persona_walks (walk_id, started_at) VALUES ('r1-01-old', ?)").run(old);
    db.raw.prepare("INSERT INTO persona_reports (walk_id, version, body, status, problems, received_at) VALUES ('r1-01-old', 1, 'x', 'rejected', '[]', ?)").run(old);
    const q = db.raw.prepare("INSERT INTO persona_questions (walk_id, text, asked_at) VALUES (NULL, 'old', ?)").run(old);
    db.raw.prepare("INSERT INTO persona_answers (question_id, text, answered_at) VALUES (?, 'old', ?)").run(q.lastInsertRowid, old);
    db.raw.prepare("INSERT INTO persona_questions (walk_id, text, asked_at) VALUES (NULL, 'fresh', ?)").run(iso(NOW - (RETENTION_DAYS - 1) * DAY));
    await call(db, "open_questions");
    assert.equal(count(db, "persona_briefs"), 1);
    await call(db, "ask", { question: "new?" }, TESTER);
    for (const t of ["persona_briefs", "persona_rounds", "persona_walks", "persona_reports", "persona_answers"]) assert.equal(count(db, t), 0, t);
    assert.deepEqual(db.raw.prepare("SELECT text FROM persona_questions ORDER BY id").all().map((r) => r.text), ["fresh", "new?"]);
  });
});

describe("check_again_minutes", () => {
  it("is 1 while any walk of an open round is open", () => {
    assert.equal(checkAgainMinutes({ openWalks: 3, minutesSinceActivity: 5000 }), 1);
    assert.equal(checkAgainMinutes({ openWalks: 1, minutesSinceActivity: null }), 1);
  });

  it("backs off with the time since the last activity: 1, 5, 10, 15, 30 minutes, then 1, 2, 4, 8, 12, 24 hours", () => {
    const at = (m) => checkAgainMinutes({ openWalks: 0, minutesSinceActivity: m });
    const ladder = [[0, 1], [0.9, 1], [1, 5], [5.9, 5], [6, 10], [15.9, 10], [16, 15], [30.9, 15], [31, 30], [60.9, 30], [61, 60], [120.9, 60], [121, 120], [240.9, 120], [241, 240], [480.9, 240], [481, 480], [960.9, 480], [961, 720], [1680.9, 720], [1681, 1440], [100000, 1440]];
    for (const [m, want] of ladder) assert.equal(at(m), want, `${m} minutes since`);
    assert.equal(checkAgainMinutes({ openWalks: 0, minutesSinceActivity: null }), 1440);
  });

  it("next_walk and notes carry it: 1 with an open walk, and after the last report it backs off from that report's time", async () => {
    const db = await published(openStore(), 1, ["r1-01-a"]);
    assert.equal((await call(db, "next_walk", {}, TESTER)).data.check_again_minutes, 1);
    assert.equal((await call(db, "notes", {}, TESTER)).data.check_again_minutes, 1);
    await accept(db, "r1-01-a", NOW);
    const at = async (m) => (await call(db, "next_walk", {}, { ...TESTER, now: NOW + m * MIN })).data.check_again_minutes;
    assert.equal(await at(0), 1);
    assert.equal(await at(3), 5);
    assert.equal(await at(10), 10);
    assert.equal(await at(45), 30);
    assert.equal(await at(600), 480);
    assert.equal(await at(3 * 1440), 1440);
    assert.equal((await call(db, "notes", {}, { ...TESTER, now: NOW + 45 * MIN })).data.check_again_minutes, 30);
  });

  it("a note, a published round or a closed round is activity; a closed round's walks are not open", async () => {
    const db = openStore();
    assert.equal((await call(db, "notes", {}, TESTER)).data.check_again_minutes, 1440);
    await published(db, 1, ["r1-01-a"], NOW);
    await call(db, "close_round", { round: 1 }, { now: NOW + 2 * MIN });
    assert.equal((await call(db, "notes", {}, { ...TESTER, now: NOW + 3 * MIN })).data.check_again_minutes, 5);
    await call(db, "post_note", { text: "Hi" }, { now: NOW + 100 * MIN });
    assert.equal((await call(db, "notes", {}, { ...TESTER, now: NOW + 103 * MIN })).data.check_again_minutes, 5);
    assert.equal((await call(db, "notes", {}, { ...TESTER, now: NOW + 100 * MIN + 45 * MIN })).data.check_again_minutes, 30);
  });
});
