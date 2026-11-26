/**
 * The coding thread's side of the connector: `connect` speaks JSON-RPC to `<url>/mcp` with a Bearer key, `publish`
 * sends a round's folder, `fetchReports` brings accepted reports home, `bundle` posts a round with no key.
 */
import fs from "node:fs";
import path from "node:path";
import { writeAtomic } from "./fsx.js";
import { REPORT_NAME, stripFragments } from "./report-shape.js";

export const MAX_PUBLISH_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 60_000;

const fail = (m) => {
  throw new Error(m);
};
const base = (url) => String(url ?? "").replace(/\/+$/, "");
/** An address as it may be printed: the origin only, so a key in a path or in userinfo never reaches a message. */
const shown = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return "the server";
  }
};

const timedOut = (e) => e?.name === "TimeoutError" || e?.name === "AbortError" || /aborted/i.test(String(e?.message));
const slow = (url, timeoutMs) => `${shown(url)} did not answer within ${Math.round(timeoutMs / 1000)} seconds.`;

/** The one sentence for a request that went wrong at the transport. */
async function send(fetchImpl, url, init, timeoutMs) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (timedOut(e)) fail(slow(url, timeoutMs));
    return fail(`Could not reach ${shown(url)}: check that the server is running and the url in connector.json is right.`);
  }
  return res;
}

/**
 * @param {{ url: string, key: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {{ url: string, call: (tool: string, args?: object) => Promise<any> }}
 */
export function connect({ url, key, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
  const root = base(url);
  if (!/^https?:\/\//i.test(root)) fail("The server url must start with http:// or https://.");
  if (typeof key !== "string" || key === "") fail("A key is needed to call the server.");
  let id = 0;
  let ready = null;
  const rpc = async (method, params) => {
    const res = await send(fetchImpl, `${root}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) }, timeoutMs);
    if (res.status === 401) fail("The server refused the key: check the coding key in .keys.json or PERSONA_CODING_KEY.");
    if (res.status === 404) fail(`${shown(root)} is not a persona server at /mcp (or it has no keys set).`);
    if (res.status === 413) fail("The server said the request is too large: split the round into two rounds with fewer walks each.");
    if (res.status !== 200) fail(`The server answered ${res.status}.`);
    let j;
    try {
      j = await res.json();
    } catch (e) {
      // The time limit also covers the body: an answer that stalls half way is slow, not malformed.
      return fail(timedOut(e) ? slow(root, timeoutMs) : "The server's answer was not JSON.");
    }
    if (j.error) fail(String(j.error.message ?? "The server refused the call."));
    return j.result;
  };
  const start = () =>
    (ready ??= rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "persona-cli", version: "1" } }).catch((e) => {
      ready = null;
      throw e;
    }));
  return {
    url: root,
    async call(tool, args = {}) {
      await start();
      const r = await rpc("tools/call", { name: tool, arguments: args });
      const text = r?.content?.[0]?.text ?? "";
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      if (r?.isError) throw Object.assign(new Error(String(data?.error ?? data ?? "The server refused the call.")), { refused: true });
      return data;
    },
  };
}

/** The round's briefs and guide as the folder holds them: `{ briefs: [{id, brief}], guide }`. */
function readRoundFolder(dir, round) {
  const folder = path.join(dir, "briefs", `r${round}`);
  const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith(".md") && f !== "guide.md").sort() : [];
  if (files.length === 0) fail(`No briefs for round ${round} in ${folder}: plan the round first.`);
  const briefs = files.map((f) => ({ id: f.replace(/\.md$/, ""), brief: fs.readFileSync(path.join(folder, f), "utf8") }));
  const gf = path.join(folder, "guide.md");
  const guide = fs.existsSync(gf) ? fs.readFileSync(gf, "utf8") : undefined;
  return { briefs, guide };
}

/** The size the server will measure: the JSON body, where every newline and quote is escaped, plus room for the envelope. */
const sizeOf = ({ briefs, guide }) => Buffer.byteLength(JSON.stringify({ guide: guide ?? "", briefs })) + 512;

/** Publishes the round's briefs and guide with the coding key. One call; over 2 MB it says to split the round. */
export async function publish(dir, round, conn) {
  const r = readRoundFolder(dir, round);
  if (sizeOf(r) > MAX_PUBLISH_BYTES) fail(`Round ${round} is over 2 MB: split the round into two rounds with fewer walks each.`);
  return conn.call("publish_round", { round, ...(r.guide === undefined ? {} : { guide: r.guide }), briefs: r.briefs });
}

/** Lists the round's reports and writes every accepted one to `reports/<id>.md`, with `clock-r<round>.json`. Sign-in links and `secretPaths` are cut again here, whatever the server was set up to cut. */
export async function fetchReports(dir, round, conn, { secretPaths = [] } = {}) {
  const list = await conn.call("list_reports", { round });
  const fetched = [];
  const missing = [];
  const clock = [];
  fs.mkdirSync(path.join(dir, "reports"), { recursive: true });
  for (const w of list.walks ?? []) {
    if (typeof w.id !== "string" || !REPORT_NAME.test(w.id)) continue;
    if (w.status !== "accepted") {
      missing.push(w.id);
      continue;
    }
    const got = await conn.call("get_report", { id: w.id });
    writeAtomic(path.join(dir, "reports", `${w.id}.md`), stripFragments(String(got.report ?? ""), { secretPaths }));
    fetched.push(w.id);
    if (typeof w.clock_minutes === "number") clock.push({ id: w.id, started: w.started ?? null, clock_minutes: w.clock_minutes });
  }
  writeAtomic(path.join(dir, `clock-r${round}.json`), `${JSON.stringify({ round, walks: clock }, null, 2)}\n`);
  return { round, fetched, missing, clock: clock.length };
}

/** Posts the round to `<url>/bundle` (no key) and answers `{code}`: give it to `publish_round({bundle})` from a session that has only the connector. */
export async function bundle(dir, round, { url, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
  const r = readRoundFolder(dir, round);
  if (sizeOf(r) > MAX_PUBLISH_BYTES) fail(`Round ${round} is over 2 MB: split the round into two rounds with fewer walks each.`);
  const res = await send(fetchImpl, `${base(url)}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ round, ...(r.guide === undefined ? {} : { guide: r.guide }), briefs: r.briefs }) }, timeoutMs);
  let j = {};
  try {
    j = await res.json();
  } catch (e) {
    if (timedOut(e)) fail(slow(url, timeoutMs));
    // anything else is answered below
  }
  if (res.status === 201 && typeof j.code === "string") return { code: j.code };
  return fail(res.status === 429 ? "The server takes only a few bundles an hour: wait, or publish with the coding key." : `The server did not take the bundle (${res.status}): ${String(j.text ?? j.error ?? "no reason given")}`);
}
