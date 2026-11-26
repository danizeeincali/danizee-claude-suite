import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "../src/lib/persona/serve.js";
import { connect, publish, fetchReports, bundle, MAX_PUBLISH_BYTES } from "../src/lib/persona/client.js";
import { REPORT_TEMPLATE } from "../src/lib/persona/report-shape.js";

const TESTER = "tester-key-0123456789abcdefghij";
const CODING = "coding-key-0123456789abcdefghij";
const tmp = () => mkdtempSync(path.join(tmpdir(), "persona-client-"));

function roundFolder(dir, round, ids, guide = "The guide.") {
  const f = path.join(dir, "briefs", `r${round}`);
  mkdirSync(f, { recursive: true });
  for (const id of ids) writeFileSync(path.join(f, `${id}.md`), `# Brief ${id}\n\nWalk it.\n`);
  writeFileSync(path.join(f, "guide.md"), guide);
}

describe("persona client against a real server", () => {
  let server;
  let dirs = [];
  before(async () => {
    server = await startServer({ port: 0, testerKey: TESTER, codingKey: CODING, product: "Acme" });
  });
  after(async () => {
    await server.close();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const dir = () => {
    const d = tmp();
    dirs.push(d);
    return d;
  };
  const coding = () => connect({ url: server.url, key: CODING });
  const tester = () => connect({ url: server.url, key: TESTER });

  it("calls a tool and returns its parsed answer", async () => {
    const r = await coding().call("rounds", {});
    assert.deepEqual(r, { rounds: [] });
  });

  it("turns a refusal into an Error with the server's words", async () => {
    await assert.rejects(() => tester().call("publish_round", { round: 1, briefs: [{ id: "r1-01-a", brief: "x" }] }), /coding thread/);
  });

  it("says in one sentence that a wrong key was refused", async () => {
    await assert.rejects(() => connect({ url: server.url, key: "wrong-wrong-wrong-wrong-wrong" }).call("rounds"), /key/i);
  });

  it("says where it could not reach", async () => {
    await assert.rejects(() => connect({ url: "http://127.0.0.1:1", key: CODING }).call("rounds"), /Could not reach http:\/\/127\.0\.0\.1:1/);
  });

  it("publishes a round's briefs and guide, and fetches accepted reports and the clock", async () => {
    const d = dir();
    roundFolder(d, 3, ["r3-01-a-b", "r3-02-c-d"], "Guide three.");
    const pub = await publish(d, 3, coding());
    assert.equal(pub.briefs, 2);
    const t = tester();
    assert.equal((await t.call("guide", { round: 3 })).guide, "Guide three.");
    await t.call("start_walk", { id: "r3-01-a-b" });
    const report = REPORT_TEMPLATE("r3-01-a-b");
    const sub = await t.call("submit_report", { id: "r3-01-a-b", report });
    assert.equal(sub.accepted, true);
    const got = await fetchReports(d, 3, coding());
    assert.deepEqual(got.fetched, ["r3-01-a-b"]);
    assert.deepEqual(got.missing, ["r3-02-c-d"]);
    assert.equal(readFileSync(path.join(d, "reports", "r3-01-a-b.md"), "utf8"), report);
    assert.ok(!existsSync(path.join(d, "reports", "r3-02-c-d.md")));
    const clock = JSON.parse(readFileSync(path.join(d, "clock-r3.json"), "utf8"));
    assert.equal(clock.walks[0].id, "r3-01-a-b");
    assert.equal(typeof clock.walks[0].clock_minutes, "number");
  });

  it("refuses to publish a round with no briefs, and one over 2 MB, with a sentence", async () => {
    const d = dir();
    await assert.rejects(() => publish(d, 1, coding()), /No briefs for round 1/);
    roundFolder(d, 1, ["r1-01-a-b"]);
    writeFileSync(path.join(d, "briefs", "r1", "r1-01-a-b.md"), "x".repeat(MAX_PUBLISH_BYTES + 1));
    await assert.rejects(() => publish(d, 1, coding()), /split the round/);
  });

  it("bundle posts the round to /bundle with no key and answers the code", async () => {
    const d = dir();
    roundFolder(d, 4, ["r4-01-a-b"], "G4");
    const { code } = await bundle(d, 4, { url: server.url });
    assert.match(code, /^[a-z2-9]{10}$/);
    const pub = await coding().call("publish_round", { round: 4, bundle: code });
    assert.equal(pub.briefs, 1);
  });

  it("uses an injected fetch and times out", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, JSON.parse(init.body).method]);
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: body.method === "tools/call" ? { content: [{ type: "text", text: JSON.stringify({ ok: 1 }) }] } : {} }), { status: 200 });
    };
    const c = connect({ url: "https://x.test/", key: "k".repeat(24), fetchImpl });
    assert.deepEqual(await c.call("rounds"), { ok: 1 });
    await c.call("rounds");
    assert.equal(calls.filter((x) => x[1] === "initialize").length, 1);
    assert.equal(calls[0][0], "https://x.test/mcp");
    const slow = connect({ url: "https://x.test", key: "k".repeat(24), timeoutMs: 20, fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))) });
    await assert.rejects(() => slow.call("rounds"), /did not answer/);
  });
});
