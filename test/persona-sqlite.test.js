import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openStore } from "../src/lib/persona/sqlite.js";
import { SCHEMA, reserveHour, CODE_RE, newCode } from "../src/lib/persona/tools.js";
import { NOW, count } from "./helpers/persona-fixtures.js";

const HERE = new URL("../src/lib/persona/", import.meta.url);

test("schema.sql holds exactly the text of SCHEMA", () => {
  assert.equal(readFileSync(new URL("schema.sql", HERE), "utf8"), SCHEMA);
});

test("every statement of SCHEMA is safe to apply twice, and the tables are all prefixed persona_", () => {
  const db = openStore();
  db.raw.exec(SCHEMA);
  db.raw.exec(SCHEMA);
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
  assert.deepEqual(tables, ["persona_answers", "persona_briefs", "persona_bundle_briefs", "persona_bundles", "persona_exports", "persona_notes", "persona_questions", "persona_rate", "persona_reports", "persona_rounds", "persona_walks"]);
  assert.ok(!/CREATE (TABLE|INDEX)(?! IF NOT EXISTS)/.test(SCHEMA));
  // Opening a file twice applies it twice.
  const dir = mkdtempSync(path.join(tmpdir(), "persona-sqlite-"));
  try {
    const file = path.join(dir, "p.db");
    const a = openStore(file);
    a.raw.prepare("INSERT INTO persona_notes (text, created_at) VALUES ('kept', 'x')").run();
    a.close();
    const b = openStore(file);
    assert.equal(count(b, "persona_notes"), 1);
    b.close();
    assert.deepEqual(readdirSync(dir), ["p.db"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepare binds, first answers a plain object or null, all answers {results}, run answers {meta: {changes}}", async () => {
  const db = openStore();
  const ins = await db.prepare("INSERT INTO persona_notes (round, text, created_at) VALUES (?, ?, ?)").bind(null, "one", "t").run();
  assert.deepEqual(ins, { meta: { changes: 1 } });
  const row = await db.prepare("SELECT round, text FROM persona_notes WHERE id = ?").bind(1).first();
  assert.deepEqual(row, { round: null, text: "one" });
  assert.equal(await db.prepare("SELECT 1 FROM persona_notes WHERE id = ?").bind(9).first(), null);
  assert.deepEqual((await db.prepare("SELECT text FROM persona_notes").all()).results, [{ text: "one" }]);
  assert.deepEqual(await db.prepare("DELETE FROM persona_notes WHERE id = 99").run(), { meta: { changes: 0 } });
  const returning = await db.prepare("INSERT INTO persona_notes (text, created_at) VALUES (?, ?) RETURNING id").bind("two", "t").first();
  assert.deepEqual(returning, { id: 2 });
  db.close();
});

test("batch is one transaction: a throw rolls every statement back", async () => {
  const db = openStore();
  const add = (t) => db.prepare("INSERT INTO persona_notes (text, created_at) VALUES (?, 't')").bind(t);
  await db.batch([add("a"), add("b")]);
  assert.equal(count(db, "persona_notes"), 2);
  await assert.rejects(db.batch([add("c"), db.prepare("INSERT INTO persona_notes (text, created_at) VALUES (NULL, 't')")]));
  assert.equal(count(db, "persona_notes"), 2);
  // The store still works after a rollback.
  await db.batch([add("d")]);
  assert.equal(count(db, "persona_notes"), 3);
  db.close();
});

test("a failing statement is an error, never silently dropped", async () => {
  const db = openStore();
  await assert.rejects(db.prepare("INSERT INTO persona_nothing VALUES (1)").run());
  await assert.rejects(db.prepare("SELEKT").first());
  db.close();
});

test("reserveHour counts per key per UTC hour, refuses at the limit, and deletes earlier hours", async () => {
  const db = openStore();
  for (let i = 0; i < 3; i++) assert.equal(await reserveHour(db, "a", 3, NOW + i), true);
  assert.equal(await reserveHour(db, "a", 3, NOW), false);
  assert.equal(await reserveHour(db, "b", 3, NOW), true, "another key has its own count");
  assert.equal((await db.prepare("SELECT n FROM persona_rate WHERE key = 'a'").first()).n, 3, "a refusal is not counted");
  // 17:59 is the same hour as 18:00? No: 18:00:00Z starts a new hour; the earlier hour's rows are deleted by the write.
  assert.equal(await reserveHour(db, "a", 3, NOW - 1), true, "the hour before has its own count");
  assert.equal(await reserveHour(db, "a", 3, NOW + 60 * 60_000), true);
  assert.deepEqual((await db.prepare("SELECT DISTINCT hour FROM persona_rate").all()).results, [{ hour: "2026-11-25T19" }]);
  assert.equal(await reserveHour(db, "z", 0, NOW + 60 * 60_000), false, "a limit of 0 allows nothing");
  db.close();
});

test("reserveHour: requests running together cannot pass the limit", async () => {
  const db = openStore();
  const got = await Promise.all(Array.from({ length: 10 }, () => reserveHour(db, "k", 4, NOW)));
  assert.equal(got.filter(Boolean).length, 4);
  db.close();
});

test("newCode is ten characters of the code alphabet and codes differ", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = newCode();
    assert.match(c, CODE_RE);
    seen.add(c);
  }
  assert.equal(seen.size, 200);
  // Bytes past the last whole alphabet are drawn again.
  const bytes = [255, 254, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  let i = 0;
  assert.equal(newCode((b) => b.forEach((_, k) => (b[k] = bytes[(i++) % bytes.length]))).length, 10);
});
