/** Review round 1 of the tester connector: each test is one finding, proved. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/lib/persona/sqlite.js";
import { REPORT_TEMPLATE, parseReport, stripFragments, submissionProblems } from "../src/lib/persona/report-shape.js";
import { runScript } from "../src/lib/persona/serve.js";
import { call, published } from "./helpers/persona-fixtures.js";

const SECRET = ["/private/sign-in"];
const T = { role: "tester", secretPaths: SECRET };

describe("a secret path inside the report's JSON", () => {
  for (const pretty of [true, false]) {
    it(`an accepted report is stored readable (${pretty ? "pretty" : "compact"} json)`, async () => {
      const db = await published(openStore());
      const id = "r1-01-florist";
      let text = REPORT_TEMPLATE(id).replace('"https://app.example.com/"', '"https://app.example.com/private/sign-in/abc123"');
      if (!pretty) text = text.replace(/```json\n([\s\S]*?)\n```/, (m, j) => "```json\n" + JSON.stringify(JSON.parse(j)) + "\n```");
      assert.match(text, /private\/sign-in\/abc123/);
      await call(db, "start_walk", { id }, T);
      const r = await call(db, "submit_report", { id, report: text }, T);
      assert.equal(r.data.accepted, true, JSON.stringify(r.data));
      const got = (await call(db, "get_report", { id })).data;
      assert.doesNotMatch(got.report, /abc123/);
      assert.deepEqual(submissionProblems(got.report, id, { secretPaths: SECRET }).problems, []);
      const parsed = parseReport(got.report);
      assert.equal(parsed.screens[0].address, "https://app.example.com/private/sign-in");
      assert.equal(parsed.screens[0].saw, 1);
    });
  }

  it("the path rule stops at a quote, a bracket or whitespace and keeps what follows", () => {
    assert.equal(stripFragments('{"a":"/private/sign-in/k1","b":2}', { secretPaths: SECRET }), '{"a":"/private/sign-in","b":2}');
    assert.equal(stripFragments("(see /private/sign-in/k1) next", { secretPaths: SECRET }), "(see /private/sign-in) next");
  });

  it("what is stored for an accepted report passes the same checker", async () => {
    const db = await published(openStore());
    const id = "r1-01-florist";
    const text = REPORT_TEMPLATE(id);
    await call(db, "start_walk", { id }, T);
    const r = await call(db, "submit_report", { id, report: text }, T);
    assert.equal(r.data.accepted, true);
    const row = db.raw.prepare("SELECT body, status FROM persona_reports WHERE walk_id = ?").get(id);
    assert.deepEqual(submissionProblems(row.body, id, { secretPaths: SECRET }).problems, []);
  });
});

describe("a guide is stored the same way however it arrives", () => {
  it("publish_round strips its guide as a bundle's guide is stripped", async () => {
    const db = openStore();
    await call(db, "publish_round", { round: 1, guide: "Sign in at https://app.example.com/private/sign-in/abc123 then walk.", briefs: [{ id: "r1-01-a", brief: "b" }] }, { secretPaths: SECRET });
    const g = (await call(db, "guide", {}, { role: "tester" })).data.guide;
    assert.equal(g, "Sign in at https://app.example.com/private/sign-in then walk.");
  });
});

describe("the local server's script", () => {
  const env = { PERSONA_TESTER_KEY: "t".repeat(32), PERSONA_CODING_KEY: "c".repeat(32) };
  async function started(argv, extra = {}) {
    const lines = [];
    const server = await runScript(["--port", "0", ...argv], { ...env, ...extra }, (l) => lines.push(l));
    return { server, line: JSON.parse(lines[0]) };
  }
  const rpc = (url, key, name, args) =>
    fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })
      .then((r) => r.json())
      .then((j) => JSON.parse(j.result.content[0].text));

  for (const [how, argv, extra] of [["PERSONA_SECRET_PATHS", [], { PERSONA_SECRET_PATHS: " /private/sign-in , " }], ["--secret-paths", ["--secret-paths", "/private/sign-in"], {}]]) {
    it(`strips the project's secret paths given by ${how}`, async () => {
      const { server, line } = await started(argv, extra);
      try {
        await rpc(line.url, env.PERSONA_CODING_KEY, "post_note", { text: "Use https://app.example.com/private/sign-in/abc123 today" });
        const notes = await rpc(line.url, env.PERSONA_TESTER_KEY, "notes", {});
        assert.equal(notes.notes[0].text, "Use https://app.example.com/private/sign-in today");
      } finally {
        await server.close();
      }
    });
  }

  it("says where reports are kept, and that nothing is kept without --db", async () => {
    const { server, line } = await started([]);
    await server.close();
    assert.match(line.store, /nothing is kept/);
    assert.doesNotMatch(JSON.stringify(line), /t{32}|c{32}/);
  });
});
