import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/lib/persona/worker/worker.js";
import { openStore } from "../src/lib/persona/sqlite.js";

const TESTER = "tester-key-0123456789abcdefghij";
const CODING = "coding-key-0123456789abcdefghij";
const env = (over = {}) => ({ DB: openStore(), PERSONA_TESTER_KEY: TESTER, PERSONA_CODING_KEY: CODING, PERSONA_PRODUCT: "Acme Shop", ...over });
const send = (e, body, key, extra = {}) =>
  worker.fetch(new Request("https://persona.example.workers.dev/mcp", { method: "POST", headers: { authorization: `Bearer ${key}`, ...extra }, body: JSON.stringify(body) }), e);
const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });

describe("the Worker entry", () => {
  it("exports a default object with fetch", () => {
    assert.equal(typeof worker.fetch, "function");
  });

  it("serves the MCP server with the product and the role from its env", async () => {
    const e = env();
    const init = await (await send(e, rpc("initialize"), TESTER)).json();
    assert.equal(init.result.serverInfo.title, "Acme Shop persona testing (dev)");
    const t = (await (await send(e, rpc("tools/list"), TESTER)).json()).result.tools.map((x) => x.name);
    const c = (await (await send(e, rpc("tools/list"), CODING)).json()).result.tools.map((x) => x.name);
    assert.ok(!t.includes("publish_round") && c.includes("publish_round"));
    e.DB.close();
  });

  it("is off (404) with no keys in its env, and 401 for a wrong key", async () => {
    const off = env({ PERSONA_TESTER_KEY: undefined, PERSONA_CODING_KEY: undefined });
    assert.equal((await send(off, rpc("ping"), TESTER)).status, 404);
    const on = env();
    assert.equal((await send(on, rpc("ping"), "wrong-wrong-wrong-wrong-wrong")).status, 401);
    off.DB.close();
    on.DB.close();
  });

  it("without a product in its env the title still reads, and secret paths come from a comma list", async () => {
    const e = env({ PERSONA_PRODUCT: undefined, PERSONA_SECRET_PATHS: "/_in/secret, /other" });
    const init = await (await send(e, rpc("initialize"), TESTER)).json();
    assert.match(init.result.serverInfo.title, /persona testing \(dev\)$/);
    const note = await (await send(e, rpc("tools/call", { name: "post_note", arguments: { text: "visit /_in/secret/abc123 now" } }), CODING)).json();
    assert.equal(note.result.isError, undefined);
    assert.doesNotMatch(e.DB.raw.prepare("SELECT text FROM persona_notes").get().text, /abc123/);
    e.DB.close();
  });

  it("takes the visitor from cf-connecting-ip: the seventh bundle from one address is held, another address is not", async () => {
    const e = env();
    const post = (ip) =>
      worker.fetch(new Request("https://persona.example.workers.dev/bundle", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ round: 1, briefs: [{ id: "r1-01-a", brief: "A." }] }) }), e);
    for (let i = 0; i < 6; i++) assert.equal((await post("1.1.1.1")).status, 201);
    assert.equal((await post("1.1.1.1")).status, 429);
    assert.equal((await post("2.2.2.2")).status, 201);
    e.DB.close();
  });
});

describe("wrangler.example.toml", () => {
  const toml = readFileSync(new URL("../src/lib/persona/worker/wrangler.example.toml", import.meta.url), "utf8");
  it("names the worker, its entry, a compatibility date, one D1 binding DB and PERSONA_PRODUCT, and holds no secret", () => {
    assert.match(toml, /^name\s*=\s*"[a-z0-9-]+"/m);
    assert.match(toml, /^main\s*=\s*"worker\.js"/m);
    assert.match(toml, /^compatibility_date\s*=\s*"\d{4}-\d{2}-\d{2}"/m);
    assert.equal((toml.match(/\[\[d1_databases\]\]/g) ?? []).length, 1);
    assert.match(toml, /binding\s*=\s*"DB"/);
    assert.match(toml, /database_id\s*=\s*"[^"]*"/);
    assert.match(toml, /\[vars\][\s\S]*PERSONA_PRODUCT\s*=/);
    assert.doesNotMatch(toml, /^\s*PERSONA_(TESTER|CODING)_KEY\s*=/m);
    assert.doesNotMatch(toml, /[A-Za-z0-9_-]{40,}/);
  });
});
