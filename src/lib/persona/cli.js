#!/usr/bin/env node
/**
 * Persona testing CLI: `node cli.js <verb> [--dir persona-testing]`.
 * JSON on stdout. Wrong input: one sentence on stderr and exit 1. A refusal (the server, a plan or a rule said no): exit 2.
 * It never prints a key unless `connect --show-keys` is given, and never writes one anywhere but `.keys.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { writeAtomic } from "./fsx.js";
import { EXAMPLE_PROJECT, ID_RE, PROJECT_FILE, checkProject, loadProject } from "./project.js";
import { checkCoverage, historyOf, markPublished, planRound, readRounds, recordRound } from "./plan.js";
import { renderBrief, renderGuide, writeRound } from "./brief.js";
import { bundle, connect, fetchReports, publish } from "./client.js";
import { collect } from "./read.js";
import { deliver } from "./deliver.js";
import { startServer } from "./serve.js";
import { MIN_KEY_CHARS } from "./http.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIR = "persona-testing";
export const DEFAULT_URL = "http://127.0.0.1:8787";
const WORKER_FILES = ["report-shape.js", "tools.js", "mcp.js", "http.js"];

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}
const bad = (m) => {
  throw new CliError(m, 1);
};
const refuse = (m) => {
  throw new CliError(m, 2);
};

const USAGE = "Verbs: init, check, plan, serve, worker, connect, publish, bundle, note, notes-clear, status, questions, answer, close, fetch, read, deliver, known (add|list|drop), fixing (set|clear). Every verb takes --dir <folder> (default persona-testing).";
const VALUE_FLAGS = new Set(["dir", "url", "product", "round", "walks", "jobs", "seed", "doors", "personas", "jobs-only", "port", "db", "out", "name", "id", "picks", "instead", "area", "host"]);
const BOOL_FLAGS = new Set(["side", "replan", "reopen", "show-keys", "offline"]);

/** `{ flags, rest }` from argv: `--name value`, `--name=value`, booleans, and the words left over. */
export function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--") || a === "--") {
      rest.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = a.slice(2, eq < 0 ? undefined : eq);
    if (BOOL_FLAGS.has(name)) {
      flags[name] = eq < 0 ? true : a.slice(eq + 1) !== "false";
    } else if (VALUE_FLAGS.has(name)) {
      const v = eq >= 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined) bad(`--${name} needs a value.`);
      flags[name] = v;
    } else bad(`Unknown option --${name}. ${USAGE}`);
  }
  return { flags, rest };
}

const intFlag = (flags, name, { required = false, min = 1 } = {}) => {
  const v = flags[name];
  if (v === undefined) return required ? bad(`--${name} is needed, a whole number.`) : undefined;
  if (!/^\d+$/.test(v) || Number(v) < min) bad(`--${name} must be a whole number of ${min} or more, not "${v}".`);
  return Number(v);
};
const listFlag = (flags, name) => (flags[name] === undefined ? undefined : flags[name].split(",").map((s) => s.trim()).filter(Boolean));
const json = (x) => `${JSON.stringify(x, null, 2)}\n`;
const rel = (cwd, p) => path.relative(cwd, p) || ".";
const readJson = (file, what) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return bad(`${file} could not be read as ${what}.`);
  }
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "product";

const isReportFile = (u) => !["project.json", "rounds.json"].includes(u.file) && !/^clock-r\d+\.json$/.test(String(u.file));

function keysOf(dir, env) {
  let file = {};
  const f = path.join(dir, ".keys.json");
  if (fs.existsSync(f)) file = readJson(f, "{tester_key, coding_key}");
  return { tester: env.PERSONA_TESTER_KEY || file.tester_key || null, coding: env.PERSONA_CODING_KEY || file.coding_key || null };
}
function urlOf(dir, flags) {
  if (flags.url) return flags.url;
  const f = path.join(dir, "connector.json");
  if (!fs.existsSync(f)) return bad(`There is no connector.json in ${dir}: run init, or give --url <server>.`);
  const u = readJson(f, "{url, product}").url;
  if (typeof u === "string" && /\/k\/|\/\/[^/]*@/.test(u)) bad("The url in connector.json holds a key: keep only the server's address there (like https://tester.example.com); the keys stay in .keys.json.");
  return typeof u === "string" && u ? u : bad(`connector.json has no url: set it or give --url <server>.`);
}
function codingConn(dir, flags, env, io) {
  const key = keysOf(dir, env).coding;
  if (!key) bad("There is no coding key: set PERSONA_CODING_KEY or run init to make .keys.json.");
  return connect({ url: urlOf(dir, flags), key, fetchImpl: io.fetchImpl });
}

function gitignoreFor(cwd, dir) {
  const r = path.relative(cwd, dir);
  const inside = r !== "" && !r.startsWith("..") && !path.isAbsolute(r);
  const prefix = inside ? `${r.split(path.sep).join("/")}/` : "";
  return { file: path.join(inside ? cwd : dir, ".gitignore"), rules: [`${prefix}.keys.json`, `${prefix}*.db*`] };
}

function init(dir, flags, io) {
  fs.mkdirSync(dir, { recursive: true });
  const wrote = [];
  const skipped = [];
  const put = (name, text, mode) => {
    const f = path.join(dir, name);
    if (fs.existsSync(f)) return void skipped.push(name);
    writeAtomic(f, text, { mode });
    wrote.push(name);
  };
  const project = structuredClone(EXAMPLE_PROJECT);
  if (flags.product) project.product.name = flags.product;
  put(PROJECT_FILE, `${JSON.stringify(project, null, 2)}\n`);
  put("connector.json", `${JSON.stringify({ url: flags.url ?? DEFAULT_URL, product: flags.product ?? project.product.name }, null, 2)}\n`);
  put(".keys.json", `${JSON.stringify({ tester_key: randomBytes(32).toString("hex"), coding_key: randomBytes(32).toString("hex") }, null, 2)}\n`, 0o600);
  const g = gitignoreFor(io.cwd, dir);
  const have = fs.existsSync(g.file) ? fs.readFileSync(g.file, "utf8") : "";
  const lines = new Set(have.split("\n").map((l) => l.trim()));
  const missing = g.rules.filter((r) => !lines.has(r));
  if (missing.length) {
    writeAtomic(g.file, `${have}${have && !have.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
    wrote.push(`${rel(io.cwd, g.file)} (+ ${missing.join(", ")})`);
  }
  return {
    dir: rel(io.cwd, dir),
    wrote,
    skipped,
    next: [
      `Edit ${path.join(rel(io.cwd, dir), PROJECT_FILE)}: the example describes a made-up shop; write your product, people, doors and jobs.`,
      "Run `check` until it says ok, then `plan --round 1`.",
      "Run `serve` (local) or `worker --out <folder>` (a Worker), then `connect` to see how the tester connects.",
    ],
  };
}

function check(dir) {
  const file = path.join(dir, PROJECT_FILE);
  if (!fs.existsSync(file)) bad(`There is no ${PROJECT_FILE} in ${dir}: run init to make one.`);
  const obj = readJson(file, "JSON");
  const r = checkProject(obj);
  if (!r.ok) {
    const e = new CliError(`${file} has ${r.problems.length} problem${r.problems.length === 1 ? "" : "s"}: ${r.problems.slice(0, 3).map((p) => `${p.path || "file"}: ${p.message} ${p.fix}`).join(" | ")}`, 1);
    e.data = { ok: false, problems: r.problems };
    throw e;
  }
  const p = loadProject(dir);
  return { ok: true, product: p.product.name, personas: p.personas.length, doors: p.doors.length, jobs: p.jobs.length, known: p.known.length, fixing: p.fixing };
}

/**
 * The walks of a published round that the server says already have a report, so a replan never drops one that has not
 * been fetched yet. A server that cannot be asked is a refusal: `--offline` replans from the fetched reports alone.
 */
async function reportedOnServer(dir, round, flags, io) {
  if (flags.replan !== true || flags.offline === true) return [];
  if (readRounds(dir).rounds[String(round)]?.published !== true) return [];
  let list;
  try {
    list = await codingConn(dir, flags, io.env, io).call("list_reports", { round });
  } catch (e) {
    if (e?.refused) return [];
    return refuse(`Round ${round} was published, and the server could not be asked which walks already have a report (${e.message}) Start the server and replan again, or add --offline to keep only the reports already fetched.`);
  }
  return (list?.walks ?? []).filter((w) => typeof w?.id === "string" && w.status === "accepted").map((w) => w.id);
}

async function plan(dir, flags, io) {
  const round = intFlag(flags, "round", { required: true });
  const project = loadProject(dir);
  const only = { doors: listFlag(flags, "doors"), personas: listFlag(flags, "personas"), jobs: listFlag(flags, "jobs-only") };
  const p = planRound(project, { round, walks: intFlag(flags, "walks"), jobsPerWalk: intFlag(flags, "jobs"), seed: flags.seed, side: flags.side === true, only, history: historyOf(readRounds(dir), round) });
  const keep = await reportedOnServer(dir, round, flags, io);
  // Every brief and the guide must render before anything is written, so rounds.json and briefs/ never fall out of step.
  const draft = recordRound(dir, p, { replan: flags.replan === true, keep, dryRun: true });
  try {
    for (const w of draft.walks) renderBrief(project, draft, w);
    renderGuide(project, draft);
  } catch (e) {
    bad(`Round ${round} was not changed: a brief could not be written (${e.message}) A walk that already has a report keeps its persona, door and jobs, so put them back in project.json and plan again.`);
  }
  const recorded = recordRound(dir, p, { replan: flags.replan === true, keep });
  const written = writeRound(dir, project, recorded);
  return { round, kind: recorded.kind, seed: recorded.seed, avoid: recorded.avoid, walks: recorded.walks.map((w) => ({ id: w.id, persona: w.persona, door: w.door, jobs: w.jobs, width: w.width })), briefs: rel(io.cwd, written.folder), guide: rel(io.cwd, written.guide), coverage: checkCoverage(recorded, project, { only }) };
}

async function serve(dir, flags, io) {
  const project = loadProject(dir);
  const keys = keysOf(dir, io.env);
  if (!keys.tester || !keys.coding) bad("There are no keys: run init to make .keys.json, or set PERSONA_TESTER_KEY and PERSONA_CODING_KEY.");
  if (keys.tester.length < MIN_KEY_CHARS || keys.coding.length < MIN_KEY_CHARS || keys.tester === keys.coding) bad(`The keys must each be at least ${MIN_KEY_CHARS} characters and different from each other.`);
  let port = flags.port === undefined ? undefined : intFlag(flags, "port", { min: 0 });
  if (port === undefined) {
    const c = path.join(dir, "connector.json");
    try {
      const u = new URL(JSON.parse(fs.readFileSync(c, "utf8")).url);
      if (["127.0.0.1", "localhost"].includes(u.hostname) && u.port) port = Number(u.port);
    } catch {
      // the default port below
    }
  }
  const file = flags.db ? path.resolve(io.cwd, flags.db) : path.join(dir, "tester.db");
  let server;
  try {
    server = await startServer({ file, port: port ?? 8787, host: flags.host, testerKey: keys.tester, codingKey: keys.coding, product: project.product.name, secretPaths: project.secret_paths });
  } catch (e) {
    return bad(e?.code === "EADDRINUSE" ? `Port ${port ?? 8787} is already in use: give --port <n>.` : String(e?.message ?? e).split("\n")[0]);
  }
  return { result: { url: server.url, mcp: server.mcp, store: rel(io.cwd, file) }, server };
}

function workerFolder(dir, flags, io) {
  if (!flags.out) bad("worker needs --out <folder> to write the Worker into.");
  const out = path.resolve(io.cwd, flags.out);
  const name = flags.name ?? "persona-tester";
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) bad("The worker name must be lower-case letters, digits and hyphens, like persona-tester.");
  let product = "Your Product";
  let secretPaths = [];
  if (fs.existsSync(path.join(dir, PROJECT_FILE))) {
    let project;
    try {
      project = loadProject(dir);
    } catch (e) {
      bad(`The Worker was not written: ${e.message} Run check, fix the project file and try again, so the Worker gets the product's name and its secret paths.`);
    }
    product = project.product.name;
    secretPaths = project.secret_paths ?? [];
  }
  const targets = ["src/worker.js", "migrations/0001_persona.sql", "wrangler.toml", "README.md", "package.json", ...WORKER_FILES.map((f) => `src/${f}`)];
  const clash = targets.filter((t) => fs.existsSync(path.join(out, t)));
  if (clash.length) refuse(`${rel(io.cwd, out)} already has ${clash.join(", ")}: choose an empty folder.`);
  fs.mkdirSync(path.join(out, "src"), { recursive: true });
  fs.mkdirSync(path.join(out, "migrations"), { recursive: true });
  for (const f of WORKER_FILES) fs.copyFileSync(path.join(HERE, f), path.join(out, "src", f));
  const worker = fs.readFileSync(path.join(HERE, "worker", "worker.js"), "utf8").replace('from "../http.js"', 'from "./http.js"').replace("../schema.sql", "../migrations/0001_persona.sql");
  fs.writeFileSync(path.join(out, "src", "worker.js"), worker);
  fs.copyFileSync(path.join(HERE, "schema.sql"), path.join(out, "migrations", "0001_persona.sql"));
  const toml = fs
    .readFileSync(path.join(HERE, "worker", "wrangler.example.toml"), "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .join("\n")
    .replace(/^\n+/, "")
    .replace('name = "persona-tester"', `name = "${name}"`)
    .replace('main = "worker.js"', 'main = "src/worker.js"')
    .replace('PERSONA_PRODUCT = "Your Product"', `PERSONA_PRODUCT = ${JSON.stringify(product)}\nPERSONA_SECRET_PATHS = ${JSON.stringify(secretPaths.join(","))}`);
  fs.writeFileSync(path.join(out, "wrangler.toml"), `# No secret belongs in this file: the two keys are set with \`wrangler secret put\` (see README.md).\n${toml}`);
  fs.writeFileSync(path.join(out, "package.json"), `${JSON.stringify({ name, private: true, type: "module" }, null, 2)}\n`);
  fs.writeFileSync(
    path.join(out, "README.md"),
    `# ${name}\n\nThe persona-testing connector for ${product} as a Cloudflare Worker over a D1 database. Run these from this folder, in order:\n\n` +
      "1. `wrangler d1 create persona`\n2. Paste the `database_id` it prints into `wrangler.toml`.\n3. `wrangler d1 migrations apply persona --remote`\n" +
      "4. `wrangler secret put PERSONA_TESTER_KEY` and `wrangler secret put PERSONA_CODING_KEY` (24 or more characters each, different; the same two values as in your `persona-testing/.keys.json`, or new ones)\n5. `wrangler deploy`\n\n" +
      "Then put the Worker's address in `persona-testing/connector.json` and run `connect`.\n\n`wrangler.toml` carries the project's `secret_paths` as `PERSONA_SECRET_PATHS` (paths, not secrets), so sign-in paths are cut from anything stored. If you change `secret_paths` in the project file, change that line and deploy again.\n",
  );
  return { out: rel(io.cwd, out), name, product, files: targets.map((t) => t), next: "Run the five commands in README.md; this command never runs wrangler and writes no key." };
}

function connectInfo(dir, flags, io) {
  const url = urlOf(dir, flags).replace(/\/+$/, "");
  const keys = keysOf(dir, io.env);
  let product = "this product";
  try {
    product = loadProject(dir).product.name;
  } catch {
    // the name only labels the command
  }
  const key = flags["show-keys"] === true && keys.tester ? keys.tester : "<tester key>";
  const label = slug(product);
  return {
    url,
    tester_key: flags["show-keys"] === true ? "shown below, inside the two forms" : "not shown: it is in .keys.json (or run with --show-keys)",
    claude_code: `claude mcp add --transport http ${label}-tester ${url}/mcp --header "Authorization: Bearer ${key}"`,
    connector_with_key_in_path: `${url}/k/${key}/mcp`,
    say_to_the_tester: `Every 30 minutes, check the ${product} tester connector: read notes, then do any open walk, one at a time.`,
  };
}

const roundOf = (flags) => intFlag(flags, "round", { required: true });

function editProject(dir, change) {
  const file = path.join(dir, PROJECT_FILE);
  if (!fs.existsSync(file)) bad(`There is no ${PROJECT_FILE} in ${dir}: run init to make one.`);
  const obj = readJson(file, "JSON");
  const out = change(obj);
  const r = checkProject(obj);
  if (!r.ok) bad(`That would leave ${PROJECT_FILE} with a problem, so nothing was changed: ${r.problems[0].message} ${r.problems[0].fix}`);
  writeAtomic(file, `${JSON.stringify(obj, null, 2)}\n`);
  return out;
}

function known(dir, flags, rest) {
  const [sub, ...words] = rest;
  if (sub === "list") return { known: loadProject(dir).known };
  if (sub === "add") {
    const text = words.join(" ").trim();
    if (!text) bad('known add needs the text, like: known add "The time zone is guessed as UTC." --instead "Pick your own."');
    if (flags.area !== undefined && !ID_RE.test(flags.area)) bad("--area must be a lower-case slug like setup.");
    return editProject(dir, (obj) => {
      obj.known ??= [];
      let n = obj.known.reduce((m, k) => Math.max(m, Number(/^k(\d+)$/.exec(k?.id ?? "")?.[1] ?? 0)), 0) + 1;
      while (obj.known.some((k) => k.id === `k${n}`)) n++;
      const item = { id: `k${n}`, text, instead: flags.instead ?? "", area: flags.area ?? null };
      obj.known.push(item);
      return { added: item };
    });
  }
  if (sub === "drop") {
    const id = words[0];
    if (!id) bad("known drop needs the id, like: known drop k1.");
    return editProject(dir, (obj) => {
      const before = obj.known ?? [];
      if (!before.some((k) => k.id === id)) bad(`There is no known item "${id}" (known: ${before.map((k) => k.id).join(", ") || "none"}).`);
      obj.known = before.filter((k) => k.id !== id);
      return { dropped: id };
    });
  }
  return bad("known takes add, list or drop.");
}

/** The project's `secret_paths`, read from the file as it is: a problem elsewhere in the project never stops them being cut. None when there is no readable file. */
function secretPathsOf(dir) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dir, PROJECT_FILE), "utf8"));
    return (Array.isArray(p?.secret_paths) ? p.secret_paths : []).filter((s) => typeof s === "string" && s.startsWith("/") && s.length >= 2);
  } catch {
    return [];
  }
}

function fixing(dir, rest) {
  const [sub, ...words] = rest;
  if (sub === "clear") return editProject(dir, (obj) => ((obj.fixing = []), { fixing: [] }));
  if (sub === "set") {
    const areas = words.join(",").split(",").map((s) => s.trim()).filter(Boolean);
    if (areas.length === 0) bad("fixing set needs the areas, like: fixing set setup,billing.");
    return editProject(dir, (obj) => ((obj.fixing = areas), { fixing: areas }));
  }
  return bad("fixing takes set <a,b> or clear.");
}

/**
 * Runs one command. Returns `{ code, server? }`; output goes through `io.out` and errors through `io.err`.
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, out?: (s: string) => void, err?: (s: string) => void, fetchImpl?: typeof fetch }} [io]
 */
export async function run(argv, io = {}) {
  const ctx = { cwd: io.cwd ?? process.cwd(), env: io.env ?? process.env, out: io.out ?? ((s) => process.stdout.write(s)), err: io.err ?? ((s) => process.stderr.write(s)), fetchImpl: io.fetchImpl };
  try {
    const [verb, ...tokens] = argv;
    if (!verb || verb === "help" || verb === "--help") {
      ctx.out(json({ usage: USAGE }));
      return { code: verb ? 0 : 1 };
    }
    const { flags, rest } = parseArgs(tokens);
    const dir = path.resolve(ctx.cwd, flags.dir ?? DEFAULT_DIR);
    let result;
    switch (verb) {
      case "init":
        result = init(dir, flags, ctx);
        break;
      case "check":
        result = check(dir);
        break;
      case "plan":
        result = await plan(dir, flags, ctx);
        break;
      case "serve": {
        const s = await serve(dir, flags, ctx);
        ctx.out(json(s.result));
        return { code: 0, server: s.server };
      }
      case "worker":
        result = workerFolder(dir, flags, ctx);
        break;
      case "connect":
        result = connectInfo(dir, flags, ctx);
        break;
      case "publish": {
        const r = roundOf(flags);
        result = await publish(dir, r, codingConn(dir, flags, ctx.env, ctx));
        markPublished(dir, r);
        break;
      }
      case "bundle":
        result = await bundle(dir, roundOf(flags), { url: urlOf(dir, flags), fetchImpl: ctx.fetchImpl });
        markPublished(dir, roundOf(flags));
        break;
      case "note": {
        const text = rest.join(" ").trim();
        if (!text) bad('note needs the text, like: note "Start with the cafe owner." [--round 2]');
        result = await codingConn(dir, flags, ctx.env, ctx).call("post_note", { text, ...(flags.round ? { round: intFlag(flags, "round") } : {}) });
        break;
      }
      case "notes-clear":
        result = await codingConn(dir, flags, ctx.env, ctx).call("clear_notes", flags.id ? { id: intFlag(flags, "id") } : {});
        break;
      case "status": {
        const conn = codingConn(dir, flags, ctx.env, ctx);
        result = flags.round ? await conn.call("list_reports", { round: intFlag(flags, "round") }) : await conn.call("rounds", {});
        break;
      }
      case "questions":
        result = await codingConn(dir, flags, ctx.env, ctx).call("open_questions", {});
        break;
      case "answer": {
        const text = rest.join(" ").trim();
        if (!flags.id || !text) bad('answer needs --id <question id> and the text, like: answer --id 3 "Yes, use the second link."');
        result = await codingConn(dir, flags, ctx.env, ctx).call("answer", { question_id: intFlag(flags, "id"), text });
        break;
      }
      case "close":
        result = await codingConn(dir, flags, ctx.env, ctx).call("close_round", { round: roundOf(flags), ...(flags.reopen ? { reopen: true } : {}) });
        break;
      case "fetch":
        result = await fetchReports(dir, roundOf(flags), codingConn(dir, flags, ctx.env, ctx), { secretPaths: secretPathsOf(dir) });
        break;
      case "read": {
        const r = roundOf(flags);
        const f = collect(dir, r);
        result = { round: r, file: `findings-r${r}.json`, briefs: f.briefs, reports: f.reports, missing: f.missing, unreadable: f.unreadable.filter(isReportFile).length, other_files_unreadable: f.unreadable.filter((u) => !isReportFile(u)).map((u) => u.file), findings: f.findings.length, known_met: f.known_met.count };
        break;
      }
      case "deliver": {
        const r = roundOf(flags);
        const d = deliver(dir, r, { picksFile: flags.picks ? path.resolve(ctx.cwd, flags.picks) : null });
        result = { round: r, deck: rel(ctx.cwd, d.deckFile), markdown: rel(ctx.cwd, d.mdFile), cards: d.cards, findings: d.findings };
        break;
      }
      case "known":
        result = known(dir, flags, rest);
        break;
      case "fixing":
        result = fixing(dir, rest);
        break;
      default:
        return bad(`Unknown verb "${String(verb).slice(0, 40)}". ${USAGE}`);
    }
    ctx.out(json(result));
    return { code: 0 };
  } catch (e) {
    const code = e instanceof CliError ? e.code : e?.refused || /^A side round cannot be planned|is already planned/.test(String(e?.message)) ? 2 : 1;
    if (e?.data) ctx.out(json(e.data));
    ctx.err(`${String(e?.message ?? e).split("\n")[0]}\n`);
    return { code };
  }
}

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  run(process.argv.slice(2)).then(({ code, server }) => {
    if (server) {
      const stop = () => server.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    } else process.exitCode = code;
    if (server && code !== 0) process.exit(code);
  });
}
