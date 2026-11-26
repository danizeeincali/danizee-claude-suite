import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/lib/persona/sqlite.js";
import { receiveBundle, readExport, CAPS, BUNDLE_TTL_MS, CODE_RE } from "../src/lib/persona/tools.js";
import { NOW, MIN, call, accept, report, count, dump } from "./helpers/persona-fixtures.js";

const TESTER = { role: "tester" };
const iso = (ms) => new Date(ms).toISOString();
const bundle = () => ({ round: 2, guide: "Bundle guide.", briefs: [{ id: "r2-01-baker", brief: "Baker." }, { id: "r2-02-chef", brief: "Chef." }] });
const post = (db, body = bundle(), visitor = "", now = NOW) => receiveBundle(db, body, now, visitor);
const pending = async (db) => (await post(db)).code;

describe("receiveBundle", () => {
  it("keeps the bundle pending under a code and puts nothing in persona_briefs; no tool serves it", async () => {
    const db = openStore();
    const res = await post(db);
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res), ["status", "code"]);
    assert.match(res.code, CODE_RE);
    assert.equal(count(db, "persona_briefs"), 0);
    assert.equal(count(db, "persona_bundle_briefs"), 2);
    assert.equal((await call(db, "next_walk", {}, TESTER)).data.done, true);
    assert.equal((await call(db, "get_brief", { id: "r2-01-baker" }, TESTER)).isError, true);
    assert.equal((await call(db, "guide", {}, TESTER)).data.round, null);
  });

  it("checks what publish_round checks: ids, round prefix, duplicates, sizes, counts, unknown keys", async () => {
    const db = openStore();
    const bad = async (b) => (await post(db, b)).status;
    assert.equal(await bad({ round: 2, briefs: [{ id: "r3-01-x", brief: "x" }] }), 400);
    assert.equal(await bad({ round: 2, briefs: [{ id: "R2-01-Caps", brief: "x" }] }), 400);
    assert.equal(await bad({ round: 2, briefs: [{ id: "r2-01-a", brief: "x" }, { id: "r2-01-a", brief: "y" }] }), 400);
    assert.equal(await bad({ round: 2, briefs: [] }), 400);
    assert.equal(await bad({ round: 0, briefs: [{ id: "r0-01-a", brief: "x" }] }), 400);
    assert.equal(await bad({ round: 2, briefs: [{ id: "r2-01-a", brief: "x".repeat(CAPS.briefBytes + 1) }] }), 400);
    assert.equal(await bad({ round: 2, guide: "x".repeat(CAPS.briefBytes + 1), briefs: [{ id: "r2-01-a", brief: "x" }] }), 400);
    assert.equal(await bad({ round: 2, extra: 1, briefs: [{ id: "r2-01-a", brief: "x" }] }), 400);
    assert.equal(await bad({ round: 2, briefs: Array.from({ length: CAPS.rowsPerRound + 1 }, (_, i) => ({ id: `r2-${i}`, brief: "x" })) }), 400);
    assert.equal(await bad("not json"), 400);
    assert.equal(await bad([]), 400);
    assert.equal(await bad({ round: 2, briefs: [{ id: "r2-01-a", brief: "x".repeat(CAPS.briefBytes) }] }), 201);
    assert.equal(count(db, "persona_bundles"), 1);
  });

  it("expires an hour after it was posted, and an expired one is swept by the next post", async () => {
    const db = openStore();
    await post(db);
    const row = db.raw.prepare("SELECT created_at, expires_at FROM persona_bundles").get();
    assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), BUNDLE_TTL_MS);
    await post(db, bundle(), "other", NOW + BUNDLE_TTL_MS + 1);
    assert.equal(count(db, "persona_bundles"), 1);
    assert.equal(count(db, "persona_bundle_briefs"), 2);
  });
});

describe("publish_round with a bundle", () => {
  it("publishes the pending bundle exactly as briefs would be, with its guide, then deletes it", async () => {
    const db = openStore();
    const code = await pending(db);
    const r = await call(db, "publish_round", { round: 2, bundle: code });
    assert.deepEqual(r.data, { round: 2, briefs: 2, dropped: [] });
    assert.equal((await call(db, "next_walk", {}, TESTER)).data.id, "r2-01-baker");
    assert.equal((await call(db, "guide", {}, TESTER)).data.guide, "Bundle guide.");
    assert.equal(count(db, "persona_bundles"), 0);
    assert.equal(count(db, "persona_bundle_briefs"), 0);
    assert.equal((await call(db, "publish_round", { round: 2, bundle: code })).isError, true);
  });

  it("a bundle republished over a closed round opens it", async () => {
    const db = openStore();
    await call(db, "publish_round", { round: 2, briefs: [{ id: "r2-01-baker", brief: "x" }] });
    await call(db, "close_round", { round: 2 });
    await call(db, "publish_round", { round: 2, bundle: await pending(db) });
    assert.equal((await call(db, "next_walk", {}, TESTER)).data.id, "r2-01-baker");
  });

  it("takes exactly one of briefs and bundle, and the round must match", async () => {
    const db = openStore();
    const code = await pending(db);
    const both = await call(db, "publish_round", { round: 2, bundle: code, briefs: [{ id: "r2-01-a", brief: "x" }] });
    assert.match(both.data.error, /not both/);
    assert.match((await call(db, "publish_round", { round: 2, bundle: code, guide: "g" })).data.error, /own guide/);
    assert.match((await call(db, "publish_round", { round: 3, bundle: code })).data.error, /round 2, not round 3/);
    assert.match((await call(db, "publish_round", { round: 2 })).data.error, /briefs.*or a bundle/);
    assert.equal(count(db, "persona_bundles"), 1);
  });

  it("an unknown, malformed or expired code is a plain refusal", async () => {
    const db = openStore();
    for (const bundleCode of ["abcdefghij", "short", "ABCDEFGHIJ", 5]) assert.equal((await call(db, "publish_round", { round: 2, bundle: bundleCode })).isError, true);
    assert.match((await call(db, "publish_round", { round: 2, bundle: "abcdefghjk" })).data.error, /No pending bundle/);
    const code = await pending(db);
    const late = await call(db, "publish_round", { round: 2, bundle: code }, { now: NOW + BUNDLE_TTL_MS + 1 });
    assert.match(late.data.error, /No pending bundle/);
  });

  it("keeps the dropped-walk rule: a bundle that would drop an accepted walk is refused and stays pending", async () => {
    const db = openStore();
    await call(db, "publish_round", { round: 2, briefs: [{ id: "r2-09-kept", brief: "x" }] });
    await accept(db, "r2-09-kept");
    const code = await pending(db);
    const r = await call(db, "publish_round", { round: 2, bundle: code });
    assert.equal(r.isError, true);
    assert.match(r.data.error, /r2-09-kept/);
    assert.equal(count(db, "persona_bundles"), 1);
  });
});

describe("export_round and readExport", () => {
  async function exported() {
    const db = openStore();
    await call(db, "publish_round", { round: 2, briefs: [{ id: "r2-01-baker", brief: "Baker." }, { id: "r2-02-chef", brief: "Chef." }] });
    return db;
  }

  it("answers a code and when it expires (15 minutes); a round with no briefs is refused; the tester may not", async () => {
    const db = await exported();
    const r = (await call(db, "export_round", { round: 2 })).data;
    assert.match(r.code, CODE_RE);
    assert.equal(r.expires, iso(NOW + 15 * MIN));
    assert.equal((await call(db, "export_round", { round: 9 })).isError, true);
    assert.equal((await call(db, "export_round", { round: 2 }, TESTER)).isError, true);
  });

  it("serves the latest accepted version per walk, else the latest, with the clock; a walk with no report is left out", async () => {
    const db = await exported();
    await call(db, "start_walk", { id: "r2-01-baker" }, { now: NOW });
    await call(db, "submit_report", { id: "r2-01-baker", report: report("r2-01-baker") }, { now: NOW + 12 * MIN });
    await call(db, "submit_report", { id: "r2-01-baker", report: "broken" }, { now: NOW + 13 * MIN });
    const { code } = (await call(db, "export_round", { round: 2 })).data;
    const out = await readExport(db, code, NOW + 14 * MIN);
    assert.equal(out.round, 2);
    assert.equal(out.reports.length, 1);
    assert.deepEqual({ ...out.reports[0], body: undefined }, { id: "r2-01-baker", status: "accepted", version: 1, started: iso(NOW), received: iso(NOW + 12 * MIN), clock_minutes: 12, body: undefined });
    assert.match(out.reports[0].body, /"id": "r2-01-baker"/);
    // A walk with only rejected reports is served with its latest.
    await call(db, "start_walk", { id: "r2-02-chef" }, { now: NOW });
    await call(db, "submit_report", { id: "r2-02-chef", report: "broken" }, { now: NOW + MIN });
    const again = await readExport(db, (await call(db, "export_round", { round: 2 })).data.code, NOW + 14 * MIN);
    assert.deepEqual(again.reports.map((r) => [r.id, r.status]), [["r2-01-baker", "accepted"], ["r2-02-chef", "rejected"]]);
  });

  it("dies after 3 reads, or 15 minutes, and a wrong or malformed code is null and spends nothing", async () => {
    const db = await exported();
    const { code } = (await call(db, "export_round", { round: 2 })).data;
    for (let i = 0; i < 3; i++) assert.notEqual(await readExport(db, code, NOW + MIN), null);
    assert.equal(await readExport(db, code, NOW + MIN), null);
    assert.equal(count(db, "persona_exports"), 0);
    const second = (await call(db, "export_round", { round: 2 })).data.code;
    assert.equal(await readExport(db, second, NOW + 15 * MIN + 1), null);
    assert.equal(db.raw.prepare("SELECT reads FROM persona_exports WHERE code = ?").get(second).reads, 0);
    for (const bad of ["", "short", "abcdefghjk", "ABCDEFGHJK", undefined, 5]) assert.equal(await readExport(db, bad, NOW), null);
  });

  it("five reads at once serve exactly three, and the code is gone", async () => {
    const db = await exported();
    const { code } = (await call(db, "export_round", { round: 2 })).data;
    const got = await Promise.all(Array.from({ length: 5 }, () => readExport(db, code, NOW + MIN)));
    assert.equal(got.filter((g) => g !== null).length, 3);
    assert.equal(count(db, "persona_exports"), 0);
  });

  it("a report stripped of an address's # stays stripped in the export", async () => {
    const db = await exported();
    await call(db, "start_walk", { id: "r2-01-baker" });
    await call(db, "submit_report", { id: "r2-01-baker", report: `${report("r2-01-baker")}\nSee https://x.example.com/p#hidden-part-here.` });
    const out = await readExport(db, (await call(db, "export_round", { round: 2 })).data.code, NOW);
    assert.ok(!JSON.stringify(out).includes("hidden-part"));
    assert.ok(!dump(db).includes("hidden-part"));
  });
});
