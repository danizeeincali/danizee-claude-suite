import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/lib/persona/cli.js";
import { connect, publish } from "../src/lib/persona/client.js";
import { buildMarkdown } from "../src/lib/persona/deliver.js";
import { REPORT_TEMPLATE } from "../src/lib/persona/report-shape.js";

const roots = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "persona-rr2-"));
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
const keysOf = (cwd) => json(P(cwd, ".keys.json"));
async function tester(url, key, name, args) {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
  const res = await fetch(`${url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return JSON.parse((await res.json()).result.content[0].text);
}

describe("rounds review 2", () => {
  it("a replan whose briefs cannot be written changes nothing: rounds.json and briefs/ stay in step", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    const first = await cli(cwd, ["plan", "--round", "1", "--walks", "3"]);
    assert.equal(first.code, 0, first.err);
    const w = first.data.walks[0];
    mkdirSync(P(cwd, "reports"), { recursive: true });
    writeFileSync(P(cwd, "reports", `${w.id}.md`), REPORT_TEMPLATE(w.id, "the tester"));
    const project = json(P(cwd, "project.json"));
    project.personas = project.personas.filter((p) => p.id !== w.persona);
    project.jobs = project.jobs.map((j) => (Array.isArray(j.for) ? { ...j, for: j.for.filter((x) => x !== w.persona) } : j)).filter((j) => !Array.isArray(j.for) || j.for.length > 0);
    writeFileSync(P(cwd, "project.json"), JSON.stringify(project, null, 2));
    assert.equal((await cli(cwd, ["check"])).code, 0, "the edited project is still valid");
    const before = { rounds: readFileSync(P(cwd, "rounds.json"), "utf8"), briefs: readdirSync(P(cwd, "briefs", "r1")).sort() };
    const again = await cli(cwd, ["plan", "--round", "1", "--walks", "3", "--seed", "other", "--replan"]);
    assert.equal(again.code, 1);
    assert.match(again.err, /Round 1 was not changed/);
    assert.equal(readFileSync(P(cwd, "rounds.json"), "utf8"), before.rounds);
    assert.deepEqual(readdirSync(P(cwd, "briefs", "r1")).sort(), before.briefs);
  });

  it("replanning a published round keeps a walk the server accepted but nobody fetched; a server that is down is a refusal unless --offline", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    const first = await cli(cwd, ["plan", "--round", "1", "--walks", "3"]);
    const serve = await cli(cwd, ["serve", "--port", "0"]);
    const url = serve.server.url;
    const id = first.data.walks[1].id;
    try {
      assert.equal((await cli(cwd, ["publish", "--round", "1", "--url", url])).code, 0);
      assert.equal(json(P(cwd, "rounds.json")).rounds["1"].published, true);
      await tester(url, keysOf(cwd).tester_key, "start_walk", { id });
      assert.equal((await tester(url, keysOf(cwd).tester_key, "submit_report", { id, report: REPORT_TEMPLATE(id, "the tester") })).accepted, true);
      const re = await cli(cwd, ["plan", "--round", "1", "--walks", "3", "--seed", "other", "--replan", "--url", url]);
      assert.equal(re.code, 0, re.err);
      assert.ok(re.data.walks.some((w) => w.id === id), "the accepted walk is still in the round");
      assert.ok(readdirSync(P(cwd, "briefs", "r1")).includes(`${id}.md`));
      assert.equal(json(P(cwd, "rounds.json")).rounds["1"].published, true);
      assert.equal((await cli(cwd, ["publish", "--round", "1", "--url", url])).code, 0, "the replanned round can still be published");
    } finally {
      await serve.server.close();
    }
    const down = await cli(cwd, ["plan", "--round", "1", "--walks", "3", "--seed", "third", "--replan", "--url", url]);
    assert.equal(down.code, 1, "a server that cannot be reached is exit 1 in every verb; the replan still does not happen");
    assert.match(down.err, /--offline/);
    assert.equal((await cli(cwd, ["plan", "--round", "1", "--walks", "3", "--seed", "third", "--replan", "--offline"])).code, 0);
  });

  it("fetch still cuts secret_paths when project.json has a problem elsewhere, and worker refuses to write from a broken project", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    const project = json(P(cwd, "project.json"));
    project.not_a_key = true;
    writeFileSync(P(cwd, "project.json"), JSON.stringify(project));
    assert.equal((await cli(cwd, ["check"])).code, 1);
    const answer = (result) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
    const fetchImpl = async (_url, init) => {
      const req = JSON.parse(init.body);
      if (req.method !== "tools/call") return answer({});
      const data = req.params.name === "list_reports" ? { walks: [{ id: "r1-01-a-b", status: "accepted" }] } : { report: `Opened https://x.example${project.secret_paths[0]}?token=abc123 then left.` };
      return answer({ content: [{ type: "text", text: JSON.stringify(data) }] });
    };
    const f = await cli(cwd, ["fetch", "--round", "1", "--url", "http://127.0.0.1:9"], { fetchImpl });
    assert.equal(f.code, 0, f.err);
    assert.doesNotMatch(readFileSync(P(cwd, "reports", "r1-01-a-b.md"), "utf8"), /abc123/);
    const w = await cli(cwd, ["worker", "--out", "w"]);
    assert.equal(w.code, 1);
    assert.match(w.err, /The Worker was not written/);
  });

  it("an unreadable clock file is not counted or worded as an unreadable report", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    const plan = await cli(cwd, ["plan", "--round", "1", "--walks", "2"]);
    mkdirSync(P(cwd, "reports"), { recursive: true });
    for (const w of plan.data.walks) writeFileSync(P(cwd, "reports", `${w.id}.md`), REPORT_TEMPLATE(w.id, "the tester"));
    writeFileSync(P(cwd, "clock-r1.json"), "{ not json");
    const rd = await cli(cwd, ["read", "--round", "1"]);
    assert.equal(rd.code, 0, rd.err);
    assert.equal(rd.data.reports, 2);
    assert.equal(rd.data.unreadable, 0);
    assert.deepEqual(rd.data.other_files_unreadable, ["clock-r1.json"]);
    const dl = await cli(cwd, ["deliver", "--round", "1"]);
    assert.equal(dl.code, 0, dl.err);
    const all = readdirSync(P(cwd)).filter((f) => /r1/.test(f) && /\.(md|json)$/.test(f) && !f.startsWith("clock")).map((f) => readFileSync(P(cwd, f), "utf8")).join("\n");
    assert.doesNotMatch(all, /\d+ reports? could not be read/);
    assert.match(all, /clock-r1\.json could not be read/);
    assert.match(all, /Every tester handed in a report\./);

    // A pick of the "Nothing to decide" card on a round with no findings is not a mismatch.
    const result = { ...json(P(cwd, "findings-r1.json")), findings: [] };
    const md = buildMarkdown(result, { decided: [{ id: "no-findings", title: "Nothing to decide this round", choice: "ok", note: "" }], undecided: [], byChoice: {}, problems: [], collection: "c" });
    assert.doesNotMatch(md, /did not match/);
    assert.match(md, /Nothing to decide this round/);
  });

  it("no transport message prints more than the server's origin, and a connector.json url that holds a key is refused", async () => {
    const KEY = "tester-key-0123456789abcdefghij";
    const url = `http://user:${KEY}@127.0.0.1:9/k/${KEY}`;
    const notFound = connect({ url, key: "coding-key-0123456789abcdefghij", fetchImpl: async () => new Response("no", { status: 404 }) });
    await assert.rejects(() => notFound.call("rounds"), (e) => !e.message.includes(KEY) && /127\.0\.0\.1:9/.test(e.message));
    const slow = connect({ url, key: "coding-key-0123456789abcdefghij", timeoutMs: 20, fetchImpl: (_u, init) =>
        new Promise((_r, rej) => {
          const alive = setTimeout(() => {}, 5000); // AbortSignal.timeout does not hold the event loop open
          init.signal.addEventListener("abort", () => (clearTimeout(alive), rej(Object.assign(new Error("aborted"), { name: "TimeoutError" }))));
        }),
    });
    await assert.rejects(() => slow.call("rounds"), (e) => !e.message.includes(KEY) && /did not answer/.test(e.message));
    const cwd = tmp();
    await cli(cwd, ["init"]);
    writeFileSync(P(cwd, "connector.json"), JSON.stringify({ url: `https://t.example/k/${KEY}/mcp` }));
    const st = await cli(cwd, ["status"]);
    assert.equal(st.code, 1);
    assert.match(st.err, /holds a key/);
    assert.ok(!st.err.includes(KEY));
  });

  it("a round whose JSON body would pass 2 MB is told to split before it is sent, and a 413 says the same", async () => {
    const d = tmp();
    mkdirSync(path.join(d, "briefs", "r1"), { recursive: true });
    writeFileSync(path.join(d, "briefs", "r1", "r1-01-a-b.md"), "\n".repeat(1_200_000));
    let called = 0;
    const conn = { call: async () => (called++, {}) };
    await assert.rejects(() => publish(d, 1, conn), /split the round/);
    assert.equal(called, 0);
    const c = connect({ url: "http://127.0.0.1:9", key: "coding-key-0123456789abcdefghij", fetchImpl: async () => new Response("", { status: 413 }) });
    await assert.rejects(() => c.call("rounds"), /split the round/);
  });
});
