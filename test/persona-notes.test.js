import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/lib/persona/sqlite.js";
import { NOW, MIN, call, accept, published, dump } from "./helpers/persona-fixtures.js";

const TESTER = { role: "tester" };
const iso = (ms) => new Date(ms).toISOString();

describe("post_note", () => {
  it("stores a note and answers its id and time", async () => {
    const db = openStore();
    assert.deepEqual((await call(db, "post_note", { text: "  Round 3 is up.  ", round: 3 })).data, { id: 1, at: iso(NOW) });
    assert.equal((await call(db, "post_note", { text: "Second." })).data.id, 2);
    assert.deepEqual({ ...db.raw.prepare("SELECT round, text FROM persona_notes WHERE id = 1").get() }, { round: 3, text: "Round 3 is up." });
    assert.equal(db.raw.prepare("SELECT round FROM persona_notes WHERE id = 2").get().round, null);
  });

  it("refuses empty text, text over 2,000 characters, a bad round and unknown keys", async () => {
    const db = openStore();
    for (const args of [{ text: "   " }, { text: "" }, { text: "x".repeat(2001) }, { text: "ok", round: 0 }, { text: "ok", extra: 1 }, {}, { text: 5 }]) {
      assert.equal((await call(db, "post_note", args)).isError, true, JSON.stringify(args).slice(0, 40));
    }
    assert.equal((await call(db, "post_note", { text: "x".repeat(2000) })).isError, false);
    assert.equal((await call(db, "post_note", { text: `  ${"é".repeat(2000)}  ` })).isError, false);
  });

  it("stores nothing after a # of an address, strips secret paths, and refuses a note that was only a link or key", async () => {
    const db = openStore();
    await call(db, "post_note", { text: "Use https://app.example.com/from/quick-reply#k=abcdef0123 please" });
    assert.ok(!dump(db).includes("abcdef0123"));
    await call(db, "post_note", { text: "Open https://app.example.com/_in/tester/s3cr3t now" }, { secretPaths: ["/_in/tester"] });
    assert.ok(!dump(db).includes("s3cr3t"));
    const bare = await call(db, "post_note", { text: "#2026-11-26.abcdefghijklmnopqrstuvwxyzabcdefghijklmnopq" });
    assert.equal(bare.isError, true);
    assert.match(bare.data.error, /link or key/);
  });

  it("keeps at most 50 notes: the oldest drop", async () => {
    const db = openStore();
    for (let i = 1; i <= 53; i++) await call(db, "post_note", { text: `Note ${i}` });
    const ids = db.raw.prepare("SELECT id FROM persona_notes ORDER BY id").all().map((r) => r.id);
    assert.equal(ids.length, 50);
    assert.equal(ids[0], 4);
    assert.equal(ids[49], 53);
  });

  it("is the coding thread's: a tester cannot post or clear", async () => {
    const db = openStore();
    assert.equal((await call(db, "post_note", { text: "x" }, TESTER)).isError, true);
    assert.equal((await call(db, "clear_notes", {}, TESTER)).isError, true);
    assert.equal((await call(db, "notes", {}, TESTER)).isError, false);
  });
});

describe("notes", () => {
  async function board() {
    const db = openStore();
    for (let i = 1; i <= 3; i++) await call(db, "post_note", { text: `Note ${i}`, ...(i === 2 ? { round: 2 } : {}) }, { now: NOW + i * MIN });
    return db;
  }

  it("is the notes newest first with the open walks of every open round", async () => {
    const db = await board();
    await call(db, "publish_round", { round: 2, briefs: ["r2-01-a", "r2-02-b", "r2-03-c"].map((id) => ({ id, brief: "x" })) });
    await accept(db, "r2-01-a");
    const r = (await call(db, "notes", {}, { ...TESTER, now: NOW + 10 * MIN })).data;
    assert.equal(r.open_walks, 2);
    assert.deepEqual(r.open_rounds, [{ round: 2, open: 2 }]);
    assert.deepEqual(r.notes, [
      { id: 3, at: iso(NOW + 3 * MIN), round: null, text: "Note 3" },
      { id: 2, at: iso(NOW + 2 * MIN), round: 2, text: "Note 2" },
      { id: 1, at: iso(NOW + MIN), round: null, text: "Note 1" },
    ]);
  });

  it("open_walks counts all unclosed rounds together, open_rounds lists them newest first and leaves out done and closed rounds", async () => {
    const db = openStore();
    await published(db, 4, ["r4-01-a"]);
    await published(db, 5, ["r5-01-b", "r5-02-c"]);
    await published(db, 6, ["r6-01-d"]);
    await published(db, 7, ["r7-01-e"]);
    await accept(db, "r6-01-d");
    await call(db, "close_round", { round: 7 });
    const r = (await call(db, "notes", {}, TESTER)).data;
    assert.equal(r.open_walks, 3);
    assert.deepEqual(r.open_rounds, [{ round: 5, open: 2 }, { round: 4, open: 1 }]);
  });

  it("open_walks is 0 with no round, and a rejected report does not close a walk", async () => {
    const db = openStore();
    assert.deepEqual((await call(db, "notes", {}, TESTER)).data, { notes: [], open_walks: 0, open_rounds: [], check_again_minutes: 1440 });
    await call(db, "publish_round", { round: 1, briefs: [{ id: "r1-01-a", brief: "x" }] });
    await call(db, "start_walk", { id: "r1-01-a" });
    await call(db, "submit_report", { id: "r1-01-a", report: "no block" });
    assert.equal((await call(db, "notes", {}, TESTER)).data.open_walks, 1);
  });

  it("since is an id or a UTC time and returns only newer notes", async () => {
    const db = await board();
    const ids = async (since) => (await call(db, "notes", { since }, TESTER)).data.notes.map((n) => n.id);
    assert.deepEqual(await ids(2), [3]);
    assert.deepEqual(await ids("2"), [3]);
    assert.deepEqual(await ids(iso(NOW + MIN)), [3, 2]);
    assert.deepEqual(await ids(3), []);
    assert.equal((await call(db, "notes", { since: "yesterday" }, TESTER)).isError, true);
    assert.equal((await call(db, "notes", { since: -1 }, TESTER)).isError, true);
  });

  it("answers at most 20, newest first, and says how many more only when it cut; paging by the highest id gets the rest", async () => {
    const db = openStore();
    for (let i = 1; i <= 26; i++) await call(db, "post_note", { text: `Note ${i}` }, { now: NOW + i * MIN });
    const newest = (await call(db, "notes", {}, TESTER)).data;
    assert.deepEqual(newest.notes.map((n) => n.id), Array.from({ length: 20 }, (_, i) => 26 - i));
    assert.equal(newest.more, 6);
    const first = (await call(db, "notes", { since: 1 }, TESTER)).data;
    assert.deepEqual(first.notes.map((n) => n.id), Array.from({ length: 20 }, (_, i) => 21 - i));
    assert.equal(first.more, 5);
    const next = (await call(db, "notes", { since: first.notes[0].id }, TESTER)).data;
    assert.deepEqual(next.notes.map((n) => n.id), [26, 25, 24, 23, 22]);
    assert.equal("more" in next, false);
    for (let id = 1; id <= 6; id++) await call(db, "clear_notes", { id });
    assert.equal("more" in (await call(db, "notes", {}, TESTER)).data, false);
  });
});

describe("clear_notes", () => {
  it("removes one note or all and says how many", async () => {
    const db = openStore();
    for (let i = 0; i < 3; i++) await call(db, "post_note", { text: `N${i}` });
    assert.deepEqual((await call(db, "clear_notes", { id: 2 })).data, { cleared: 1 });
    assert.deepEqual((await call(db, "notes", {}, TESTER)).data.notes.map((n) => n.id), [3, 1]);
    assert.deepEqual((await call(db, "clear_notes", { id: 2 })).data, { cleared: 0 });
    assert.deepEqual((await call(db, "clear_notes", {})).data, { cleared: 2 });
    assert.deepEqual((await call(db, "notes", {}, TESTER)).data.notes, []);
    assert.equal((await call(db, "clear_notes", { id: 0 })).isError, true);
  });
});

describe("next_walk's notes_waiting", () => {
  it("is there only when there are notes", async () => {
    const db = openStore();
    await call(db, "publish_round", { round: 2, briefs: [{ id: "r2-01-a", brief: "Brief." }] });
    const plain = (await call(db, "next_walk", {}, TESTER)).data;
    assert.equal("notes_waiting" in plain, false);
    assert.deepEqual(Object.keys(plain), ["id", "round", "brief", "start", "check_again_minutes"]);
    await call(db, "post_note", { text: "One." });
    await call(db, "post_note", { text: "Two." });
    assert.deepEqual((await call(db, "next_walk", {}, TESTER)).data, { ...plain, notes_waiting: 2 });
    await call(db, "clear_notes");
    assert.equal("notes_waiting" in (await call(db, "next_walk", {}, TESTER)).data, false);
    const empty = openStore();
    await call(empty, "post_note", { text: "Only a note." });
    assert.deepEqual((await call(empty, "next_walk", {}, TESTER)).data, { done: true, notes_waiting: 1, check_again_minutes: 1 });
  });
});

describe("the guide and the tool words tell the tester to read notes first", () => {
  it("guide and notes descriptions say so", async () => {
    const { toolsFor } = await import("../src/lib/persona/tools.js");
    const tools = toolsFor("tester");
    assert.match(tools.find((t) => t.name === "guide").description, /notes first/i);
    assert.match(tools.find((t) => t.name === "notes").description, /first on every check/i);
  });
});
