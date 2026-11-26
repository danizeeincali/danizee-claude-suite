/**
 * The persona connector over HTTP, as a `Request` to `Response` function that runs in Node and in a Cloudflare Worker.
 *
 *   POST /mcp              Authorization: Bearer <key>   the MCP server; the key decides the role
 *   POST /k/<key>/mcp                                    the same, for clients that cannot send a header
 *   POST /bundle                                         a round posted for publish_round to name (no sign-in)
 *   GET  /export?code=                                   a round's reports, for the code export_round answered
 *
 * Off unless keyed: with no valid key every path is a plain 404. Keys are compared as SHA-256 digests with a
 * constant-time loop. A thrown error is 500 `unavailable` and nothing about it reaches the body or a log.
 */
import { handleRpc, PARSE_ERROR } from "./mcp.js";
import { readExport, receiveBundle, reserveHour } from "./tools.js";

export const MAX_MCP_BYTES = 2 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
export const BUNDLES_PER_HOUR = 6;
export const EXPORTS_PER_HOUR = 30;
export const MIN_KEY_CHARS = 24;

const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff", "content-type": "application/json; charset=utf-8" };
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const noBody = (status) => new Response(null, { status, headers: { "cache-control": "no-store" } });
const notFound = () => json(404, { error: "not_found" });
const enc = new TextEncoder();

/** A key counts only as a string of 24 or more characters. */
const valid = (k) => typeof k === "string" && k.length >= MIN_KEY_CHARS;

const digest = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
/** Whether two equal-length digests are equal, looking at every byte whatever the answer. */
function same(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i] ?? 0);
  return diff === 0;
}

/** The body as text, or null when it is longer than `max` bytes (the stream is cancelled at the limit). */
async function readCapped(request, max) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The poster as a keyed hash (16 hex characters) that changes each UTC day, never the address; "" when there is none. */
async function visitorOf(secret, ip, now) {
  if (typeof ip !== "string" || ip === "") return "";
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const day = new Date(now).toISOString().slice(0, 10);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(`persona-visitor:${day}:${ip}`)));
  return [...sig.slice(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {{ db: object | (() => object | Promise<object>), testerKey?: string, codingKey?: string, product?: string,
 *   secretPaths?: string[], now?: () => number, clientIp?: (request: Request) => string | null }} options
 * @returns {(request: Request) => Promise<Response>}
 */
export function createHandler({ db, testerKey, codingKey, product = "This product", secretPaths = [], now = () => Date.now(), clientIp = () => null }) {
  const keys = [];
  if (valid(testerKey) && valid(codingKey) && testerKey === codingKey) {
    // One value for both roles would make a tester a coding thread: neither counts.
  } else {
    if (valid(testerKey)) keys.push({ role: "tester", key: testerKey });
    if (valid(codingKey)) keys.push({ role: "coding", key: codingKey });
  }
  const secret = valid(codingKey) ? codingKey : valid(testerKey) ? testerKey : "";
  let digests = null;

  /** The role a presented key opens, or null; every configured key is compared whatever the outcome. */
  async function roleOf(presented) {
    if (typeof presented !== "string" || presented === "") return null;
    digests ??= await Promise.all(keys.map(async (k) => ({ role: k.role, d: await digest(k.key) })));
    const mine = await digest(presented);
    let role = null;
    for (const k of digests) if (same(mine, k.d)) role = k.role;
    return role;
  }

  const store = async () => (typeof db === "function" ? db() : db);

  async function serveMcp(request, role) {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
    const raw = await readCapped(request, MAX_MCP_BYTES);
    if (raw === null) return json(413, { error: "too_large" });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error: the body is not JSON." } });
    }
    const reply = await handleRpc(body, { db: await store(), now: now(), role, product, secretPaths });
    return reply === null ? noBody(202) : json(200, reply);
  }

  async function serveBundle(request) {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== new URL(request.url).origin) return json(403, { error: "forbidden" });
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) return json(415, { error: "unsupported_media_type" });
    if (Number(request.headers.get("content-length") ?? "0") > MAX_BUNDLE_BYTES) return json(413, { error: "too_large" });
    const at = now();
    const visitor = await visitorOf(secret, clientIp(request), at);
    const d = await store();
    if (!(await reserveHour(d, `bundle:${visitor}`, BUNDLES_PER_HOUR, at))) return json(429, { error: "rate_limited" });
    const text = await readCapped(request, MAX_BUNDLE_BYTES);
    if (text === null) return json(413, { error: "too_large" });
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return json(400, { error: "bad_request" });
    }
    const r = await receiveBundle(d, raw, at, visitor, { secretPaths });
    if (r.status === 201) return json(201, { code: r.code });
    return json(r.status, { error: r.status === 503 ? "full" : r.status === 413 ? "too_large" : "bad_request", text: r.error });
  }

  async function serveExport(request) {
    if (request.method !== "GET") return json(405, { error: "method_not_allowed" }, { allow: "GET" });
    const at = now();
    const visitor = await visitorOf(secret, clientIp(request), at);
    const d = await store();
    if (!(await reserveHour(d, `export:${visitor}`, EXPORTS_PER_HOUR, at))) return json(429, { error: "rate_limited" });
    const body = await readExport(d, new URL(request.url).searchParams.get("code") ?? "", at);
    return body === null ? notFound() : json(200, body);
  }

  return async function handle(request) {
    if (keys.length === 0) return notFound();
    try {
      const path = new URL(request.url).pathname;
      if (path === "/mcp") {
        if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "POST" });
        const m = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "");
        const role = await roleOf(m ? m[1] : null);
        if (role === null) return json(401, { error: "unauthorized" }, { "www-authenticate": "Bearer" });
        return await serveMcp(request, role);
      }
      const k = /^\/k\/([^/]+)\/mcp$/.exec(path);
      if (k) {
        let presented = null;
        try {
          presented = decodeURIComponent(k[1]);
        } catch {
          return notFound();
        }
        const role = await roleOf(presented);
        if (role === null) return notFound();
        return await serveMcp(request, role);
      }
      if (path === "/bundle") return await serveBundle(request);
      if (path === "/export") return await serveExport(request);
      return notFound();
    } catch {
      return json(500, { error: "unavailable" });
    }
  };
}
