/**
 * A D1-like store over a local SQLite file (Node only): `prepare(sql).bind(...).first()/all()/run()` and `batch([...])`
 * as one transaction that rolls back on a throw, the same interface the tools use over a Cloudflare D1 database.
 * Uses `node:sqlite` (Node 22.13 or newer; 22.5 to 22.12 only with --experimental-sqlite) when it can be imported, else `better-sqlite3` when it is installed.
 */
import { SCHEMA } from "./tools.js";

/** Imports `node:sqlite`, saying nothing about its experimental status (and leaving every other warning alone). */
async function nodeSqlite() {
  const emit = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
    const message = typeof warning === "string" ? warning : (warning?.message ?? "");
    if ((type === "ExperimentalWarning" || warning?.name === "ExperimentalWarning") && /sqlite/i.test(message)) return;
    return emit.call(process, warning, ...rest);
  };
  try {
    return (await import("node:sqlite")).DatabaseSync;
  } catch {
    return null;
  } finally {
    process.emitWarning = emit;
  }
}

async function betterSqlite() {
  try {
    return (await import("better-sqlite3")).default;
  } catch {
    return null;
  }
}

const Driver = (await nodeSqlite()) ?? (await betterSqlite());
export const NEEDS = "The local tester store needs Node 22.13 or newer (it uses node:sqlite; Node 22.5 to 22.12 only with --experimental-sqlite), or run npm i better-sqlite3.";

/** A plain object for a row (node:sqlite hands back objects with no prototype). */
const plain = (row) => (row === undefined || row === null ? null : { ...row });
/** SQLite takes no undefined and no boolean. */
const value = (v) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v);

/**
 * Opens (and creates) the store and applies the schema.
 * @param {string} [file] A file path, or ":memory:" for a store that lives as long as the process.
 * @returns {{ prepare: (sql: string) => object, batch: (statements: object[]) => Promise<object[]>, close: () => void, raw: object }}
 */
export function openStore(file = ":memory:") {
  if (!Driver) throw new Error(NEEDS);
  const raw = new Driver(file);
  raw.exec(SCHEMA);
  const store = {
    raw,
    prepare(sql) {
      // Compiled on first use, so a bad statement fails where it runs (as a rejected promise), like D1's.
      let compiled = null;
      const st = { run: (...a) => (compiled ??= raw.prepare(sql)).run(...a), get: (...a) => (compiled ??= raw.prepare(sql)).get(...a), all: (...a) => (compiled ??= raw.prepare(sql)).all(...a) };
      let args = [];
      const s = {
        bind(...v) {
          args = v.map(value);
          return s;
        },
        runSync() {
          return { meta: { changes: Number(st.run(...args).changes) } };
        },
        async run() {
          return s.runSync();
        },
        async first() {
          return plain(st.get(...args));
        },
        async all() {
          return { results: st.all(...args).map(plain) };
        },
      };
      return s;
    },
    // Everything below runs without a gap (the driver is synchronous), so no other statement lands inside the transaction.
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const out = statements.map((st) => st.runSync());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    close() {
      raw.close();
    },
  };
  return store;
}
