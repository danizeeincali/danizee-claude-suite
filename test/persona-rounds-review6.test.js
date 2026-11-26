import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/lib/persona/cli.js";
import { bundle, connect, publish } from "../src/lib/persona/client.js";

const roots = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "persona-rr6-"));
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

describe("rounds review 6", () => {
  it("a side brief keeps the tester out of the parts being fixed only, never out of everything on the known list", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    await cli(cwd, ["fixing", "set", "setup,billing"]);
    const plan = await cli(cwd, ["plan", "--round", "2", "--side"]);
    assert.equal(plan.code, 0, plan.err);
    for (const w of plan.data.walks) {
      const brief = readFileSync(P(cwd, "briefs", "r2", `${w.id}.md`), "utf8");
      assert.match(brief, /Keep to the jobs below and stay out of the parts being fixed: setup, billing\./);
      assert.doesNotMatch(brief, /do not wander into the parts on the "already known" list/);
    }
    const guide = readFileSync(P(cwd, "briefs", "r2", "guide.md"), "utf8");
    assert.match(guide, /Each brief lists the things already known; the ones in the parts being fixed come first\./);
    assert.doesNotMatch(guide, /every walk resets it|the ones the brief lists/);
  });

  it("a server that answers no to a bundle, or a round too large to send, is a refusal (exit 2)", async () => {
    const d = tmp();
    mkdirSync(path.join(d, "briefs", "r1"), { recursive: true });
    writeFileSync(path.join(d, "briefs", "r1", "r1-01-a-b.md"), "# Brief\n");
    for (const status of [429, 400, 413]) await assert.rejects(() => bundle(d, 1, { url: "https://t.example.com", fetchImpl: async () => new Response("{}", { status }) }), (e) => e.refused === true, String(status));
    await assert.rejects(() => bundle(d, 1, { url: "https://t.example.com", fetchImpl: async () => new Response("{}", { status: 500 }) }), (e) => e.refused !== true);
    const c = connect({ url: "https://t.example.com", key: "coding-key-0123456789abcdefghij", fetchImpl: async () => new Response("", { status: 413 }) });
    await assert.rejects(() => c.call("rounds"), (e) => e.refused === true);
    writeFileSync(path.join(d, "briefs", "r1", "r1-01-a-b.md"), "\n".repeat(1_200_000));
    await assert.rejects(() => publish(d, 1, { call: async () => ({}) }), (e) => e.refused === true && /split the round/.test(e.message));

    const cwd = tmp();
    await cli(cwd, ["init"]);
    await cli(cwd, ["plan", "--round", "1", "--walks", "1"]);
    const r = await cli(cwd, ["bundle", "--round", "1", "--url", "https://t.example.com"], { fetchImpl: async () => new Response("{}", { status: 429 }) });
    assert.equal(r.code, 2);
    assert.match(r.err, /only a few bundles an hour/);
  });

  it("fetch of a planned round that was never published lists every planned walk as missing and says to publish", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    const plan = await cli(cwd, ["plan", "--round", "1", "--walks", "3"]);
    const serve = await cli(cwd, ["serve", "--port", "0"]);
    try {
      const f = await cli(cwd, ["fetch", "--round", "1", "--url", serve.server.url]);
      assert.equal(f.code, 0, f.err);
      assert.deepEqual(f.data.fetched, []);
      assert.deepEqual([...f.data.missing].sort(), plan.data.walks.map((w) => w.id).sort());
      assert.match(f.data.next, /3 planned walks are not on the server: run publish --round 1/);
      await cli(cwd, ["publish", "--round", "1", "--url", serve.server.url]);
      const g = await cli(cwd, ["fetch", "--round", "1", "--url", serve.server.url]);
      assert.equal(g.data.missing.length, 3);
      assert.equal(g.data.next, undefined);
    } finally {
      await serve.server.close();
    }
  });
});

import { buildDeck } from "../src/lib/persona/deliver.js";
describe("rounds review 6: deck words", () => {
  it("a median is called the median, never 'the middle walk', and findings left off the deck are 'more', never 'smaller'", () => {
    const src = readFileSync(new URL("../src/lib/persona/deliver.js", import.meta.url), "utf8");
    assert.doesNotMatch(src, /middle walk/);
    assert.match(src, /That is the median of the walks\./);
    assert.doesNotMatch(src, /smaller \$\{/);
    assert.equal(typeof buildDeck, "function");
  });
});
