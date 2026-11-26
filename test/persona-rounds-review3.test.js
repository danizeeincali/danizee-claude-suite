import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/lib/persona/cli.js";
import { connect, bundle } from "../src/lib/persona/client.js";
import persona from "../src/plugins/persona.js";

const roots = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "persona-rr3-"));
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
  return { code: r.code, out, data, err };
}
const P = (cwd, ...f) => path.join(cwd, "persona-testing", ...f);
const json = (f) => JSON.parse(readFileSync(f, "utf8"));
const answer = (result) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
/** A body that sends its headers and then stalls until the request's time limit ends it. */
const stalledBody = (init) =>
  new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"jsonrpc":'));
        const alive = setTimeout(() => {}, 5000);
        init.signal.addEventListener("abort", () => (clearTimeout(alive), c.error(Object.assign(new Error("aborted"), { name: "TimeoutError" }))));
      },
    }),
    { status: 200 },
  );

describe("rounds review 3", () => {
  it("the installed cli runs in a project whose package.json says commonjs", async () => {
    const project = tmp();
    writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "cjs-project", type: "commonjs" }));
    const r = await persona.install(path.join(project, ".claude"));
    assert.ok(r.files.includes(path.join("helpers", "persona", "package.json")));
    assert.equal(json(path.join(project, ".claude", "helpers", "persona", "package.json")).type, "module");
    const run1 = spawnSync(process.execPath, [path.join(project, ".claude", "helpers", "persona", "cli.js"), "init"], { cwd: project, encoding: "utf8", env: { PATH: process.env.PATH } });
    assert.equal(run1.status, 0, run1.stderr);
    assert.equal(json(P(project, "project.json")).kind !== undefined, true);
  });

  it("a server that answers 'try again' during a replan of a published round is a refusal, never 'no reports'", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    assert.equal((await cli(cwd, ["plan", "--round", "1", "--walks", "3"])).code, 0);
    const rounds = json(P(cwd, "rounds.json"));
    rounds.rounds["1"].published = true;
    writeFileSync(P(cwd, "rounds.json"), JSON.stringify(rounds, null, 2));
    const before = readFileSync(P(cwd, "rounds.json"), "utf8");
    const fetchImpl = async (_u, init) => {
      const req = JSON.parse(init.body);
      if (req.method !== "tools/call") return answer({});
      return answer({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: "The tester store couldn't be read just now. Try again in a minute." }) }] });
    };
    const re = await cli(cwd, ["plan", "--round", "1", "--walks", "3", "--seed", "other", "--replan", "--url", "http://127.0.0.1:9"], { fetchImpl });
    assert.equal(re.code, 2);
    assert.match(re.err, /Try again in a minute/);
    assert.match(re.err, /--offline/);
    assert.equal(readFileSync(P(cwd, "rounds.json"), "utf8"), before);
  });

  it("a publish whose answer never arrives still leaves the round marked as published", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    await cli(cwd, ["plan", "--round", "1", "--walks", "2"]);
    const fetchImpl = async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    };
    const pub = await cli(cwd, ["publish", "--round", "1", "--url", "http://127.0.0.1:9"], { fetchImpl });
    assert.notEqual(pub.code, 0);
    assert.equal(json(P(cwd, "rounds.json")).rounds["1"].published, true);
  });

  it("an answer that stalls half way through its body is reported as slow, not as bad JSON", async () => {
    const c = connect({ url: "http://127.0.0.1:9", key: "coding-key-0123456789abcdefghij", timeoutMs: 30, fetchImpl: async (_u, init) => stalledBody(init) });
    await assert.rejects(() => c.call("rounds"), /did not answer within/);
    const d = tmp();
    mkdirSync(path.join(d, "briefs", "r1"), { recursive: true });
    writeFileSync(path.join(d, "briefs", "r1", "r1-01-a-b.md"), "# Brief\n");
    await assert.rejects(() => bundle(d, 1, { url: "http://127.0.0.1:9", timeoutMs: 30, fetchImpl: async (_u, init) => stalledBody(init) }), /did not answer within/);
  });
});
