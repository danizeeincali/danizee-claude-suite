import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "../src/lib/persona/serve.js";
import { REPORT_TEMPLATE } from "../src/lib/persona/report-shape.js";

const TESTER = "tester-key-0123456789abcdefghij";
const CODING = "coding-key-0123456789abcdefghij";
const SERVE = new URL("../src/lib/persona/serve.js", import.meta.url).pathname;
const tmp = () => mkdtempSync(path.join(tmpdir(), "persona-serve-"));

const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
const client = (url, key) => ({
  async rpc(method, params) {
    const res = await fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(rpc(method, params)) });
    assert.equal(res.status, 200);
    return res.json();
  },
  async tool(name, args = {}) {
    const j = await this.rpc("tools/call", { name, arguments: args });
    return { isError: j.result.isError === true, data: JSON.parse(j.result.content[0].text) };
  },
});

describe("startServer over real HTTP on a free port", () => {
  it("walks a round end to end: initialize, tools/list, publish, notes, walk, rejected then accepted report, list, export", async () => {
    const server = await startServer({ port: 0, testerKey: TESTER, codingKey: CODING, product: "Acme Shop" });
    try {
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.notEqual(new URL(server.url).port, "0");
      const tester = client(server.url, TESTER);
      const coding = client(server.url, CODING);

      const init = await tester.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
      assert.equal(init.result.serverInfo.title, "Acme Shop persona testing (dev)");
      const tNames = (await tester.rpc("tools/list")).result.tools.map((t) => t.name);
      const cNames = (await coding.rpc("tools/list")).result.tools.map((t) => t.name);
      assert.ok(cNames.length > tNames.length);
      assert.ok(!tNames.includes("publish_round") && cNames.includes("publish_round"));

      // A tester key is refused on publish_round.
      const refused = await tester.tool("publish_round", { round: 1, briefs: [{ id: "r1-01-x", brief: "X." }] });
      assert.equal(refused.isError, true);

      const pub = await coding.tool("publish_round", { round: 1, guide: "Walk it as a customer.", briefs: [{ id: "r1-01-florist", brief: "A florist." }, { id: "r1-02-plumber", brief: "A plumber." }] });
      assert.equal(pub.isError, false);
      assert.equal(pub.data.briefs, 2);
      await coding.tool("post_note", { text: "Please start with the florist." });

      const notes = await tester.tool("notes");
      assert.equal(notes.data.open_walks, 2);
      assert.equal(notes.data.notes.length, 1);
      assert.equal((await tester.tool("guide")).data.guide, "Walk it as a customer.");

      const next = await tester.tool("next_walk");
      assert.equal(next.data.id, "r1-01-florist");
      assert.equal(next.data.round, 1);
      assert.ok(next.data.check_again_minutes >= 1);
      assert.equal((await tester.tool("start_walk", { id: "r1-01-florist" })).isError, false);

      const bad = await tester.tool("submit_report", { id: "r1-01-florist", report: "# not a report" });
      assert.equal(bad.data.accepted, false);
      assert.ok(Array.isArray(bad.data.problems) && bad.data.problems.length > 0);

      const good = await tester.tool("submit_report", { id: "r1-01-florist", report: REPORT_TEMPLATE("r1-01-florist", "the tester") });
      assert.equal(good.data.accepted, true, JSON.stringify(good.data));

      const list = await coding.tool("list_reports", { round: 1 });
      const mine = JSON.stringify(list.data);
      assert.match(mine, /r1-01-florist/);
      assert.match(mine, /accepted/);

      const exp = await coding.tool("export_round", { round: 1 });
      assert.equal(exp.isError, false);
      const res = await fetch(`${server.url}/export?code=${exp.data.code}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.round, 1);
      assert.equal(body.reports.length, 1);
      assert.equal(body.reports[0].id, "r1-01-florist");
      assert.equal(body.reports[0].status, "accepted");
      assert.equal((await fetch(`${server.url}/export?code=nothere123`)).status, 404);
    } finally {
      await server.close();
    }
  });

  it("serves the key-in-path form, posts a bundle, and refuses without a key; a keyless server won't start", async () => {
    const server = await startServer({ port: 0, testerKey: TESTER, codingKey: CODING });
    try {
      const viaPath = await fetch(`${server.url}/k/${CODING}/mcp`, { method: "POST", body: JSON.stringify(rpc("tools/list")) });
      assert.equal(viaPath.status, 200);
      assert.equal((await fetch(`${server.url}/k/${CODING}x/mcp`, { method: "POST", body: "{}" })).status, 404);
      assert.equal((await fetch(`${server.url}/mcp`, { method: "POST", body: "{}" })).status, 401);
      const b = await fetch(`${server.url}/bundle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ round: 3, briefs: [{ id: "r3-01-a", brief: "A." }] }) });
      assert.equal(b.status, 201);
      const { code } = await b.json();
      const pub = await client(server.url, CODING).tool("publish_round", { round: 3, bundle: code });
      assert.equal(pub.isError, false);
    } finally {
      await server.close();
    }
    await assert.rejects(startServer({ port: 0 }), /key/i);
    await assert.rejects(startServer({ port: 0, testerKey: TESTER, codingKey: TESTER }), /key/i);
  });

  it("a file store keeps its rounds across a restart, and close() frees the port", async () => {
    const dir = tmp();
    try {
      const file = path.join(dir, "p.db");
      const a = await startServer({ file, port: 0, testerKey: TESTER, codingKey: CODING });
      await client(a.url, CODING).tool("publish_round", { round: 1, briefs: [{ id: "r1-01-a", brief: "A." }] });
      await a.close();
      await assert.rejects(fetch(`${a.url}/mcp`, { method: "POST", body: "{}" }));
      const b = await startServer({ file, port: 0, testerKey: TESTER, codingKey: CODING });
      try {
        assert.equal((await client(b.url, TESTER).tool("notes")).data.open_walks, 1);
      } finally {
        await b.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers 413 for an oversized body without hanging", async () => {
    const server = await startServer({ port: 0, testerKey: TESTER, codingKey: CODING });
    try {
      const res = await fetch(`${server.url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${TESTER}` }, body: "x".repeat(2 * 1024 * 1024 + 5) });
      assert.equal(res.status, 413);
    } finally {
      await server.close();
    }
  });
});

/** Runs serve.js as a script; resolves with the first stdout line and a stop() that ends it. */
function script(args, env) {
  const child = spawn(process.execPath, [SERVE, ...args], { env: { PATH: process.env.PATH, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  const first = new Promise((resolve) => {
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes("\n")) resolve(out.split("\n")[0]);
    });
    child.on("exit", (code) => resolve({ exit: code, out, err }));
  });
  return { first, child, stop: () => new Promise((r) => (child.exitCode !== null ? r() : (child.once("exit", r), child.kill()))), err: () => err };
}

describe("serve.js as a script", () => {
  it("prints one JSON line {url, mcp} and never a key, with keys from the environment", async () => {
    const s = script(["--port", "0"], { PERSONA_TESTER_KEY: TESTER, PERSONA_CODING_KEY: CODING });
    try {
      const line = await s.first;
      assert.equal(typeof line, "string", JSON.stringify(line));
      const j = JSON.parse(line);
      assert.deepEqual(Object.keys(j).sort(), ["mcp", "url"]);
      assert.equal(j.mcp, `${j.url}/mcp`);
      assert.doesNotMatch(line, new RegExp(`${TESTER}|${CODING}`));
      const res = await fetch(j.mcp, { method: "POST", headers: { authorization: `Bearer ${TESTER}` }, body: JSON.stringify(rpc("ping")) });
      assert.equal(res.status, 200);
    } finally {
      await s.stop();
    }
    assert.doesNotMatch(s.err(), new RegExp(`${TESTER}|${CODING}`));
  });

  it("reads keys from a --keys file", async () => {
    const dir = tmp();
    try {
      const keys = path.join(dir, "keys.json");
      writeFileSync(keys, JSON.stringify({ tester_key: TESTER, coding_key: CODING }));
      const s = script(["--port", "0", "--keys", keys, "--product", "Acme"], {});
      try {
        const j = JSON.parse(await s.first);
        const res = await fetch(j.mcp, { method: "POST", headers: { authorization: `Bearer ${CODING}` }, body: JSON.stringify(rpc("initialize")) });
        assert.match((await res.json()).result.serverInfo.title, /^Acme /);
      } finally {
        await s.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("with no valid key it exits 1 with one sentence and no key", async () => {
    const s = script(["--port", "0"], { PERSONA_TESTER_KEY: "short" });
    const r = await s.first;
    assert.equal(r.exit, 1);
    assert.equal(r.out, "");
    assert.equal(s.err().trim().split("\n").length, 1);
    assert.match(s.err(), /key/i);
  });

  it("importing the module starts nothing", async () => {
    const { startServer: fn } = await import("../src/lib/persona/serve.js");
    assert.equal(typeof fn, "function");
  });
});
