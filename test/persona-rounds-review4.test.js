import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/lib/persona/cli.js";
import { connect, bundle } from "../src/lib/persona/client.js";
import { REPORT_TEMPLATE, stripFragments } from "../src/lib/persona/report-shape.js";

const roots = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "persona-rr4-"));
  roots.push(d);
  return d;
};
after(() => roots.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function cli(cwd, args, extra = {}) {
  let out = "";
  let err = "";
  const r = await run(args, { cwd, env: { PATH: process.env.PATH }, out: (s) => (out += s), err: (s) => (err += s), ...extra });
  let data = null;
  try {
    data = JSON.parse(out);
  } catch {
    // not JSON
  }
  return { code: r.code, out, data, err, server: r.server };
}
const P = (cwd, ...f) => path.join(cwd, "persona-testing", ...f);
const json = (f) => JSON.parse(readFileSync(f, "utf8"));
const allFiles = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(path.join(d, e.name)) : [path.join(d, e.name)]));
async function tool(url, key, name, args) {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
  const res = await fetch(`${url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return JSON.parse((await res.json()).result.content[0].text);
}

describe("rounds review 4", () => {
  it("the stripper cuts a key in a /k/ address and after Bearer whatever the key looks like, and every exact secret it is given", () => {
    const hex = "0123456789abcdef".repeat(4);
    assert.equal(stripFragments(`see https://t.example.com/k/${hex}/mcp now`), "see https://t.example.com/k//mcp now");
    assert.equal(stripFragments(`Authorization: Bearer ${hex} sent`), "Authorization: Bearer  sent");
    assert.equal(stripFragments(`the key ${hex} alone`, { secrets: [hex] }), "the key  alone");
    assert.equal(stripFragments("a walk id r1-01-cafe-owner-cold-app and /k/short stay"), "a walk id r1-01-cafe-owner-cold-app and /k/short stay");
  });

  it("a tester who quotes its connector address or the bare key leaves the key in no file and no output", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    const plan = await cli(cwd, ["plan", "--round", "1", "--walks", "1"]);
    const serve = await cli(cwd, ["serve", "--port", "0"]);
    const url = serve.server.url;
    const { tester_key: TK, coding_key: CK } = json(P(cwd, ".keys.json"));
    assert.match(TK, /^[0-9a-f]{64}$/);
    const outputs = [];
    try {
      assert.equal((await cli(cwd, ["publish", "--round", "1", "--url", url])).code, 0);
      const id = plan.data.walks[0].id;
      await tool(url, TK, "start_walk", { id });
      const report = `${REPORT_TEMPLATE(id, "the tester")}\nNotes: my connector ${url}/k/${TK}/mcp stopped once; the key is ${TK}.\n`;
      const sub = await tool(url, TK, "submit_report", { id, report });
      assert.equal(sub.accepted, true, JSON.stringify(sub));
      await tool(url, TK, "ask", { question: `Is ${url}/k/${TK}/mcp right? Bearer ${TK}`, walk: id });
      for (const args of [["questions"], ["status", "--round", "1"], ["fetch", "--round", "1"], ["read", "--round", "1"], ["deliver", "--round", "1"]]) {
        const r = await cli(cwd, [...args, "--url", url].filter((a, i, all) => !(["read", "deliver"].includes(all[0]) && i >= all.length - 2)));
        assert.equal(r.code, 0, `${args[0]}: ${r.err}`);
        outputs.push(r.out, r.err);
      }
      const raw = await tool(url, CK, "get_report", { id });
      outputs.push(JSON.stringify(raw));
    } finally {
      await serve.server.close();
    }
    outputs.forEach((o, i) => assert.ok(!o.includes(TK) && !o.includes(CK), `output ${i}: ${o.replaceAll(TK, "<TK>").replaceAll(CK, "<CK>").slice(0, 600)}`));
    for (const f of allFiles(P(cwd))) {
      if (f.endsWith(".keys.json") || /\.db/.test(f)) continue;
      const text = readFileSync(f, "utf8");
      assert.ok(!text.includes(TK) && !text.includes(CK), f);
    }
  });

  it("a redirect is never followed: nothing is sent on, and the message names only the configured server", async () => {
    const seen = [];
    const fetchImpl = async (u, init) => {
      seen.push({ u: String(u), redirect: init.redirect });
      return new Response(null, { status: 308, headers: { location: "https://elsewhere.example/mcp" } });
    };
    const c = connect({ url: "https://t.example.com", key: "coding-key-0123456789abcdefghij", fetchImpl });
    await assert.rejects(() => c.call("rounds"), (e) => /redirect/.test(e.message) && /t\.example\.com/.test(e.message) && !/elsewhere/.test(e.message));
    assert.deepEqual(seen, [{ u: "https://t.example.com/mcp", redirect: "manual" }]);
    const d = tmp();
    mkdirSync(path.join(d, "briefs", "r1"), { recursive: true });
    writeFileSync(path.join(d, "briefs", "r1", "r1-01-a-b.md"), "# Brief\n");
    await assert.rejects(() => bundle(d, 1, { url: "https://t.example.com", fetchImpl }), /redirect/);
    assert.equal(seen.length, 2);
  });

  it("http:// is taken only for this computer; anywhere else is refused before anything is sent", async () => {
    let called = 0;
    const fetchImpl = async () => (called++, new Response("{}", { status: 200 }));
    assert.throws(() => connect({ url: "http://tester.example.com", key: "coding-key-0123456789abcdefghij", fetchImpl }), /Use https:\/\//);
    const d = tmp();
    mkdirSync(path.join(d, "briefs", "r1"), { recursive: true });
    writeFileSync(path.join(d, "briefs", "r1", "r1-01-a-b.md"), "# Brief\n");
    await assert.rejects(() => bundle(d, 1, { url: "http://tester.example.com", fetchImpl }), /Use https:\/\//);
    assert.equal(called, 0);
    for (const ok of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787", "https://tester.example.com"]) assert.doesNotThrow(() => connect({ url: ok, key: "coding-key-0123456789abcdefghij", fetchImpl }));
  });
});
