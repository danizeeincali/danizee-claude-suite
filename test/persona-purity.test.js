import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = new URL("../src/lib/persona/", import.meta.url).pathname;
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
const files = walk(ROOT);
/** Source with comments cut out, so a word in prose cannot trip a check on code. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

describe("the library names no product", () => {
  it("has files to check", () => {
    for (const f of ["report-shape.js", "tools.js", "mcp.js", "http.js", "serve.js", "sqlite.js", "schema.sql", "worker/worker.js", "worker/wrangler.example.toml"]) {
      assert.ok(files.includes(path.join(ROOT, f)), f);
    }
  });

  it("no file under src/lib/persona contains Ezi, ezihq, Duet, Dani or the word bos", () => {
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      for (const re of [/ezi/i, /ezihq/i, /duet/i, /dani/i, /\bbos\b/i]) {
        const m = s.match(re);
        assert.equal(m, null, `${path.relative(ROOT, f)} contains ${m && m[0]} near: ${m && s.slice(Math.max(0, m.index - 30), m.index + 30)}`);
      }
    }
  });
});

describe("the Worker-safe modules use nothing Node-only", () => {
  const safe = ["report-shape.js", "tools.js", "mcp.js", "http.js", "worker/worker.js"];
  for (const f of safe) {
    it(`${f}: no node: import and no bare process, Buffer or require`, () => {
      const s = code(readFileSync(path.join(ROOT, f), "utf8"));
      assert.doesNotMatch(s, /node:/, "node: specifier");
      assert.doesNotMatch(s, /\brequire\s*\(/);
      assert.doesNotMatch(s, /(^|[^.\w$])process\s*[.[]/);
      assert.doesNotMatch(s, /typeof\s+process\b/);
      assert.doesNotMatch(s, /(^|[^.\w$])Buffer\s*[.(]/);
      assert.doesNotMatch(s, /from\s+["'](fs|path|os|crypto|http|net|url|child_process)["']/);
    });
  }
});
