/**
 * The persona connector's MCP server: JSON-RPC 2.0 over a stateless transport (no session, no stream). One function,
 * `handleRpc`, turns one message (or a batch) into its answer; `http.js` does the sign-in and the wire. Runs unchanged in
 * Node and in a Cloudflare Worker.
 */
import { callTool, toolsFor } from "./tools.js";

export const SERVER_NAME = "persona-tester";
export const SERVER_VERSION = "1.0.0";
/** Protocol versions an initialize may ask for; anything else gets the last. */
export const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
export const MAX_BATCH = 16;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
export { PARSE_ERROR };

/** What the server tells a client about itself; `<product>` is the project's name. */
const INSTRUCTIONS =
  "Persona testing for <product> (a dev tool, not the product). The tester takes walks: next_walk gives the next brief, guide gives the rules and the report's exact shape, start_walk starts a walk's clock (call it just before each walk), submit_report hands a report in and lists every problem until it is accepted, ask and answers reach the coding thread. The coding thread publishes rounds (publish_round, from briefs or from a bundle posted to this server), reads reports (list_reports, get_report, export_round) and answers questions (open_questions, answer). On every check call notes first (the coding thread leaves messages there), then do any open walk, one at a time. notes and next_walk answer check_again_minutes: wait that many minutes before checking again, and never check while a walk is under way. The coding thread posts notes with post_note and clears them with clear_notes. Never put anything after a # of an address, or a sign-in link, into a report or a question.";

const isRec = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
const error = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

/**
 * The answer to one JSON-RPC message, an array of answers to a batch, or null when there is nothing to send back (a
 * notification, or a batch of nothing but notifications).
 * @param {unknown} message The parsed body.
 * @param {{ db: object | undefined, now?: number, role?: "tester" | "coding", product?: string, secretPaths?: string[] }} deps
 * @returns {Promise<object | object[] | null>}
 */
export async function handleRpc(message, deps) {
  if (!Array.isArray(message)) return one(message, deps);
  if (message.length === 0 || message.length > MAX_BATCH) return error(null, INVALID_REQUEST, `A batch holds 1 to ${MAX_BATCH} messages.`);
  const replies = [];
  for (const m of message) {
    const r = await one(m, deps);
    if (r) replies.push(r);
  }
  return replies.length === 0 ? null : replies;
}

async function one(msg, deps) {
  if (!isRec(msg) || msg.jsonrpc !== "2.0") return error(isRec(msg) && isId(msg.id) ? msg.id : null, INVALID_REQUEST, "Not a JSON-RPC 2.0 message.");
  if (typeof msg.method !== "string") {
    // A reply to something this server asked (it never asks): nothing to answer.
    if (isId(msg.id) && ("result" in msg || "error" in msg)) return null;
    return error(isId(msg.id) ? msg.id : null, INVALID_REQUEST, "A request needs a method.");
  }
  if (!("id" in msg) || msg.method.startsWith("notifications/")) return null;
  if (!isId(msg.id)) return error(null, INVALID_REQUEST, "A request id must be a string or a number.");
  const id = msg.id;
  const params = msg.params;
  if (params !== undefined && !isRec(params)) return error(id, INVALID_PARAMS, "params must be an object.");
  const role = deps?.role === "coding" ? "coding" : "tester";
  switch (msg.method) {
    case "initialize": {
      const product = typeof deps?.product === "string" && deps.product.trim() ? deps.product.trim() : "This product";
      const asked = params?.protocolVersion;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1],
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, title: `${product} persona testing (dev)`, version: SERVER_VERSION },
          instructions: INSTRUCTIONS.replace("<product>", product),
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: toolsFor(role) } };
    case "tools/call":
      return { jsonrpc: "2.0", id, result: await callTool(params?.name, params?.arguments, { db: deps?.db, now: deps?.now, role, secretPaths: deps?.secretPaths }) };
    default:
      return error(id, METHOD_NOT_FOUND, `Method not found: ${msg.method.slice(0, 80)}`);
  }
}
