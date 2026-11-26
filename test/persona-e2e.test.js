/**
 * End to end, the way a person uses it: init, plan, serve, publish, a scripted tester over HTTP, a side round, then
 * fetch, read and deliver. The CLI runs as child processes; the tester is plain fetch with the tester key.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPORT_TEMPLATE } from "../src/lib/persona/report-shape.js";
import { check as deckCheck } from "../src/lib/kit/decision-deck.js";

const CLI = new URL("../src/lib/persona/cli.js", import.meta.url).pathname;
const cwd = mkdtempSync(path.join(tmpdir(), "persona-e2e-"));
const dir = path.join(cwd, "persona-testing");
const outputs = [];
let child;
let url;

/** One CLI call as a child process. */
function cli(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH } });
  outputs.push(r.stdout, r.stderr);
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    // not JSON
  }
  return { code: r.status, json, out: r.stdout, err: r.stderr };
}
const keys = () => JSON.parse(readFileSync(path.join(dir, ".keys.json"), "utf8"));

/** A tester tool call: plain JSON-RPC over fetch with the tester key. */
async function tester(tool, args = {}) {
  const res = await fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${keys().tester_key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }) });
  assert.equal(res.status, 200);
  const r = (await res.json()).result;
  return { isError: r.isError === true, data: JSON.parse(r.content[0].text) };
}

/** A report built from the template with its own findings; `known` adds a "known:" note line. */
function reportFor(id, findings, { known = null } = {}) {
  const text = REPORT_TEMPLATE(id, "Scripted tester");
  const m = /```json\n([\s\S]*?)\n```/.exec(text);
  const obj = JSON.parse(m[1]);
  obj.findings = findings.map((f, i) => ({ ...obj.findings[0], n: i + 1, ...f }));
  const notes = known ? `## Notes\nknown: ${known}\nThe rest went as expected.\n` : "## Notes\nNothing more.\n";
  return `# Report ${id}\n\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n\n${notes}`;
}

before(async () => {
  assert.equal(cli("init", "--product", "Tillbook").code, 0);
  assert.equal(cli("plan", "--round", "1", "--walks", "3").code, 0);
  child = spawn(process.execPath, [CLI, "serve", "--port", "0"], { cwd, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
  const line = await new Promise((resolve, reject) => {
    let buf = "";
    child.stdout.on("data", (c) => {
      buf += c;
      if (buf.includes("}\n")) resolve(buf);
    });
    child.once("exit", () => reject(new Error(`serve exited: ${buf}`)));
  });
  outputs.push(line);
  url = JSON.parse(line).url;
  writeFileSync(path.join(dir, "connector.json"), `${JSON.stringify({ url, product: "Tillbook" })}\n`);
});

after(async () => {
  if (child) {
    child.kill("SIGTERM");
    await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)));
  }
  rmSync(cwd, { recursive: true, force: true });
});

describe("persona testing end to end", () => {
  let round1 = [];

  it("publishes round 1 and a tester with only the tester key sees notes, the guide and the first walk", async () => {
    const pub = cli("publish", "--round", "1");
    assert.equal(pub.code, 0, pub.err);
    assert.equal(pub.json.briefs, 3);
    assert.equal(cli("note", "Start with the first brief please.", "--round", "1").code, 0);
    const notes = await tester("notes");
    assert.equal(notes.data.open_walks, 3);
    assert.equal(notes.data.notes[0].text, "Start with the first brief please.");
    assert.match((await tester("guide")).data.guide, /```json/);
    const next = await tester("next_walk");
    assert.equal(next.data.round, 1);
    assert.match(next.data.brief, /^# Brief r1-01-/);
    round1 = JSON.parse(readFileSync(path.join(dir, "rounds.json"), "utf8")).rounds["1"].walks.map((w) => w.id);
    assert.equal(round1.length, 3);
    assert.equal(next.data.id, round1[0]);
  });

  it("a tester cannot publish, and a report for an unstarted walk is refused", async () => {
    assert.equal((await tester("publish_round", { round: 9, briefs: [{ id: "r9-01-a", brief: "x" }] })).isError, true);
    const early = await tester("submit_report", { id: round1[0], report: reportFor(round1[0], [{ title: "Early" }]) });
    assert.ok(early.isError || early.data.accepted === false, JSON.stringify(early.data));
  });

  it("hands in a rejected report first, then accepted reports for all three walks, one with a known: note", async () => {
    const shared = "The save button does nothing after the second tap";
    const finding = [
      [{ title: shared, severity: "blocker" }, { title: "Prices lose their cents on the report page", severity: "confusing" }],
      [{ title: shared, severity: "blocker" }],
      [{ title: "Nothing says what a draft order is", severity: "rough" }],
    ];
    for (let i = 0; i < 3; i++) {
      const id = round1[i];
      assert.equal((await tester("start_walk", { id })).data.id, id);
      if (i === 0) {
        const bad = await tester("submit_report", { id, report: "no json here" });
        assert.equal(bad.data.accepted, false);
        assert.ok(bad.data.problems.length > 0);
      }
      const ok = await tester("submit_report", { id, report: reportFor(id, finding[i], { known: i === 1 ? "Importing stock shows a spinner for a while." : null }) });
      assert.equal(ok.data.accepted, true, JSON.stringify(ok.data));
    }
    assert.equal((await tester("notes")).data.open_walks, 0);
    assert.equal((await tester("next_walk")).data.done, true);
  });

  it("marks what is being fixed, lists a known thing, plans a side round, publishes it, and next_walk serves round 2", async () => {
    assert.equal(cli("fixing", "set", "setup,billing").code, 0);
    const k = cli("known", "add", "The first screen guesses the currency.", "--instead", "Leave it and carry on.", "--area", "setup");
    assert.equal(k.code, 0, k.err);
    const plan = cli("plan", "--round", "2", "--side", "--walks", "2");
    assert.equal(plan.code, 0, plan.err);
    assert.equal(plan.json.kind, "side");
    assert.deepEqual(plan.json.avoid, ["setup", "billing"]);
    assert.ok(!plan.json.walks.some((w) => w.jobs.includes("supplier-order")));
    const brief = readFileSync(path.join(dir, "briefs", "r2", `${plan.json.walks[0].id}.md`), "utf8");
    assert.match(brief, /This is a side walk/);
    assert.equal(cli("publish", "--round", "2").code, 0);
    const next = await tester("next_walk");
    assert.equal(next.data.round, 2);
    assert.equal(next.data.id, plan.json.walks[0].id);
  });

  it("fetches round 1, reads it and delivers a deck that passes decision-deck check and a findings file with merged findings and known things met", () => {
    const f = cli("fetch", "--round", "1");
    assert.equal(f.code, 0, f.err);
    assert.deepEqual(f.json.fetched.sort(), [...round1].sort());
    assert.deepEqual(f.json.missing, []);
    for (const id of round1) assert.ok(existsSync(path.join(dir, "reports", `${id}.md`)));
    assert.ok(existsSync(path.join(dir, "clock-r1.json")));

    // Reports were just fetched: the reader waits out the 15 seconds a file may still be written.
    const old = new Date(Date.now() - 60_000);
    for (const id of round1) spawnSync("touch", ["-d", old.toISOString(), path.join(dir, "reports", `${id}.md`)]);
    const rd = cli("read", "--round", "1");
    assert.equal(rd.code, 0, rd.err);
    assert.equal(rd.json.reports, 3);
    assert.equal(rd.json.known_met, 1);
    const findings = JSON.parse(readFileSync(path.join(dir, "findings-r1.json"), "utf8"));
    assert.equal(findings.findings.length, 3, "four findings from three walks, two of them the same, make three");
    assert.ok(findings.findings.every((x) => /^f-[0-9a-f]{8}$/.test(x.id)));

    const dl = cli("deliver", "--round", "1");
    assert.equal(dl.code, 0, dl.err);
    const deck = JSON.parse(readFileSync(path.join(cwd, dl.json.deck), "utf8"));
    const checked = deckCheck(deck);
    assert.equal(checked.ok, true, JSON.stringify(checked.problems));
    assert.equal(deck.cards.length, 3);
    const md = readFileSync(path.join(cwd, dl.json.markdown), "utf8");
    assert.match(md, /The save button does nothing after the second tap/);
    assert.match(md, /Prices lose their cents on the report page/);
    assert.match(md, /Known things met/);
    assert.match(md, /Importing stock shows a spinner for a while/);
  });

  it("no key appears in any file but .keys.json, or in anything the CLI or the server printed", () => {
    const k = keys();
    const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of files(cwd)) {
      if (path.basename(f) === ".keys.json") continue;
      const b = readFileSync(f);
      assert.ok(!b.includes(k.tester_key) && !b.includes(k.coding_key), `${path.relative(cwd, f)} holds a key`);
    }
    for (const o of outputs) assert.ok(!String(o).includes(k.tester_key) && !String(o).includes(k.coding_key));
    assert.match(readFileSync(path.join(cwd, ".gitignore"), "utf8"), /persona-testing\/\.keys\.json/);
  });
});
