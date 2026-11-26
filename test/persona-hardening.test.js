import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openStore } from "../src/lib/persona/sqlite.js";
import { receiveBundle, CAPS, MAX_PENDING_BUNDLES } from "../src/lib/persona/tools.js";
import { NOW, MIN, call, count, dump } from "./helpers/persona-fixtures.js";

const TESTER = { role: "tester" };
const bundle = () => ({ round: 2, briefs: [{ id: "r2-01-baker", brief: "Baker." }, { id: "r2-02-chef", brief: "Chef." }] });
const post = (db, visitor = "", body = bundle(), opts) => receiveBundle(db, body, NOW, visitor, opts);
const at = () => new Date(NOW + 3_000_000).toISOString();
const CAP_BRIEF = 60 * 1024;

describe("pending bundles are bounded per visitor and in bytes", () => {
  it("keeps two per visitor: a third replaces that visitor's oldest, others are untouched", async () => {
    const db = openStore();
    const other = (await post(db, "v9")).code;
    const first = (await post(db, "v1")).code;
    const second = (await post(db, "v1")).code;
    const third = (await post(db, "v1")).code;
    const left = db.raw.prepare("SELECT code FROM persona_bundles").all().map((r) => r.code).sort();
    assert.deepEqual(left, [other, second, third].sort());
    assert.equal(count(db, "persona_bundle_briefs"), 6);
    assert.equal((await call(db, "publish_round", { round: 2, bundle: first })).isError, true);
    assert.equal((await call(db, "publish_round", { round: 2, bundle: second })).isError, false);
  });

  it("a third post refused as full leaves that visitor's two earlier bundles publishable", async () => {
    const db = openStore();
    const first = (await post(db, "v1")).code;
    const second = (await post(db, "v1")).code;
    for (let i = 0; i < 18; i++) db.raw.prepare("INSERT INTO persona_bundles (code, round, guide, created_at, expires_at, visitor, bytes) VALUES (?, 2, NULL, ?, ?, ?, 10)").run(`other${String(i).padStart(5, "x")}`, at(), at(), `v${i}`);
    assert.equal((await post(db, "v1")).status, 503);
    assert.equal((await call(db, "publish_round", { round: 2, bundle: first })).isError, false);
    assert.equal((await call(db, "publish_round", { round: 2, bundle: second })).isError, false);
  });

  it("a bundle's guide is stripped of anything after a # and of secret paths on receipt; a brief keeps its link by design", async () => {
    const db = openStore();
    const body = { round: 2, guide: "See https://x.test/a#secret-bit for more and https://x.test/_in/t/zz99 too.", briefs: [{ id: "r2-01-a", brief: "Brief https://x.test/b#keep" }] };
    const { code } = await post(db, "", body, { secretPaths: ["/_in/t"] });
    assert.ok(!dump(db).includes("#secret-bit"));
    assert.ok(!dump(db).includes("zz99"));
    await call(db, "publish_round", { round: 2, bundle: code });
    assert.ok(!JSON.stringify((await call(db, "guide", {}, TESTER)).data).includes("secret-bit"));
    assert.match((await call(db, "get_brief", { id: "r2-01-a" }, TESTER)).data.brief, /#keep/);
  });

  it("stores the visitor hash it is given and the size of the content, nothing else about the poster", async () => {
    const db = openStore();
    await post(db, "0123456789abcdef");
    const row = db.raw.prepare("SELECT visitor, bytes FROM persona_bundles").get();
    assert.equal(row.visitor, "0123456789abcdef");
    assert.equal(row.bytes, 11);
  });

  it("refuses one bundle over 4 MB, saying a bigger round goes by publish_round's briefs", async () => {
    const db = openStore();
    const big = { round: 2, briefs: Array.from({ length: 75 }, (_, i) => ({ id: `r2-${String(i).padStart(2, "0")}-big`, brief: "x".repeat(CAP_BRIEF) })) };
    const res = await post(db, "", big);
    assert.equal(res.status, 413);
    assert.match(res.error, /4 MB/);
    assert.match(res.error, /publish_round/);
    assert.equal(count(db, "persona_bundles"), 0);
    // A real round (30 briefs of about 6 KB) fits with wide margin.
    const real = { round: 2, briefs: Array.from({ length: 30 }, (_, i) => ({ id: `r2-${String(i).padStart(2, "0")}-walk`, brief: "x".repeat(6 * 1024) })) };
    assert.equal((await post(db, "", real)).status, 201);
  });

  it("holds every pending bundle together to 32 MB; an expired bundle's bytes no longer count", async () => {
    const db = openStore();
    for (let i = 0; i < 8; i++) db.raw.prepare("INSERT INTO persona_bundles (code, round, guide, created_at, expires_at, visitor, bytes) VALUES (?, 2, NULL, ?, ?, ?, ?)").run(`bndl${String(i).padStart(6, "x")}`, at(), at(), `v${i}`, 4 * 1024 * 1024);
    assert.equal((await post(db, "v-new")).status, 503);
    db.raw.prepare("UPDATE persona_bundles SET expires_at = ? WHERE code = (SELECT MIN(code) FROM persona_bundles)").run(new Date(NOW - 1000).toISOString());
    assert.equal((await post(db, "v-new")).status, 201);
  });
});

describe("the caps hold in the statement that inserts, not in a check before it", () => {
  /** A store whose bare COUNT(*) of one table lies and says 0, as a stale read would. */
  function lying(db, table) {
    return {
      prepare: (sql) => {
        const st = db.prepare(sql);
        return new RegExp(`SELECT COUNT\\(\\*\\) AS n FROM ${table}$`).test(sql) ? { ...st, bind: () => ({ first: async () => ({ n: 0 }) }), first: async () => ({ n: 0 }) } : st;
      },
      batch: (s) => db.batch(s),
    };
  }

  it("20 pending bundles hold even when the count a request read was stale", async () => {
    const db = openStore();
    for (let i = 0; i < MAX_PENDING_BUNDLES; i++) db.raw.prepare("INSERT INTO persona_bundles (code, round, guide, created_at, expires_at, visitor, bytes) VALUES (?, 2, NULL, ?, ?, ?, 10)").run(`bundle${String(i).padStart(4, "2")}`, at(), at(), `v${i}`);
    assert.equal((await receiveBundle(lying(db, "persona_bundles"), bundle(), NOW, "v-new")).status, 503);
    assert.equal(count(db, "persona_bundles"), 20);
    assert.equal(count(db, "persona_bundle_briefs"), 0);
  });

  it("20 live export codes hold even when the count a request read was stale", async () => {
    const db = openStore();
    await call(db, "publish_round", { round: 2, briefs: [{ id: "r2-01-baker", brief: "Baker." }] });
    for (let i = 0; i < 20; i++) db.raw.prepare("INSERT INTO persona_exports (code, round, reads, created_at, expires_at) VALUES (?, 2, 0, ?, ?)").run(`export${String(i).padStart(4, "2")}`, at(), at());
    const r = await call(lying(db, "persona_exports"), "export_round", { round: 2 });
    assert.equal(r.isError, true);
    assert.equal(count(db, "persona_exports"), 20);
  });
});

describe("what a run of the tools never does", () => {
  it("a refusal never carries a stack, a path or SQL", async () => {
    const db = openStore();
    db.close();
    const r = await call(db, "notes", {}, TESTER);
    assert.equal(r.isError, true);
    assert.doesNotMatch(JSON.stringify(r.data), /SELECT|sqlite|\/home|at /i);
  });

  it("a failed batch loses nothing that was there and leaves the store usable", async () => {
    const db = openStore();
    await call(db, "publish_round", { round: 1, briefs: [{ id: "r1-01-a", brief: "x" }] });
    const real = db.prepare.bind(db);
    let boom = true;
    const flaky = {
      prepare: (sql) => {
        const st = real(sql);
        return /INSERT INTO persona_briefs/.test(sql) && boom ? { bind: () => ({ run: async () => { throw new Error("disk"); }, runSync: () => { throw new Error("disk"); } }) } : st;
      },
      batch: (s) => db.batch(s),
    };
    const r = await call(flaky, "publish_round", { round: 1, briefs: [{ id: "r1-01-a", brief: "changed" }, { id: "r1-02-b", brief: "new" }] });
    assert.equal(r.isError, true);
    boom = false;
    assert.equal((await call(db, "get_brief", { id: "r1-01-a" })).data.brief, "x");
    assert.equal((await call(db, "get_brief", { id: "r1-02-b" })).isError, true);
  });
});

describe("the library holds to its own rules", () => {
  const dir = new URL("../src/lib/persona/", import.meta.url);
  const read = (f) => readFileSync(new URL(f, dir), "utf8");

  it("tools.js needs nothing from Node, so it runs unchanged in a Worker", () => {
    assert.doesNotMatch(read("tools.js"), /(?:from|import\()\s*["']node:|\brequire\(|\bprocess\.|\bBuffer\b/);
  });

  it("tools.js, sqlite.js and schema.sql name no product", () => {
    for (const f of ["tools.js", "sqlite.js", "schema.sql"]) assert.doesNotMatch(read(f), /ezi|bos\b|\bbos|duet|dani/i, f);
  });

  it("the cap on briefs and reports is the published one", () => {
    assert.deepEqual(CAPS, { briefBytes: 65536, reportBytes: 262144, textBytes: 4096, rowsPerRound: 500, versionsPerWalk: 30, questions: 2000, problemsShown: 60 });
  });
});
