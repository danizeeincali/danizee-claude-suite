import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/lib/persona/cli.js";
import { fetchReports } from "../src/lib/persona/client.js";
import { writeAtomic } from "../src/lib/persona/fsx.js";
import { REPORT_TEMPLATE } from "../src/lib/persona/report-shape.js";

const roots = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "persona-rr1-"));
  roots.push(d);
  return d;
};
after(() => roots.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function cli(cwd, args) {
  let out = "";
  let err = "";
  const r = await run(args, { cwd, env: { PATH: process.env.PATH }, out: (s) => (out += s), err: (s) => (err += s) });
  let data = null;
  try {
    data = JSON.parse(out);
  } catch {
    // not JSON
  }
  return { code: r.code, out, data, err, server: r.server };
}
const projectOf = (cwd) => JSON.parse(readFileSync(path.join(cwd, "persona-testing", "project.json"), "utf8"));

describe("rounds review 1", () => {
  it("read straight after fetch reads every report: nothing is skipped as still being written", async () => {
    const cwd = tmp();
    assert.equal((await cli(cwd, ["init"])).code, 0);
    const plan = await cli(cwd, ["plan", "--round", "1", "--walks", "2"]);
    assert.equal(plan.code, 0, plan.err);
    const serve = await cli(cwd, ["serve", "--port", "0"]);
    try {
      const url = serve.server.url;
      assert.equal((await cli(cwd, ["publish", "--round", "1", "--url", url])).code, 0);
      const keys = JSON.parse(readFileSync(path.join(cwd, "persona-testing", ".keys.json"), "utf8"));
      const ids = plan.data.walks.map((w) => w.id);
      for (const id of ids) {
        const tool = async (name, args) => {
          const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
          const res = await fetch(`${url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${keys.tester_key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
          return JSON.parse((await res.json()).result.content[0].text);
        };
        await tool("start_walk", { id });
        const sub = await tool("submit_report", { id, report: REPORT_TEMPLATE(id, "the tester") });
        assert.equal(sub.accepted, true, JSON.stringify(sub));
      }
      const f = await cli(cwd, ["fetch", "--round", "1", "--url", url]);
      assert.equal(f.code, 0, f.err);
      assert.equal(f.data.fetched.length, ids.length);
      const rd = await cli(cwd, ["read", "--round", "1"]);
      assert.equal(rd.code, 0, rd.err);
      assert.equal(rd.data.reports, ids.length);
      const findings = JSON.parse(readFileSync(path.join(cwd, "persona-testing", "findings-r1.json"), "utf8"));
      assert.deepEqual(findings.unreadable, []);
    } finally {
      await serve.server.close();
    }
  });

  it("fetch cuts sign-in paths from a report before it is written, whatever the server kept", async () => {
    const d = tmp();
    const report = "Went to https://shop.example/sign-in/tester?token=abc123 and https://shop.example/page#frag-secret then on.";
    const conn = {
      async call(name) {
        if (name === "list_reports") return { walks: [{ id: "r1-01-a-b", status: "accepted" }] };
        return { report };
      },
    };
    await fetchReports(d, 1, conn, { secretPaths: ["/sign-in/tester"] });
    const text = readFileSync(path.join(d, "reports", "r1-01-a-b.md"), "utf8");
    assert.doesNotMatch(text, /abc123|token=|frag-secret/);
    assert.match(text, /then on\./);
  });

  it("the generated Worker carries the project's secret paths in wrangler.toml, with no setup step to forget", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    const r = await cli(cwd, ["worker", "--out", "w"]);
    assert.equal(r.code, 0, r.err);
    const toml = readFileSync(path.join(cwd, "w", "wrangler.toml"), "utf8");
    assert.match(toml, new RegExp(`PERSONA_SECRET_PATHS = "${projectOf(cwd).secret_paths.join(",")}"`));
    assert.doesNotMatch(readFileSync(path.join(cwd, "w", "README.md"), "utf8"), /Optional/);
  });

  it(".keys.json is created 0600 and writeAtomic's temp file never has a wider mode", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    assert.equal(statSync(path.join(cwd, "persona-testing", ".keys.json")).mode & 0o777, 0o600);
    const d = tmp();
    let seen = null;
    const old = process.umask(0o022);
    try {
      writeAtomic(path.join(d, "k.json"), "{}", {
        mode: 0o600,
        beforeRename: () => {
          const t = readdirTmp(d);
          seen = statSync(path.join(d, t)).mode & 0o777;
        },
      });
    } finally {
      process.umask(old);
    }
    assert.equal(seen, 0o600);
  });

  it("fixing set takes areas split by commas, spaces or both", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    assert.deepEqual((await cli(cwd, ["fixing", "set", "stock,", "reports"])).data.fixing, ["stock", "reports"]);
    assert.deepEqual((await cli(cwd, ["fixing", "set", "stock", "reports"])).data.fixing, ["stock", "reports"]);
    assert.deepEqual(projectOf(cwd).fixing, ["stock", "reports"]);
  });

  it("the shortcut table row has no bare pipe inside a cell, and the changelog has one Added heading for 4.9.0", () => {
    const root = new URL("..", import.meta.url).pathname;
    for (const f of ["WORKFLOW-SHORTCUTS.md", "src/utils/shortcuts.js"]) {
      const row = readFileSync(path.join(root, f), "utf8").split("\n").find((l) => l.includes("/w-persona-test ["));
      assert.ok(row, f);
      assert.doesNotMatch(row.match(/`[^`]*w-persona-test[^`]*`/)[0], /\|/);
    }
    const log = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    const section = log.slice(log.indexOf("## 4.9.0"), log.indexOf("## 4.8.0"));
    assert.equal(section.split("### Added").length - 1, 1);
  });
});

function readdirTmp(d) {
  const names = readdirSync(d).filter((n) => n.endsWith(".tmp"));
  assert.equal(names.length, 1);
  return names[0];
}
