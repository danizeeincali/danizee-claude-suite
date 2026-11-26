import { callTool } from "../../src/lib/persona/tools.js";
import { REPORT_TEMPLATE } from "../../src/lib/persona/report-shape.js";

export const NOW = Date.parse("2026-11-25T18:00:00Z");
export const MIN = 60_000;
export const DAY = 86_400_000;

/** Calls a tool as the coding thread (it may call every tool) unless `role` says otherwise; answers {data, isError}. */
export async function call(db, name, args = {}, { now = NOW, role = "coding", secretPaths } = {}) {
  const r = await callTool(name, args, { db, now, role, secretPaths });
  if (r.content.length !== 1 || r.content[0].type !== "text") throw new Error("an answer is one text part");
  return { data: JSON.parse(r.content[0].text), isError: r.isError === true };
}

/** A report that passes the checker. */
export const report = (id) => REPORT_TEMPLATE(id, "the tester");

/** Starts a walk and hands its report in (as the tester). */
export async function accept(db, id, now = NOW) {
  await call(db, "start_walk", { id }, { now, role: "tester" });
  return call(db, "submit_report", { id, report: report(id) }, { now, role: "tester" });
}

/** Publishes a round with a guide and one brief per id. */
export async function published(db, round = 1, ids = ["r1-01-florist", "r1-02-plumber", "r1-03-cafe"], now = NOW) {
  const r = await call(db, "publish_round", { round, guide: `Guide for round ${round}.`, briefs: ids.map((id) => ({ id, brief: `Brief for ${id}.` })) }, { now });
  if (r.isError) throw new Error(JSON.stringify(r.data));
  return db;
}

export const count = (store, table) => store.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
export const dump = (store) =>
  store.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((t) => JSON.stringify(store.raw.prepare(`SELECT * FROM ${t.name}`).all()))
    .join("\n");
