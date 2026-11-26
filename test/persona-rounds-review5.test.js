import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/lib/persona/cli.js";
import { buildMarkdown } from "../src/lib/persona/deliver.js";
import { REPORT_TEMPLATE, parseReport } from "../src/lib/persona/report-shape.js";
import { renderGuide } from "../src/lib/persona/brief.js";
import { EXAMPLE_PROJECT } from "../src/lib/persona/project.js";

const ROOT = new URL("..", import.meta.url).pathname;
const roots = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "persona-rr5-"));
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
const kit = (cwd, args, input) => spawnSync(process.execPath, [path.join(ROOT, "src", "lib", "kit", "cli.js"), ...args], { cwd, encoding: "utf8", input });

describe("rounds review 5", () => {
  it("the deck lines in the command file run as written: emit with --file and --out, read with --deck and --file", async () => {
    const doc = readFileSync(path.join(ROOT, ".claude", "commands", ".shortcuts", "w-persona-test.md"), "utf8");
    assert.match(doc, /decision-deck emit --file persona-testing\/deck-r<n>\.json --out <page>\.html/);
    assert.match(doc, /decision-deck read --deck persona-testing\/deck-r<n>\.json --file <the copied text> > picks\.json/);
    const cwd = tmp();
    await cli(cwd, ["init"]);
    const plan = await cli(cwd, ["plan", "--round", "1", "--walks", "1"]);
    mkdirSync(P(cwd, "reports"), { recursive: true });
    for (const w of plan.data.walks) writeFileSync(P(cwd, "reports", `${w.id}.md`), REPORT_TEMPLATE(w.id, "the tester"));
    const rd = await cli(cwd, ["read", "--round", "1"]);
    assert.equal(rd.data.file, path.join("persona-testing", "findings-r1.json"));
    assert.ok(existsSync(path.join(cwd, rd.data.file)), "read names its file from the working folder, as deliver does");
    assert.equal((await cli(cwd, ["deliver", "--round", "1"])).code, 0);
    const emit = kit(cwd, ["decision-deck", "emit", "--file", "persona-testing/deck-r1.json", "--out", "page.html"]);
    assert.equal(emit.status, 0, emit.stderr);
    writeFileSync(path.join(cwd, "copied.txt"), "");
    const read = kit(cwd, ["decision-deck", "read", "--deck", "persona-testing/deck-r1.json", "--file", "copied.txt"]);
    assert.doesNotMatch(read.stderr, /needs --deck|needs --file|Unknown/);
  });

  it("a round number that is nowhere is said in one sentence (exit 1), never 'no findings'", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    await cli(cwd, ["plan", "--round", "1", "--walks", "1"]);
    const rd = await cli(cwd, ["read", "--round", "5"]);
    assert.equal(rd.code, 1);
    assert.match(rd.err, /Round 5 is not planned here/);
    assert.ok(!existsSync(P(cwd, "findings-r5.json")));
    const serve = await cli(cwd, ["serve", "--port", "0"]);
    try {
      const url = serve.server.url;
      for (const verb of ["fetch", "status"]) {
        const r = await cli(cwd, [verb, "--round", "5", "--url", url]);
        assert.equal(r.code, 1, verb);
        assert.match(r.err, /Round 5 is not planned here/);
      }
      assert.ok(!existsSync(P(cwd, "clock-r5.json")));
      assert.equal((await cli(cwd, ["status", "--url", url])).code, 0);
    } finally {
      await serve.server.close();
    }
  });

  it("the README gives the same Node floor for serve as the store's own message", () => {
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    assert.match(readme, /needs Node 22\.13 or newer/);
    assert.doesNotMatch(readme, /needs Node 22\.5 or newer/);
  });

  it("the replan refusal names --replan, and a replan of a published round says to publish again", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    await cli(cwd, ["plan", "--round", "1", "--walks", "2"]);
    const no = await cli(cwd, ["plan", "--round", "1", "--walks", "2", "--seed", "other"]);
    assert.equal(no.code, 2);
    assert.match(no.err, /add --replan to replace it/);
    const plain = await cli(cwd, ["plan", "--round", "1", "--walks", "2", "--seed", "other", "--replan"]);
    assert.equal(plain.data.next, undefined);
    const rounds = json(P(cwd, "rounds.json"));
    rounds.rounds["1"].published = true;
    writeFileSync(P(cwd, "rounds.json"), JSON.stringify(rounds, null, 2));
    const again = await cli(cwd, ["plan", "--round", "1", "--walks", "2", "--seed", "third", "--replan", "--offline"]);
    assert.equal(again.code, 0, again.err);
    assert.match(again.data.next, /publish --round 1 again/);
  });

  it("connect refuses to hand a tester an http:// address off this computer, or one that is not http at all", async () => {
    const cwd = tmp();
    await cli(cwd, ["init"]);
    for (const url of ["http://tester.example.com", "ftp://x.example.com"]) {
      const r = await cli(cwd, ["connect", "--url", url]);
      assert.equal(r.code, 1, url);
      assert.equal(r.data, null);
    }
    assert.equal((await cli(cwd, ["connect", "--url", "https://tester.example.com"])).code, 0);
    assert.equal((await cli(cwd, ["connect", "--url", "http://127.0.0.1:8787"])).code, 0);
  });

  it("the guide promises only the keys a brief really adds, and a measure no walk gave is left out of the findings file", () => {
    const project = structuredClone(EXAMPLE_PROJECT);
    const guide = renderGuide(project, { round: 1, kind: "standard", walks: [], avoid: [], known: [] });
    assert.doesNotMatch(guide, /`sitting`/);
    const base = { round: 1, briefs: 1, reports: 1, missing: [], unreadable: [], findings: [], walks: [], known_met: { count: 0, items: [] }, deepRound: true };
    const deep = { walks: 1, jobsStarted: 1, jobsFinished: 1, stepsDone: 3, steps: 3, sittings: {}, loopsWithoutSitting: 0 };
    const none = buildMarkdown({ ...base, deep: { ...deep, remembered: { yes: 0, known: 0 }, wouldPay: { yes: 1, known: 1 } } });
    assert.doesNotMatch(none, /Remembered/);
    assert.match(none, /Would pay now: 1 of 1 walk\./);
    const both = buildMarkdown({ ...base, deep: { ...deep, remembered: { yes: 1, known: 1 }, wouldPay: { yes: 0, known: 1 } } });
    assert.match(both, /Remembered what it was told earlier: 1 of 1 walk\. Would pay now: 0 of 1 walk\./);
  });

  it("no verb says one sentence on stderr, and the report's own Notes heading is not kept as the tester's words", async () => {
    const r = await cli(tmp(), []);
    assert.equal(r.code, 1);
    assert.equal(r.err.trim().split("\n").length, 1);
    assert.match(r.err, /Give a verb/);
    const report = parseReport(`${REPORT_TEMPLATE("r1-01-a-b", "the tester").split("## Notes")[0]}## Notes\n\nknown: the spinner.\n`);
    assert.equal(report.notes, "known: the spinner.");
  });
});
