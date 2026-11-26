/** Review round 2 of the tester connector (failure conditions): each test is one finding, proved. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/lib/persona/sqlite.js";
import { callTool, readExport, receiveBundle } from "../src/lib/persona/tools.js";
import { NOW, accept, call, published, report } from "./helpers/persona-fixtures.js";

/** The store with every prepared statement counted, and a statement `fail` says yes to rejecting when it runs. */
function watched(store) {
  const w = { n: 0, fail: null, raw: store.raw };
  w.prepare = (sql) => {
    w.n++;
    if (w.fail?.(sql)) {
      const boom = () => Promise.reject(new Error("D1_ERROR: injected"));
      const st = { bind: () => st, first: boom, all: boom, run: boom };
      return st;
    }
    return store.prepare(sql);
  };
  return w;
}
const ids = (n) => Array.from({ length: n }, (_, i) => `r1-${String(i + 1).padStart(3, "0")}-walk`);

describe("a round's reports are read in a fixed number of queries", () => {
  it("list_reports and the export use the same few queries for 3 walks and for 120", async () => {
    const counts = [];
    for (const n of [3, 120]) {
      const store = await published(openStore(), 1, ids(n));
      for (const id of ids(n).slice(0, 2)) await accept(store, id);
      await call(store, "start_walk", { id: ids(n)[2] }, { role: "tester" });
      const { code } = (await call(store, "export_round", { round: 1 })).data;
      const w = watched(store);
      const list = JSON.parse((await callTool("list_reports", { round: 1 }, { db: w, now: NOW, role: "coding" })).content[0].text);
      const listQueries = w.n;
      assert.equal(list.walks.length, n);
      assert.deepEqual(list.walks.slice(0, 4).map((x) => x.status), n === 3 ? ["accepted", "accepted", "none"] : ["accepted", "accepted", "none", "none"]);
      assert.equal(list.walks[2].started, new Date(NOW).toISOString());
      assert.equal(list.walks[0].clock_minutes, 0);
      w.n = 0;
      const out = await readExport(w, code, NOW);
      assert.equal(out.reports.length, 2);
      assert.equal(out.reports[0].body, report(ids(n)[0]));
      counts.push([listQueries, w.n]);
    }
    assert.deepEqual(counts[0], counts[1]);
    assert.ok(counts[1][0] <= 12 && counts[1][1] <= 6, JSON.stringify(counts));
  });

  it("a rejected latest version does not hide an earlier accepted one", async () => {
    const store = await published(openStore());
    await accept(store, "r1-01-florist");
    await call(store, "submit_report", { id: "r1-01-florist", report: "no block" }, { role: "tester" });
    const list = (await call(store, "list_reports", { round: 1 })).data;
    assert.deepEqual([list.walks[0].status, list.walks[0].version], ["accepted", 1]);
  });
});

describe("two hand-ins of one walk at once", () => {
  it("both are stored, as versions 1 and 2, and neither is told the store is unreadable", async () => {
    const store = await published(openStore());
    const id = "r1-01-florist";
    await call(store, "start_walk", { id }, { role: "tester" });
    const both = await Promise.all([1, 2].map(() => call(store, "submit_report", { id, report: report(id) }, { role: "tester" })));
    assert.deepEqual(both.map((r) => r.isError), [false, false]);
    assert.deepEqual(both.map((r) => r.data.version).sort(), [1, 2]);
    assert.equal(store.raw.prepare("SELECT COUNT(*) AS n FROM persona_reports").get().n, 2);
  });
});

describe("a bundle whose prune fails", () => {
  it("still answers its code", async () => {
    const w = watched(openStore());
    w.fail = (sql) => /^DELETE FROM persona_bundle(_briefs|s) WHERE code IN \(SELECT code FROM persona_bundles WHERE visitor/.test(sql);
    const r = await receiveBundle(w, { round: 1, briefs: [{ id: "r1-01-a", brief: "b" }] }, NOW, "v1");
    assert.equal(r.status, 201);
    assert.match(r.code, /^[a-z2-9]{10}$/);
  });
});

describe("an export read that fails", () => {
  it("spends no read: the code still opens three times afterwards", async () => {
    const store = await published(openStore());
    await accept(store, "r1-01-florist");
    const { code } = (await call(store, "export_round", { round: 1 })).data;
    const w = watched(store);
    w.fail = (sql) => /FROM persona_briefs b LEFT JOIN/.test(sql);
    await assert.rejects(readExport(w, code, NOW));
    w.fail = null;
    for (let i = 0; i < 3; i++) assert.equal((await readExport(w, code, NOW)).reports.length, 1);
    assert.equal(await readExport(w, code, NOW), null);
  });
});
