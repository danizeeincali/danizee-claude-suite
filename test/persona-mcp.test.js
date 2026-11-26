import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/lib/persona/sqlite.js";
import { TOOLS, toolsFor } from "../src/lib/persona/tools.js";
import { handleRpc } from "../src/lib/persona/mcp.js";
import { NOW } from "./helpers/persona-fixtures.js";

const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
const ask = (db, msg, role = "tester", extra = {}) => handleRpc(msg, { db, now: NOW, role, ...extra });
const names = (tools) => tools.map((t) => t.name);
const text = (res) => JSON.parse(res.result.content[0].text);

describe("initialize", () => {
  it("answers the client's protocol version when it is one of the three, else the newest", async () => {
    const db = openStore();
    for (const v of ["2024-11-05", "2025-03-26", "2025-06-18"]) {
      assert.equal((await ask(db, rpc("initialize", { protocolVersion: v }))).result.protocolVersion, v);
    }
    for (const v of ["2099-01-01", undefined, 7, "2025-11-25"]) {
      assert.equal((await ask(db, rpc("initialize", { protocolVersion: v }))).result.protocolVersion, "2025-06-18");
    }
    assert.equal((await ask(db, rpc("initialize"))).result.protocolVersion, "2025-06-18");
  });

  it("names the server, the product, the tools capability and the instructions, with no product name baked in", async () => {
    const db = openStore();
    const res = await ask(db, rpc("initialize", { protocolVersion: "2025-06-18" }, "abc"), "tester", { product: "Acme Shop" });
    assert.equal(res.jsonrpc, "2.0");
    assert.equal(res.id, "abc");
    assert.deepEqual(res.result.capabilities, { tools: {} });
    assert.equal(res.result.serverInfo.name, "persona-tester");
    assert.equal(res.result.serverInfo.title, "Acme Shop persona testing (dev)");
    assert.match(res.result.serverInfo.version, /^\d+\.\d+\.\d+$/);
    assert.match(res.result.instructions, /^Persona testing for Acme Shop/);
    assert.match(res.result.instructions, /check_again_minutes/);
    assert.match(res.result.instructions, /notes first/);
    assert.doesNotMatch(res.result.instructions, /<product>/);
    const plain = await ask(db, rpc("initialize"));
    assert.match(plain.result.serverInfo.title, /persona testing \(dev\)$/);
  });
});

describe("notifications, ping and unknown methods", () => {
  it("answers null for a notification (no id) and for any notifications/ method", async () => {
    const db = openStore();
    assert.equal(await ask(db, { jsonrpc: "2.0", method: "notifications/initialized" }), null);
    assert.equal(await ask(db, { jsonrpc: "2.0", method: "anything/else" }), null);
    assert.equal(await ask(db, rpc("notifications/cancelled", { requestId: 1 })), null);
  });

  it("ping answers {}", async () => {
    assert.deepEqual(await ask(openStore(), rpc("ping", undefined, 5)), { jsonrpc: "2.0", id: 5, result: {} });
  });

  it("any other method is -32601, and a malformed message is -32600", async () => {
    const db = openStore();
    assert.equal((await ask(db, rpc("resources/list"))).error.code, -32601);
    assert.equal((await ask(db, rpc("prompts/list"))).error.code, -32601);
    for (const bad of [null, 3, "x", { id: 1, method: "ping" }, { jsonrpc: "2.0", id: 1 }, { jsonrpc: "2.0", id: 1, method: 4 }, { jsonrpc: "2.0", id: {}, method: "ping" }]) {
      const res = await ask(db, bad);
      assert.equal(res.error.code, -32600, JSON.stringify(bad));
      assert.equal(res.jsonrpc, "2.0");
    }
    assert.equal((await ask(db, { jsonrpc: "2.0", id: 9, method: "ping", params: [] })).error.code, -32602);
  });
});

describe("tools/list is filtered by role", () => {
  it("the tester sees its eight tools, the coding thread all of them, and no internal role key", async () => {
    const db = openStore();
    const t = (await ask(db, rpc("tools/list"), "tester")).result.tools;
    const c = (await ask(db, rpc("tools/list"), "coding")).result.tools;
    assert.deepEqual(names(t).sort(), ["ask", "answers", "get_brief", "guide", "next_walk", "notes", "start_walk", "submit_report"].sort());
    assert.deepEqual(names(c), names(TOOLS));
    assert.deepEqual(t, toolsFor("tester"));
    assert.deepEqual(c, toolsFor("coding"));
    assert.ok(c.length > t.length);
    for (const d of c) {
      assert.equal("role" in d, false);
      assert.equal(typeof d.description, "string");
      assert.equal(d.inputSchema.type, "object");
    }
  });
});

describe("tools/call", () => {
  it("runs a tool as a result with one text part, as the role", async () => {
    const db = openStore();
    const res = await ask(db, rpc("tools/call", { name: "notes", arguments: {} }));
    assert.equal(res.result.isError, undefined);
    assert.equal(res.result.content.length, 1);
    assert.equal(text(res).open_walks, 0);
  });

  it("a tester calling a coding tool is a tool result with isError, the coding thread may", async () => {
    const db = openStore();
    const refused = await ask(db, rpc("tools/call", { name: "publish_round", arguments: { round: 1, briefs: [{ id: "r1-01-a", brief: "B." }] } }), "tester");
    assert.equal(refused.result.isError, true);
    assert.match(text(refused).error, /for the coding thread/);
    const done = await ask(db, rpc("tools/call", { name: "publish_round", arguments: { round: 1, briefs: [{ id: "r1-01-a", brief: "B." }] } }), "coding");
    assert.equal(done.result.isError, undefined);
    assert.equal(text(done).briefs, 1);
  });

  it("an unknown tool, or a missing name or arguments, is a tool result with isError, never a throw", async () => {
    const db = openStore();
    for (const params of [{ name: "nope", arguments: {} }, { arguments: {} }, { name: 5 }, undefined]) {
      const res = await ask(db, rpc("tools/call", params));
      assert.equal(res.result.isError, true, JSON.stringify(params));
      assert.match(text(res).error, /Unknown tool/);
    }
    const noArgs = await ask(db, rpc("tools/call", { name: "notes" }));
    assert.equal(noArgs.result.isError, undefined);
  });

  it("passes the secret paths through to what is stored", async () => {
    const db = openStore();
    await ask(db, rpc("tools/call", { name: "post_note", arguments: { text: "go to /_in/secret/abc now" } }), "coding", { secretPaths: ["/_in/secret"] });
    const row = db.raw.prepare("SELECT text FROM persona_notes").get();
    assert.doesNotMatch(row.text, /abc/);
  });
});

describe("batches", () => {
  it("answers an array as an array, leaving out notifications", async () => {
    const db = openStore();
    const res = await ask(db, [rpc("ping", undefined, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("tools/list", undefined, 2), 7]);
    assert.equal(res.length, 3);
    assert.equal(res[0].id, 1);
    assert.equal(res[1].id, 2);
    assert.equal(res[2].error.code, -32600);
  });

  it("a batch of notifications only is null, an empty batch or one over 16 is -32600", async () => {
    const db = openStore();
    assert.equal(await ask(db, [{ jsonrpc: "2.0", method: "notifications/initialized" }]), null);
    assert.equal((await ask(db, [])).error.code, -32600);
    assert.equal((await ask(db, Array.from({ length: 17 }, (_, i) => rpc("ping", undefined, i)))).error.code, -32600);
    assert.equal((await ask(db, Array.from({ length: 16 }, (_, i) => rpc("ping", undefined, i)))).length, 16);
  });
});
