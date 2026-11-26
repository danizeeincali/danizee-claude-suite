import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/lib/persona/cli.js";
import { startServer } from "../src/lib/persona/serve.js";
import { REPORT_TEMPLATE } from "../src/lib/persona/report-shape.js";
import { openStore } from "../src/lib/persona/sqlite.js";

const CLI = new URL("../src/lib/persona/cli.js", import.meta.url).pathname;
const roots = [];
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "persona-cli-"));
  roots.push(d);
  return d;
};
after(() => roots.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Runs one verb in `cwd`; answers {code, out (parsed when JSON), err}. */
async function cli(cwd, args, env = {}) {
  let out = "";
  let err = "";
  const r = await run(args, { cwd, env: { PATH: process.env.PATH, ...env }, out: (s) => (out += s), err: (s) => (err += s) });
  let data = null;
  try {
    data = JSON.parse(out);
  } catch {
    // not JSON
  }
  return { code: r.code, out, data, err, server: r.server };
}
const initialised = async () => {
  const cwd = tmp();
  const r = await cli(cwd, ["init"]);
  assert.equal(r.code, 0, r.err);
  return cwd;
};
const keysOf = (cwd) => JSON.parse(readFileSync(path.join(cwd, "persona-testing", ".keys.json"), "utf8"));
const allFiles = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(path.join(d, e.name)) : [path.join(d, e.name)]));

describe("init", () => {
  it("scaffolds the folder, makes two random keys, ignores them in git and prints no key", async () => {
    const cwd = tmp();
    const r = await cli(cwd, ["init", "--product", "Rota", "--url", "http://127.0.0.1:9999"]);
    assert.equal(r.code, 0);
    const d = path.join(cwd, "persona-testing");
    assert.deepEqual(JSON.parse(readFileSync(path.join(d, "connector.json"), "utf8")), { url: "http://127.0.0.1:9999", product: "Rota" });
    assert.equal(JSON.parse(readFileSync(path.join(d, "project.json"), "utf8")).product.name, "Rota");
    const keys = keysOf(cwd);
    assert.match(keys.tester_key, /^[0-9a-f]{64}$/);
    assert.match(keys.coding_key, /^[0-9a-f]{64}$/);
    assert.notEqual(keys.tester_key, keys.coding_key);
    assert.ok(!r.out.includes(keys.tester_key) && !r.out.includes(keys.coding_key));
    assert.ok(!readFileSync(path.join(d, "connector.json"), "utf8").includes(keys.tester_key));
    const gi = readFileSync(path.join(cwd, ".gitignore"), "utf8").split("\n");
    assert.ok(gi.includes("persona-testing/.keys.json") && gi.includes("persona-testing/*.db*"));
    assert.ok(r.data.next.length >= 2);
  });

  it("never overwrites: a second init skips every file and keeps the keys and an edited project", async () => {
    const cwd = await initialised();
    const d = path.join(cwd, "persona-testing");
    const before = keysOf(cwd);
    writeFileSync(path.join(d, "project.json"), readFileSync(path.join(d, "project.json"), "utf8").replace("Tillbook", "Mine"));
    const gi1 = readFileSync(path.join(cwd, ".gitignore"), "utf8");
    const r = await cli(cwd, ["init", "--product", "Other"]);
    assert.equal(r.code, 0);
    assert.deepEqual(r.data.wrote, []);
    assert.deepEqual(r.data.skipped.sort(), [".keys.json", "connector.json", "project.json"]);
    assert.deepEqual(keysOf(cwd), before);
    assert.match(readFileSync(path.join(d, "project.json"), "utf8"), /Mine/);
    assert.equal(readFileSync(path.join(cwd, ".gitignore"), "utf8"), gi1);
  });

  it("keeps an existing .gitignore's lines and an outside --dir gets its own .gitignore", async () => {
    const cwd = tmp();
    writeFileSync(path.join(cwd, ".gitignore"), "node_modules");
    await cli(cwd, ["init"]);
    assert.match(readFileSync(path.join(cwd, ".gitignore"), "utf8"), /^node_modules\npersona-testing\/\.keys\.json\npersona-testing\/\*\.db\*\n$/);
    const elsewhere = tmp();
    const r = await cli(cwd, ["init", "--dir", path.join(elsewhere, "shared")]);
    assert.equal(r.code, 0);
    assert.match(readFileSync(path.join(elsewhere, "shared", ".gitignore"), "utf8"), /\.keys\.json/);
  });
});

describe("check", () => {
  it("says ok for the scaffold and exit 1 with the problems for a broken file", async () => {
    const cwd = await initialised();
    const ok = await cli(cwd, ["check"]);
    assert.equal(ok.code, 0);
    assert.equal(ok.data.ok, true);
    assert.equal(ok.data.personas, 3);
    const f = path.join(cwd, "persona-testing", "project.json");
    const p = JSON.parse(readFileSync(f, "utf8"));
    p.persnas = [];
    delete p.jobs;
    writeFileSync(f, JSON.stringify(p));
    const bad = await cli(cwd, ["check"]);
    assert.equal(bad.code, 1);
    assert.equal(bad.data.ok, false);
    assert.ok(bad.data.problems.length >= 2);
    assert.equal(bad.err.trim().split("\n").length, 1);
  });

  it("one sentence and exit 1 when there is no project file or an unknown verb or option", async () => {
    const cwd = tmp();
    const a = await cli(cwd, ["check"]);
    assert.equal(a.code, 1);
    assert.match(a.err, /run init/);
    assert.equal((await cli(cwd, ["frobnicate"])).code, 1);
    assert.equal((await cli(cwd, ["check", "--nope"])).code, 1);
    assert.equal((await cli(cwd, ["plan"])).code, 1);
    assert.equal((await cli(cwd, ["plan", "--round", "x"])).code, 1);
  });
});

describe("plan", () => {
  it("plans, records and writes briefs and the guide; planning again is the same, a different seed is refused (2) unless --replan", async () => {
    const cwd = await initialised();
    const d = path.join(cwd, "persona-testing");
    const r = await cli(cwd, ["plan", "--round", "1", "--walks", "3"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.data.walks.length, 3);
    assert.deepEqual(r.data.coverage, []);
    assert.equal(readdirSync(path.join(d, "briefs", "r1")).length, 4);
    assert.equal(Object.keys(JSON.parse(readFileSync(path.join(d, "rounds.json"), "utf8")).rounds).length, 1);
    assert.equal((await cli(cwd, ["plan", "--round", "1", "--walks", "3"])).code, 0);
    const refused = await cli(cwd, ["plan", "--round", "1", "--walks", "3", "--seed", "other"]);
    assert.equal(refused.code, 2);
    assert.match(refused.err, /replan/);
    assert.equal((await cli(cwd, ["plan", "--round", "1", "--walks", "3", "--seed", "other", "--replan"])).code, 0);
  });

  it("narrows with --doors, --personas and --jobs-only, and refuses an unknown id", async () => {
    const cwd = await initialised();
    const r = await cli(cwd, ["plan", "--round", "1", "--walks", "2", "--doors", "cold-app", "--personas", "stall-seller", "--jobs-only", "record-a-sale"]);
    assert.equal(r.code, 0, r.err);
    assert.ok(r.data.walks.every((w) => w.door === "cold-app" && w.persona === "stall-seller" && w.jobs.join() === "record-a-sale"));
    assert.equal((await cli(cwd, ["plan", "--round", "2", "--doors", "nope"])).code, 1);
  });

  it("a side round avoids the fixing areas, and a side plan with nothing left is a refusal (2)", async () => {
    const cwd = await initialised();
    const r = await cli(cwd, ["plan", "--round", "2", "--walks", "3", "--side"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.data.kind, "side");
    assert.deepEqual(r.data.avoid, ["setup", "billing"]);
    assert.ok(!r.data.walks.some((w) => w.jobs.includes("supplier-order")));
    await cli(cwd, ["fixing", "set", "sign-in,invite,pricing"]);
    const none = await cli(cwd, ["plan", "--round", "3", "--side"]);
    assert.equal(none.code, 2);
    assert.match(none.err, /^A side round cannot be planned/);
  });
});

describe("known and fixing edit project.json in place", () => {
  it("adds, lists and drops known things with new ids and keeps 2-space JSON", async () => {
    const cwd = await initialised();
    const f = path.join(cwd, "persona-testing", "project.json");
    const a = await cli(cwd, ["known", "add", "The printer page is slow.", "--instead", "Skip it.", "--area", "reports"]);
    assert.equal(a.code, 0, a.err);
    assert.equal(a.data.added.id, "k3");
    assert.match(readFileSync(f, "utf8"), /^{\n  "kind"/);
    assert.equal((await cli(cwd, ["known", "list"])).data.known.length, 3);
    assert.equal((await cli(cwd, ["known", "drop", "k1"])).code, 0);
    assert.equal((await cli(cwd, ["known", "drop", "k1"])).code, 1);
    assert.equal((await cli(cwd, ["known", "add", "x", "--area", "Not A Slug"])).code, 1);
    assert.equal((await cli(cwd, ["check"])).code, 0);
  });

  it("sets and clears the areas being fixed", async () => {
    const cwd = await initialised();
    assert.deepEqual((await cli(cwd, ["fixing", "set", "stock,reports"])).data.fixing, ["stock", "reports"]);
    assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, "persona-testing", "project.json"), "utf8")).fixing, ["stock", "reports"]);
    assert.equal((await cli(cwd, ["fixing", "set", "Bad Area"])).code, 1);
    assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, "persona-testing", "project.json"), "utf8")).fixing, ["stock", "reports"]);
    await cli(cwd, ["fixing", "clear"]);
    assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, "persona-testing", "project.json"), "utf8")).fixing, []);
  });
});

describe("connect", () => {
  it("prints both forms with placeholders, never a key, and the real tester key only with --show-keys (never the coding key)", async () => {
    const cwd = await initialised();
    const keys = keysOf(cwd);
    const r = await cli(cwd, ["connect"]);
    assert.equal(r.code, 0);
    assert.match(r.data.claude_code, /^claude mcp add .* http:\/\/127\.0\.0\.1:8787\/mcp .*Bearer <tester key>/);
    assert.equal(r.data.connector_with_key_in_path, "http://127.0.0.1:8787/k/<tester key>/mcp");
    assert.match(r.data.say_to_the_tester, /^Every 30 minutes, check the Tillbook tester connector/);
    assert.ok(!r.out.includes(keys.tester_key) && !r.out.includes(keys.coding_key));
    const s = await cli(cwd, ["connect", "--show-keys"]);
    assert.ok(s.out.includes(keys.tester_key));
    assert.ok(!s.out.includes(keys.coding_key));
    assert.equal(s.data.connector_with_key_in_path, `http://127.0.0.1:8787/k/${keys.tester_key}/mcp`);
  });
});

describe("worker", () => {
  it("writes a self-contained folder whose worker.js runs, with the schema as the migration and no key", async () => {
    const cwd = await initialised();
    const out = path.join(tmp(), "w");
    const r = await cli(cwd, ["worker", "--out", out, "--name", "tillbook-persona"]);
    assert.equal(r.code, 0, r.err);
    for (const f of ["src/report-shape.js", "src/tools.js", "src/mcp.js", "src/http.js", "src/worker.js", "migrations/0001_persona.sql", "wrangler.toml", "README.md"]) assert.ok(existsSync(path.join(out, f)), f);
    assert.equal(readFileSync(path.join(out, "migrations", "0001_persona.sql"), "utf8"), readFileSync(new URL("../src/lib/persona/schema.sql", import.meta.url), "utf8"));
    const toml = readFileSync(path.join(out, "wrangler.toml"), "utf8");
    assert.match(toml, /^name = "tillbook-persona"$/m);
    assert.match(toml, /^main = "src\/worker\.js"$/m);
    assert.match(toml, /PERSONA_PRODUCT = "Tillbook"/);
    const readme = readFileSync(path.join(out, "README.md"), "utf8");
    for (const c of ["wrangler d1 create", "wrangler d1 migrations apply", "wrangler secret put PERSONA_TESTER_KEY", "wrangler secret put PERSONA_CODING_KEY", "wrangler deploy"]) assert.ok(readme.includes(c), c);
    const keys = keysOf(cwd);
    for (const f of allFiles(out)) {
      const s = readFileSync(f, "utf8");
      assert.ok(!s.includes(keys.tester_key) && !s.includes(keys.coding_key), f);
    }
    // The written worker imports resolve inside the folder and it answers with a fake env.
    const worker = (await import(path.join(out, "src", "worker.js"))).default;
    const env = { DB: openStore(), PERSONA_TESTER_KEY: "t".repeat(30), PERSONA_CODING_KEY: "c".repeat(30), PERSONA_PRODUCT: "Tillbook" };
    const res = await worker.fetch(new Request("https://w.example/mcp", { method: "POST", headers: { authorization: `Bearer ${env.PERSONA_TESTER_KEY}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) }), env);
    assert.equal(res.status, 200);
    assert.match((await res.json()).result.serverInfo.title, /Tillbook persona testing/);
    env.DB.close();
  });

  it("refuses a folder that already has Worker files (2) and a bad name or no --out (1)", async () => {
    const cwd = await initialised();
    const out = path.join(tmp(), "w");
    assert.equal((await cli(cwd, ["worker", "--out", out])).code, 0);
    assert.equal((await cli(cwd, ["worker", "--out", out])).code, 2);
    assert.equal((await cli(cwd, ["worker", "--out", path.join(tmp(), "x"), "--name", "Bad Name"])).code, 1);
    assert.equal((await cli(cwd, ["worker"])).code, 1);
  });
});

describe("verbs that talk to the server", () => {
  let server;
  let cwd;
  const T = "t".repeat(40);
  const C = "c".repeat(40);
  before(async () => {
    server = await startServer({ port: 0, testerKey: T, codingKey: C, product: "Tillbook" });
    cwd = await initialised();
    writeFileSync(path.join(cwd, "persona-testing", "connector.json"), JSON.stringify({ url: server.url, product: "Tillbook" }));
    writeFileSync(path.join(cwd, "persona-testing", ".keys.json"), JSON.stringify({ tester_key: T, coding_key: C }));
  });
  after(() => server.close());
  const tester = async (tool, args = {}) => {
    const res = await fetch(`${server.url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${T}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }) });
    return JSON.parse((await res.json()).result.content[0].text);
  };

  it("publish, note, status, questions, answer, close, notes-clear and fetch work against the URL in connector.json", async () => {
    await cli(cwd, ["plan", "--round", "1", "--walks", "2"]);
    const pub = await cli(cwd, ["publish", "--round", "1"]);
    assert.equal(pub.code, 0, pub.err);
    assert.equal(pub.data.briefs, 2);
    assert.equal((await cli(cwd, ["note", "Start", "with", "the", "cafe.", "--round", "1"])).code, 0);
    assert.equal((await tester("notes")).notes[0].text, "Start with the cafe.");
    assert.equal((await cli(cwd, ["status"])).data.rounds[0].briefs, 2);
    assert.equal((await cli(cwd, ["status", "--round", "1"])).data.walks.length, 2);
    const walk = (await tester("next_walk")).id;
    await tester("start_walk", { id: walk });
    assert.equal((await tester("submit_report", { id: walk, report: REPORT_TEMPLATE(walk) })).accepted, true);
    await tester("ask", { question: "Which link?" });
    const q = (await cli(cwd, ["questions"])).data.questions;
    assert.equal(q.length, 1);
    assert.equal((await cli(cwd, ["answer", "--id", String(q[0].question_id), "The", "second", "one."])).code, 0);
    assert.equal((await cli(cwd, ["questions"])).data.questions.length, 0);
    const f = await cli(cwd, ["fetch", "--round", "1"]);
    assert.deepEqual(f.data.fetched, [walk]);
    assert.ok(existsSync(path.join(cwd, "persona-testing", "reports", `${walk}.md`)));
    assert.equal((await cli(cwd, ["notes-clear"])).data.cleared, 1);
    assert.equal((await cli(cwd, ["close", "--round", "1"])).data.closed, true);
    assert.equal((await cli(cwd, ["close", "--round", "1", "--reopen"])).data.closed, false);
  });

  it("--url overrides connector.json; the coding key may come from the env; no key is a sentence; a server refusal is exit 2", async () => {
    const cw = tmp();
    mkdirSync(path.join(cw, "persona-testing"), { recursive: true });
    const noKey = await cli(cw, ["status", "--url", server.url]);
    assert.equal(noKey.code, 1);
    assert.match(noKey.err, /coding key/);
    const viaEnv = await cli(cw, ["status", "--url", server.url], { PERSONA_CODING_KEY: C });
    assert.equal(viaEnv.code, 0, viaEnv.err);
    const refused = await cli(cw, ["close", "--round", "99", "--url", server.url], { PERSONA_CODING_KEY: C });
    assert.equal(refused.code, 2);
    const noUrl = await cli(cw, ["status"], { PERSONA_CODING_KEY: C });
    assert.equal(noUrl.code, 1);
    assert.match(noUrl.err, /connector\.json/);
  });

  it("bundle posts the round with no key and prints a code", async () => {
    const r = await cli(cwd, ["bundle", "--round", "1"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.data.code, /^[a-z2-9]{10}$/);
  });
});

describe("read and deliver", () => {
  it("read and deliver work on the files of a folder, say what is missing, and print no key", async () => {
    const cwd = await initialised();
    const miss = await cli(cwd, ["deliver", "--round", "1"]);
    assert.equal(miss.code, 1);
    assert.match(miss.err, /read the round first/);
    await cli(cwd, ["plan", "--round", "1", "--walks", "2"]);
    const rd = await cli(cwd, ["read", "--round", "1"]);
    assert.equal(rd.code, 0, rd.err);
    assert.equal(rd.data.reports, 0);
    assert.equal(rd.data.briefs, 2);
    const dl = await cli(cwd, ["deliver", "--round", "1"]);
    assert.equal(dl.code, 0, dl.err);
    assert.ok(existsSync(path.join(cwd, dl.data.deck)) && existsSync(path.join(cwd, dl.data.markdown)));
  });
});

describe("as a program", () => {
  it("runs from the command line: JSON on stdout, one sentence on stderr, exit codes, and serve answers on a free port until stopped", async () => {
    const cwd = tmp();
    const run1 = (...a) => spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: "utf8", env: { PATH: process.env.PATH } });
    const i = run1("init");
    assert.equal(i.status, 0);
    assert.equal(JSON.parse(i.stdout).wrote.length >= 3, true);
    const bad = run1("nonsense");
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, "");
    assert.equal(bad.stderr.trim().split("\n").length, 1);
    const child = spawn(process.execPath, [CLI, "serve", "--port", "0"], { cwd, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
    try {
      const line = await new Promise((resolve, reject) => {
        let buf = "";
        child.stdout.on("data", (c) => {
          buf += c;
          if (buf.includes("}\n")) resolve(buf);
        });
        child.once("exit", () => reject(new Error(`serve exited: ${buf}`)));
      });
      const info = JSON.parse(line);
      assert.match(info.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(info.store, path.join("persona-testing", "tester.db"));
      const keys = keysOf(cwd);
      assert.ok(!line.includes(keys.tester_key) && !line.includes(keys.coding_key));
      const res = await fetch(`${info.url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${keys.tester_key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
      assert.equal(res.status, 200);
      assert.equal((await fetch(`${info.url}/mcp`, { method: "POST", headers: { authorization: "Bearer nope-nope-nope-nope-nope-nope" }, body: "{}" })).status, 401);
    } finally {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
    }
    assert.ok(existsSync(path.join(cwd, "persona-testing", "tester.db")));
  });

  it("serve passes secret_paths from project.json to the server: a path in a report note is cut", async () => {
    const cwd = await initialised();
    const s = await cli(cwd, ["serve", "--port", "0", "--db", path.join(cwd, "x.db")]);
    assert.equal(s.code, 0, s.err);
    try {
      const keys = keysOf(cwd);
      const call = async (key, name, args) => JSON.parse((await (await fetch(`${s.server.url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result.content[0].text);
      await call(keys.coding_key, "post_note", { text: "Open https://app.example.com/sign-in/tester/abc123 now" });
      const notes = await call(keys.tester_key, "notes", {});
      assert.ok(!notes.notes[0].text.includes("abc123"), notes.notes[0].text);
    } finally {
      await s.server.close();
    }
  });
});
