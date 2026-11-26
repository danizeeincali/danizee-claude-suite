/**
 * The persona connector as a local server (Node only): `startServer` over a SQLite file, and a script entry.
 *
 *   node serve.js --db <file> [--port 8787] [--host 127.0.0.1] [--product "Name"] [--keys <json file>]
 *
 * Keys come from PERSONA_TESTER_KEY and PERSONA_CODING_KEY, else from the --keys file ({tester_key, coding_key}). The
 * script prints one JSON line {url, mcp} and never a key. With no valid key it exits 1 with one sentence.
 */
import http from "node:http";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createHandler, MIN_KEY_CHARS } from "./http.js";
import { openStore } from "./sqlite.js";

const NO_KEYS = `The server needs a tester key and a coding key, each at least ${MIN_KEY_CHARS} characters and different from each other.`;
const okKey = (k) => typeof k === "string" && k.length >= MIN_KEY_CHARS;

/**
 * Starts the server and answers once it is listening.
 * @param {{ file?: string, port?: number, host?: string, testerKey?: string, codingKey?: string, product?: string, secretPaths?: string[] }} options
 * @returns {Promise<{ url: string, mcp: string, close: () => Promise<void> }>}
 */
export async function startServer({ file = ":memory:", port = 8787, host = "127.0.0.1", testerKey, codingKey, product, secretPaths = [] } = {}) {
  if (!okKey(testerKey) || !okKey(codingKey) || testerKey === codingKey) throw new Error(NO_KEYS);
  const store = openStore(file);
  const handler = createHandler({ db: store, testerKey, codingKey, product, secretPaths, clientIp: (r) => r.headers.get("x-persona-peer") });
  const server = http.createServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && k !== "x-persona-peer") headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      headers.set("x-persona-peer", req.socket.remoteAddress ?? "");
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, { method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: "half" });
      const response = await handler(request);
      const out = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(out);
    } catch {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unavailable" }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const { port: bound } = server.address();
  const url = `http://${host.includes(":") ? `[${host}]` : host}:${bound}`;
  return {
    url,
    mcp: `${url}/mcp`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          store.close();
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}

/** The value after `--name` in argv, or undefined. */
const flag = (argv, name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};

/**
 * What the script does: reads the options, starts the server and prints the one line.
 * @param {string[]} argv The arguments after the script.
 * @param {Record<string, string | undefined>} env
 * @param {(line: string) => void} print
 */
export async function runScript(argv, env, print) {
  let testerKey = env.PERSONA_TESTER_KEY;
  let codingKey = env.PERSONA_CODING_KEY;
  const keysFile = flag(argv, "keys");
  if ((!okKey(testerKey) || !okKey(codingKey)) && keysFile) {
    try {
      const j = JSON.parse(readFileSync(keysFile, "utf8"));
      testerKey = j.tester_key;
      codingKey = j.coding_key;
    } catch {
      throw new Error("The keys file could not be read as {tester_key, coding_key}.");
    }
  }
  const port = flag(argv, "port");
  const server = await startServer({ file: flag(argv, "db"), port: port === undefined ? undefined : Number(port), host: flag(argv, "host"), testerKey, codingKey, product: flag(argv, "product") });
  print(JSON.stringify({ url: server.url, mcp: server.mcp }));
  return server;
}

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  runScript(process.argv.slice(2), process.env, (line) => process.stdout.write(`${line}\n`)).catch((e) => {
    process.stderr.write(`${String(e?.message ?? e).split("\n")[0]}\n`);
    process.exit(1);
  });
}
