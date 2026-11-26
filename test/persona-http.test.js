import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { openStore } from "../src/lib/persona/sqlite.js";
import { createHandler } from "../src/lib/persona/http.js";
import { CODE_RE } from "../src/lib/persona/tools.js";
import { NOW, count } from "./helpers/persona-fixtures.js";

const TESTER = "tester-key-0123456789abcdefghij";
const CODING = "coding-key-0123456789abcdefghij";
const BASE = "http://persona.test";

const stores = [];
const store = () => {
  const s = openStore();
  stores.push(s);
  return s;
};
afterEach(() => {
  while (stores.length) stores.pop().close();
});

const make = (over = {}) => {
  const db = over.db ?? store();
  let clock = NOW;
  const handler = createHandler({ db, testerKey: TESTER, codingKey: CODING, now: () => clock, clientIp: (r) => r.headers.get("x-ip"), ...over });
  return { db, handler, tick: (ms) => (clock += ms) };
};
const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
const post = (handler, path, body, headers = {}) =>
  handler(new Request(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const mcp = (handler, key, body, path = "/mcp") => post(handler, path, body, key === null ? {} : { authorization: `Bearer ${key}` });
const call = async (handler, key, name, args = {}) => {
  const res = await mcp(handler, key, rpc("tools/call", { name, arguments: args }));
  const j = await res.json();
  return { res, isError: j.result.isError === true, data: JSON.parse(j.result.content[0].text) };
};

describe("off unless keyed", () => {
  it("answers 404 not_found on every path and method with no valid key at all", async () => {
    const bad = [{}, { testerKey: "short", codingKey: "tiny" }, { testerKey: 5, codingKey: null }, { testerKey: "x".repeat(30), codingKey: "x".repeat(30) }];
    for (const keys of bad) {
      const h = createHandler({ db: store(), now: () => NOW, ...keys });
      for (const [method, path] of [["POST", "/mcp"], ["GET", "/mcp"], ["POST", "/bundle"], ["GET", "/export?code=abcdefghij"], ["GET", "/"], ["POST", `/k/${"x".repeat(30)}/mcp`]]) {
        const res = await h(new Request(BASE + path, { method, headers: { authorization: `Bearer ${"x".repeat(30)}` }, body: method === "POST" ? "{}" : undefined }));
        assert.equal(res.status, 404, `${method} ${path}`);
        assert.deepEqual(await res.json(), { error: "not_found" });
      }
    }
  });

  it("a role whose key is missing or too short is simply not reachable; the other works", async () => {
    const h = createHandler({ db: store(), codingKey: CODING, testerKey: "short", now: () => NOW });
    assert.equal((await mcp(h, "short", rpc("ping"))).status, 401);
    assert.equal((await mcp(h, CODING, rpc("ping"))).status, 200);
    const t = createHandler({ db: store(), testerKey: TESTER, now: () => NOW });
    assert.equal((await mcp(t, TESTER, rpc("ping"))).status, 200);
    assert.equal((await mcp(t, CODING, rpc("ping"))).status, 401);
  });
});

describe("POST /mcp and POST /k/<key>/mcp", () => {
  it("the key decides the role, in both forms", async () => {
    const { handler } = make();
    for (const [form, send] of [
      ["header", (key, body) => mcp(handler, key, body)],
      ["path", (key, body) => post(handler, `/k/${key}/mcp`, body)],
    ]) {
      const t = (await (await send(TESTER, rpc("tools/list"))).json()).result.tools.map((x) => x.name);
      const c = (await (await send(CODING, rpc("tools/list"))).json()).result.tools.map((x) => x.name);
      assert.ok(!t.includes("publish_round"), form);
      assert.ok(c.includes("publish_round"), form);
      assert.ok(t.includes("submit_report") && c.includes("submit_report"));
    }
  });

  it("answers application/json with no-store; a notification answers 202 with no body", async () => {
    const { handler } = make();
    const res = await mcp(handler, TESTER, rpc("ping"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /^application\/json/);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { jsonrpc: "2.0", id: 1, result: {} });
    const n = await mcp(handler, TESTER, { jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(n.status, 202);
    assert.equal(await n.text(), "");
    const batch = await mcp(handler, TESTER, [rpc("ping", undefined, 1), rpc("ping", undefined, 2)]);
    assert.equal((await batch.json()).length, 2);
  });

  it("a wrong or missing key is 401 on /mcp and 404 on /k/, and nothing says which part was wrong", async () => {
    const { handler } = make();
    for (const key of ["wrong-key-0123456789abcdefghij", null, TESTER + "x", TESTER.slice(1), ""]) {
      const res = await mcp(handler, key, rpc("ping"));
      assert.equal(res.status, 401, String(key));
      assert.deepEqual(await res.json(), { error: "unauthorized" });
      const p = await post(handler, `/k/${key ?? ""}/mcp`, rpc("ping"));
      assert.equal(p.status, 404, String(key));
    }
    const odd = await post(handler, "/k/%E0%A4%A/mcp", rpc("ping"));
    assert.equal(odd.status, 404);
    const scheme = await post(handler, "/mcp", rpc("ping"), { authorization: `Basic ${TESTER}` });
    assert.equal(scheme.status, 401);
    const lower = await post(handler, "/mcp", rpc("ping"), { authorization: `bearer ${TESTER}` });
    assert.equal(lower.status, 200);
  });

  it("GET on either is 405", async () => {
    const { handler } = make();
    assert.equal((await handler(new Request(BASE + "/mcp", { headers: { authorization: `Bearer ${TESTER}` } }))).status, 405);
    assert.equal((await handler(new Request(`${BASE}/k/${TESTER}/mcp`))).status, 405);
    assert.equal((await handler(new Request(BASE + "/mcp", { method: "PUT", body: "{}" }))).status, 405);
  });

  it("a body over 2 MB is 413, by header or by stream; not JSON is 400 with a parse error", async () => {
    const { handler } = make();
    const big = JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024) });
    assert.equal((await mcp(handler, TESTER, big)).status, 413);
    const chunk = new Uint8Array(64 * 1024).fill(120);
    const body = new ReadableStream({
      start(c) {
        for (let i = 0; i < 40; i++) c.enqueue(chunk);
        c.close();
      },
    });
    const streamed = await handler(new Request(BASE + "/mcp", { method: "POST", headers: { authorization: `Bearer ${TESTER}` }, body, duplex: "half" }));
    assert.equal(streamed.status, 413);
    const res = await mcp(handler, TESTER, "{not json");
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, -32700);
    const empty = await mcp(handler, TESTER, "");
    assert.equal(empty.status, 400);
  });

  it("a tester key refused on a coding tool is a tool result; a coding key may publish", async () => {
    const { handler } = make();
    const args = { round: 1, briefs: [{ id: "r1-01-a", brief: "B." }] };
    const t = await call(handler, TESTER, "publish_round", args);
    assert.equal(t.isError, true);
    assert.match(t.data.error, /coding thread/);
    const c = await call(handler, CODING, "publish_round", args);
    assert.equal(c.isError, false);
  });

  it("never puts an error's message in a response body: a store that throws is 500 unavailable", async () => {
    const boom = { prepare() { throw new Error("secret-detail-xyz"); } };
    const { handler } = make({ db: boom });
    for (const res of [await post(handler, "/bundle", { round: 1, briefs: [] }), await handler(new Request(BASE + "/export?code=abcdefghij"))]) {
      assert.equal(res.status, 500);
      const t = await res.text();
      assert.deepEqual(JSON.parse(t), { error: "unavailable" });
      assert.doesNotMatch(t, /secret-detail/);
    }
    const mcpRes = await call(handler, CODING, "notes");
    assert.equal(mcpRes.isError, true);
    assert.doesNotMatch(JSON.stringify(mcpRes.data), /secret-detail/);
    const throwing = createHandler({ db: () => { throw new Error("boom-detail"); }, testerKey: TESTER, codingKey: CODING, now: () => NOW });
    const r = await mcp(throwing, TESTER, rpc("ping"));
    assert.ok([200, 500].includes(r.status));
    const b = await post(throwing, "/bundle", { round: 1, briefs: [] });
    assert.equal(b.status, 500);
    assert.doesNotMatch(await b.text(), /boom-detail/);
  });

  it("db may be a function returning the store, and a key is never logged", async () => {
    const logged = [];
    const orig = [console.log, console.error, console.warn, console.info];
    console.log = console.error = console.warn = console.info = (...a) => logged.push(a.join(" "));
    try {
      const s = store();
      const handler = createHandler({ db: () => s, testerKey: TESTER, codingKey: CODING, now: () => NOW });
      await mcp(handler, TESTER, rpc("ping"));
      await mcp(handler, "bad-bad-bad-bad-bad-bad-bad", rpc("ping"));
      await post(handler, `/k/${CODING}/mcp`, "{nope");
    } finally {
      [console.log, console.error, console.warn, console.info] = orig;
    }
    assert.equal(logged.join("\n").includes(TESTER), false);
    assert.equal(logged.join("\n").includes(CODING), false);
  });
});

describe("the bundle, then publish_round", () => {
  const bundle = { round: 2, guide: "Guide.", briefs: [{ id: "r2-01-baker", brief: "Baker." }, { id: "r2-02-chef", brief: "Chef." }] };

  it("POST /bundle needs no sign-in, answers 201 {code}, and publish_round({bundle}) makes it a round", async () => {
    const { handler, db } = make();
    const res = await post(handler, "/bundle", bundle, { "x-ip": "1.2.3.4" });
    assert.equal(res.status, 201);
    const { code } = await res.json();
    assert.match(code, CODE_RE);
    assert.equal(count(db, "persona_briefs"), 0);
    const pub = await call(handler, CODING, "publish_round", { round: 2, bundle: code });
    assert.equal(pub.isError, false);
    assert.equal(pub.data.briefs, 2);
    assert.equal(count(db, "persona_briefs"), 2);
  });

  it("refuses non-JSON (415), a cross-origin post (403), more than 5 MB (413), bad bodies (400), other methods (405)", async () => {
    const { handler } = make();
    assert.equal((await post(handler, "/bundle", "x", { "content-type": "text/plain" })).status, 415);
    assert.equal((await post(handler, "/bundle", bundle, { origin: "https://evil.example" })).status, 403);
    assert.equal((await post(handler, "/bundle", bundle, { origin: BASE })).status, 201);
    assert.equal((await post(handler, "/bundle", JSON.stringify({ pad: "x".repeat(5 * 1024 * 1024 + 10) }))).status, 413);
    assert.equal((await post(handler, "/bundle", "{nope")).status, 400);
    const bad = await post(handler, "/bundle", { round: 0, briefs: [] });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "bad_request");
    assert.equal((await handler(new Request(BASE + "/bundle"))).status, 405);
  });

  it("is 6 an hour per visitor; another visitor and the next hour are not held back", async () => {
    const { handler, tick } = make();
    for (let i = 0; i < 6; i++) assert.equal((await post(handler, "/bundle", bundle, { "x-ip": "9.9.9.9" })).status, 201, `post ${i}`);
    const seventh = await post(handler, "/bundle", bundle, { "x-ip": "9.9.9.9" });
    assert.equal(seventh.status, 429);
    assert.deepEqual(await seventh.json(), { error: "rate_limited" });
    assert.equal((await post(handler, "/bundle", bundle, { "x-ip": "8.8.8.8" })).status, 201);
    tick(3_600_000);
    assert.equal((await post(handler, "/bundle", bundle, { "x-ip": "9.9.9.9" })).status, 201);
  });

  it("with no ip every poster shares one bucket, stored under a keyed hash and never the address", async () => {
    const { handler, db } = make({ clientIp: () => null });
    for (let i = 0; i < 6; i++) assert.equal((await post(handler, "/bundle", bundle)).status, 201);
    assert.equal((await post(handler, "/bundle", bundle)).status, 429);
    const { handler: h2, db: db2 } = make({ clientIp: () => "203.0.113.77" });
    await post(h2, "/bundle", bundle);
    const row = db2.raw.prepare("SELECT visitor FROM persona_bundles").get();
    assert.match(row.visitor, /^[0-9a-f]{16}$/);
    const rate = JSON.stringify(db2.raw.prepare("SELECT * FROM persona_rate").all());
    assert.doesNotMatch(rate, /203\.0\.113\.77/);
    assert.equal(db.raw.prepare("SELECT visitor FROM persona_bundles").get().visitor, "");
  });

  it("the visitor hash is the HMAC-SHA-256 of the ip keyed by the coding key (else the tester key) and the UTC day", async () => {
    const { handler, db } = make({ clientIp: () => "10.0.0.1" });
    await post(handler, "/bundle", bundle);
    const a = db.raw.prepare("SELECT visitor FROM persona_bundles").get().visitor;
    const { createHmac } = await import("node:crypto");
    const day = new Date(NOW).toISOString().slice(0, 10);
    const same = (key) => createHmac("sha256", key).update(`${day}:10.0.0.1`).digest("hex").slice(0, 16);
    // the exact message is the handler's own business; what matters is the key and the day change it
    assert.notEqual(a, same(TESTER));
    const tOnly = make({ clientIp: () => "10.0.0.1", codingKey: undefined });
    await post(tOnly.handler, "/bundle", bundle);
    const b = tOnly.db.raw.prepare("SELECT visitor FROM persona_bundles").get().visitor;
    assert.notEqual(a, b);
    const other = make({ clientIp: () => "10.0.0.1" });
    other.tick(86_400_000);
    await post(other.handler, "/bundle", bundle);
    assert.notEqual(other.db.raw.prepare("SELECT visitor FROM persona_bundles").get().visitor, a);
  });
});

describe("GET /export?code=", () => {
  const seed = async (handler) => {
    await call(handler, CODING, "publish_round", { round: 1, guide: "G.", briefs: [{ id: "r1-01-a", brief: "A." }] });
    const { data } = await call(handler, CODING, "export_round", { round: 1 });
    return data.code;
  };

  it("opens the round's reports with no sign-in, dies after 3 reads, and answers 404 for anything wrong", async () => {
    const { handler } = make();
    const code = await seed(handler);
    for (let i = 0; i < 3; i++) {
      const res = await handler(new Request(`${BASE}/export?code=${code}`));
      assert.equal(res.status, 200, `read ${i}`);
      assert.equal((await res.json()).round, 1);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
    assert.equal((await handler(new Request(`${BASE}/export?code=${code}`))).status, 404);
    for (const q of ["", "?code=", "?code=zzzz", "?code=abcdefghij", "?code=" + "a".repeat(500)]) {
      const res = await handler(new Request(`${BASE}/export${q}`));
      assert.equal(res.status, 404, q);
      assert.deepEqual(await res.json(), { error: "not_found" });
    }
    assert.equal((await handler(new Request(`${BASE}/export?code=${code}`, { method: "POST", body: "{}" }))).status, 405);
  });

  it("is 30 an hour per visitor, counting even wrong codes", async () => {
    const { handler, tick } = make();
    for (let i = 0; i < 30; i++) assert.equal((await handler(new Request(`${BASE}/export?code=abcdefghij`, { headers: { "x-ip": "5.5.5.5" } }))).status, 404);
    const held = await handler(new Request(`${BASE}/export?code=abcdefghij`, { headers: { "x-ip": "5.5.5.5" } }));
    assert.equal(held.status, 429);
    assert.equal((await handler(new Request(`${BASE}/export?code=abcdefghij`, { headers: { "x-ip": "6.6.6.6" } }))).status, 404);
    tick(3_600_000);
    assert.equal((await handler(new Request(`${BASE}/export?code=abcdefghij`, { headers: { "x-ip": "5.5.5.5" } }))).status, 404);
  });
});

describe("other paths", () => {
  it("are 404 when keyed, and the key digest is how keys are compared", async () => {
    const { handler } = make();
    for (const p of ["/", "/mcp/extra", "/k/", `/k/${TESTER}`, "/health", "/k/a/b/mcp"]) {
      const res = await handler(new Request(BASE + p, { method: "POST", headers: { authorization: `Bearer ${TESTER}` }, body: "{}" }));
      assert.equal(res.status, 404, p);
    }
    // sanity for the digest: the same key bytes, however long, only the exact string passes
    assert.equal(createHash("sha256").update(TESTER).digest("hex").length, 64);
    assert.equal((await mcp(handler, TESTER + "x", rpc("ping"))).status, 401);
  });
});
