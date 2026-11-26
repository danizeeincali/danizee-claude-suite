/** Review round 3 of the tester connector (older environments, degraded networks): each test is one finding, proved. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openStore, NEEDS } from "../src/lib/persona/sqlite.js";
import { callTool, readExport, receiveBundle, NOT_SET_UP, BUNDLE_TTL_MS } from "../src/lib/persona/tools.js";
import { NOW, accept, call, published } from "./helpers/persona-fixtures.js";

const failing = (store, fail) => ({
  raw: store.raw,
  prepare(sql) {
    if (!fail(sql)) return store.prepare(sql);
    const boom = () => Promise.reject(new Error("D1_ERROR: injected"));
    const st = { bind: () => st, first: boom, all: boom, run: boom };
    return st;
  },
});

it("the sentence about Node names the version that really has node:sqlite without a flag", () => {
  assert.match(NEEDS, /Node 22\.13 or newer/);
  assert.match(NEEDS, /22\.5 to 22\.12 only with --experimental-sqlite/);
  assert.match(NEEDS, /better-sqlite3/);
});

it("the third export read still answers when tidying the spent code fails", async () => {
  const store = await published(openStore());
  await accept(store, "r1-01-florist");
  const { code } = (await call(store, "export_round", { round: 1 })).data;
  const db = failing(store, (sql) => sql.startsWith("DELETE FROM persona_exports WHERE code = ?"));
  for (let i = 0; i < 3; i++) assert.equal((await readExport(db, code, NOW)).reports.length, 1);
  assert.equal(await readExport(db, code, NOW), null);
});

describe("a bundle whose briefs never land", () => {
  it("holds its room for a minute, not an hour", async () => {
    const store = openStore();
    const db = failing(store, (sql) => sql.startsWith("INSERT INTO persona_bundle_briefs") || sql.startsWith("DELETE FROM persona_bundles WHERE code = ?"));
    await assert.rejects(receiveBundle(db, { round: 1, briefs: [{ id: "r1-01-a", brief: "b" }] }, NOW, "v1"));
    const left = store.raw.prepare("SELECT expires_at FROM persona_bundles").all();
    assert.equal(left.length, 1);
    assert.ok(Date.parse(left[0].expires_at) - NOW <= 60_000);
  });
  it("a bundle that landed whole is kept its hour and still publishes", async () => {
    const store = openStore();
    const r = await receiveBundle(store, { round: 1, briefs: [{ id: "r1-01-a", brief: "b" }] }, NOW, "v1");
    assert.equal(Date.parse(store.raw.prepare("SELECT expires_at FROM persona_bundles").get().expires_at) - NOW, BUNDLE_TTL_MS);
    assert.equal((await call(store, "publish_round", { round: 1, bundle: r.code }, { now: NOW + BUNDLE_TTL_MS - 1 })).isError, false);
  });
});

it("a store with no tables says the schema was never applied, not 'try again'", async () => {
  const store = openStore();
  for (const t of store.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'persona_%'").all()) store.raw.exec(`DROP TABLE ${t.name}`);
  const r = await callTool("notes", {}, { db: store, now: NOW, role: "tester" });
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).error, NOT_SET_UP);
  assert.doesNotMatch(NOT_SET_UP, /try again in a minute/i);
});
