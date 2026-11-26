import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/lib/persona/cli.js";
import { fetchReports, FETCH_AT_ONCE } from "../src/lib/persona/client.js";
import { mergeFindings, MAX_NOTES_KEPT } from "../src/lib/persona/read.js";
import { REPORT_TEMPLATE } from "../src/lib/persona/report-shape.js";

const roots = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "persona-rr7-"));
  roots.push(d);
  return d;
};
after(() => roots.forEach((d) => rmSync(d, { recursive: true, force: true })));
const finding = (n, title, screen = "Home") => ({ n, title, severity: "rough", screen, address: null, expected: null, persona_said: null, what_happened: null, shot: null });
const walk = (id, findings) => ({ file: `${id}.md`, report: { id, findings } });

describe("rounds review 7", () => {
  it("merging stays quick when many walks each list hundreds of different findings on one screen", () => {
    const walks = [];
    for (let w = 0; w < 20; w++) walks.push(walk(`r1-${String(w + 1).padStart(2, "0")}-a-b`, Array.from({ length: 500 }, (_, i) => finding(i + 1, `alpha${w}x${i} beta${w}x${i} gamma${w}x${i}`))));
    const t = Date.now();
    const merged = mergeFindings(walks);
    const ms = Date.now() - t;
    assert.equal(merged.length, 10000);
    assert.ok(ms < 5000, `took ${ms} ms`);
  });

  it("merging gives the same groups as before: alike titles in one place merge, in the order the groups were made", () => {
    const merged = mergeFindings([
      walk("r1-01-a-b", [finding(1, "The save button does nothing"), finding(2, "Prices lose their cents")]),
      walk("r1-02-c-d", [finding(1, "Save button does nothing at all"), finding(2, "The save button does nothing", "Orders"), finding(3, "???")]),
      walk("r1-03-e-f", [finding(1, "the SAVE button does nothing!"), finding(2, "???")]),
    ]);
    const by = Object.fromEntries(merged.map((g) => [`${g.screen}|${g.title}`, g]));
    assert.equal(by["Home|The save button does nothing"].walks, 3);
    assert.equal(by["Home|Prices lose their cents"].walks, 1);
    assert.equal(by["Orders|The save button does nothing"].walks, 1);
    assert.equal(merged.filter((g) => g.title === "???").length, 2, "a title with no words never merges");
    assert.equal(merged.length, 5);
    for (const g of merged) assert.deepEqual(Object.keys(g).filter((k) => ["words", "n", "titles", "key"].includes(k)), []);
  });

  it("the findings keep only the start of a walk's notes, and a known: line far down the notes is still counted", async () => {
    const cwd = tmp();
    const io = { cwd, env: { PATH: process.env.PATH }, out: () => {}, err: () => {} };
    await run(["init"], io);
    let out = "";
    await run(["plan", "--round", "1", "--walks", "1"], { ...io, out: (s) => (out += s) });
    const id = JSON.parse(out).walks[0].id;
    mkdirSync(path.join(cwd, "persona-testing", "reports"), { recursive: true });
    const report = `${REPORT_TEMPLATE(id, "the tester").split("## Notes")[0]}## Notes\n\n${"word ".repeat(20000)}\nknown: the spinner on import.\n`;
    writeFileSync(path.join(cwd, "persona-testing", "reports", `${id}.md`), report);
    assert.equal((await run(["read", "--round", "1"], io)).code, 0);
    const f = JSON.parse(readFileSync(path.join(cwd, "persona-testing", "findings-r1.json"), "utf8"));
    assert.ok(f.walks[0].notes.length <= MAX_NOTES_KEPT);
    assert.equal(f.known_met.count, 1);
  });

  it("fetch asks for a few reports at a time, never one by one and never all at once", async () => {
    const d = tmp();
    const ids = Array.from({ length: 10 }, (_, i) => `r1-${String(i + 1).padStart(2, "0")}-a-b`);
    let open = 0;
    let most = 0;
    const conn = {
      async call(name, args) {
        if (name === "list_reports") return { walks: ids.map((id) => ({ id, status: "accepted", clock_minutes: 5 })) };
        open++;
        most = Math.max(most, open);
        await new Promise((r) => setTimeout(r, 5));
        open--;
        return { report: `report of ${args.id}` };
      },
    };
    const r = await fetchReports(d, 1, conn);
    assert.deepEqual(r.fetched, ids);
    assert.equal(most, FETCH_AT_ONCE);
    for (const id of ids) assert.equal(readFileSync(path.join(d, "reports", `${id}.md`), "utf8"), `report of ${id}`);
  });
});
