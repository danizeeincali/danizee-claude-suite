/**
 * Packaged check: install the suite into a fresh project, `init` a persona-testing folder with the INSTALLED cli, and
 * run `check` and a plan there; the command files exist where the suite puts them.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { installPackaged } from "./helpers/packaged.js";

let pkg;
before(async () => {
  pkg = await installPackaged({ git: false });
});
after(() => pkg.cleanup());

const persona = (args) => {
  const r = spawnSync(process.execPath, [path.join(pkg.dir, ".claude", "helpers", "persona", "cli.js"), ...args], { cwd: pkg.dir, encoding: "utf8", env: { PATH: process.env.PATH } });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    // not JSON
  }
  return { code: r.status, out: r.stdout, err: r.stderr, json };
};

describe("persona testing, as installed in a fresh project", () => {
  it("has the cli and the two command files", () => {
    assert.ok(fs.existsSync(path.join(pkg.dir, ".claude", "helpers", "persona", "cli.js")));
    for (const n of ["w-persona-test", "ptest"]) assert.ok(fs.existsSync(path.join(pkg.dir, ".claude", "commands", ".shortcuts", `${n}.md`)), n);
    assert.match(fs.readFileSync(path.join(pkg.dir, ".claude", "commands", ".shortcuts", "w-persona-test.md"), "utf8"), /^# \/w-persona-test/);
  });

  it("init then check passes, and a round can be planned and its briefs read, with no key printed", () => {
    const i = persona(["init", "--product", "Packaged Co"]);
    assert.equal(i.code, 0, i.err);
    const c = persona(["check"]);
    assert.equal(c.code, 0, c.err);
    assert.equal(c.json.ok, true);
    const p = persona(["plan", "--round", "1", "--walks", "2"]);
    assert.equal(p.code, 0, p.err);
    assert.equal(p.json.walks.length, 2);
    const keys = JSON.parse(fs.readFileSync(path.join(pkg.dir, "persona-testing", ".keys.json"), "utf8"));
    for (const r of [i, c, p]) assert.ok(!r.out.includes(keys.tester_key) && !r.out.includes(keys.coding_key));
    assert.match(fs.readFileSync(path.join(pkg.dir, ".gitignore"), "utf8"), /persona-testing\/\.keys\.json/);
  });

  it("the installed cli can write a Worker folder that stands alone", () => {
    const out = path.join(pkg.dir, "worker-out");
    const w = persona(["worker", "--out", out]);
    assert.equal(w.code, 0, w.err);
    assert.ok(fs.existsSync(path.join(out, "src", "worker.js")) && fs.existsSync(path.join(out, "migrations", "0001_persona.sql")));
  });
});
