/**
 * The persona-testing connector's tools: a dev tool for a tester (a separate Claude thread that walks a product as a
 * person would) and the coding thread. The tester takes a walk (`next_walk`, `get_brief`, `guide`), hands its report in
 * (`submit_report`) and asks (`ask`, `answers`); the coding thread publishes a round (`publish_round`), closes it
 * (`close_round`), reads what came back (`list_reports`, `get_report`, `rounds`) and answers (`open_questions`, `answer`).
 * Everything lives in one SQL database behind a small D1-like interface: `db.prepare(sql).bind(...).first()/all()/run()`
 * and, when it has one, `db.batch([statements])` as one transaction. The tables are in {@link SCHEMA}.
 *
 * A report is read by the one validator the reader uses (`report-shape.js`) and is stricter here: any problem line rejects
 * it. A rejected report is kept, with status rejected, so the coding thread can see it, but never counts. Bodies are
 * stripped of secrets (anything after a # of an address, a link key, the project's own secret paths) before they are
 * written. Every answer is short JSON text; a refusal is JSON `{error}` with `isError`, never a throw.
 *
 * Runs unchanged in Node and in a Cloudflare Worker: no `node:` import here.
 */
import { REPORT_NAME, stripDeep, stripFragments, submissionProblems } from "./report-shape.js";

/**
 * The whole schema, one statement per `;`, every one safe to apply twice. `schema.sql` holds the same text (a test holds
 * them equal); a Worker applies it with `wrangler d1 execute`, the local server applies it on open.
 */
export const SCHEMA = `-- The persona-testing connector's tables. Every statement is safe to apply twice.
-- Rows older than 90 days are deleted on the next write. Sizes are bytes of UTF-8.

-- persona_rounds: one row per published round: its guide, and when it was closed (a closed round is never served).
CREATE TABLE IF NOT EXISTS persona_rounds (
  round      INTEGER PRIMARY KEY CHECK (round BETWEEN 1 AND 9999),
  guide      TEXT CHECK (guide IS NULL OR length(CAST(guide AS BLOB)) <= 65536),
  closed_at  TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_briefs (
  walk_id    TEXT PRIMARY KEY CHECK (length(walk_id) BETWEEN 4 AND 100 AND walk_id GLOB 'r[0-9]*-*' AND walk_id NOT GLOB '*[^a-z0-9-]*'),
  round      INTEGER NOT NULL CHECK (round BETWEEN 1 AND 9999),
  body       TEXT NOT NULL CHECK (length(CAST(body AS BLOB)) <= 65536),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS persona_briefs_round ON persona_briefs (round, walk_id);

-- persona_walks: when a walk was started, by the server's clock (start_walk).
CREATE TABLE IF NOT EXISTS persona_walks (
  walk_id    TEXT PRIMARY KEY CHECK (length(walk_id) BETWEEN 4 AND 100),
  started_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_reports (
  walk_id     TEXT NOT NULL CHECK (length(walk_id) BETWEEN 4 AND 100),
  version     INTEGER NOT NULL CHECK (version >= 1),
  body        TEXT NOT NULL CHECK (length(CAST(body AS BLOB)) <= 262144),
  status      TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
  problems    TEXT NOT NULL CHECK (length(problems) <= 262144),
  received_at TEXT NOT NULL,
  started_at  TEXT,
  PRIMARY KEY (walk_id, version)
);
CREATE INDEX IF NOT EXISTS persona_reports_received ON persona_reports (received_at);

CREATE TABLE IF NOT EXISTS persona_questions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  walk_id  TEXT CHECK (walk_id IS NULL OR length(walk_id) BETWEEN 4 AND 100),
  text     TEXT NOT NULL CHECK (length(text) >= 1 AND length(CAST(text AS BLOB)) <= 4096),
  asked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_answers (
  question_id INTEGER PRIMARY KEY REFERENCES persona_questions (id) ON DELETE CASCADE,
  text        TEXT NOT NULL CHECK (length(text) >= 1 AND length(CAST(text AS BLOB)) <= 4096),
  answered_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS persona_answers_answered ON persona_answers (answered_at);

-- persona_notes: the note board. The coding thread posts, the tester reads on every check, the oldest drop past 50.
CREATE TABLE IF NOT EXISTS persona_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  round      INTEGER CHECK (round IS NULL OR round BETWEEN 1 AND 9999),
  text       TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 8000),
  created_at TEXT NOT NULL
);

-- persona_bundles, persona_bundle_briefs: a round posted to the server and kept pending under a random code until
-- publish_round names it. Inert (no tool reads it otherwise), gone after an hour. visitor is a keyed hash, never an address.
CREATE TABLE IF NOT EXISTS persona_bundles (
  code       TEXT PRIMARY KEY CHECK (length(code) = 10),
  round      INTEGER NOT NULL CHECK (round BETWEEN 1 AND 9999),
  guide      TEXT CHECK (guide IS NULL OR length(CAST(guide AS BLOB)) <= 65536),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  visitor    TEXT NOT NULL DEFAULT '',
  bytes      INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0)
);
CREATE INDEX IF NOT EXISTS persona_bundles_expires ON persona_bundles (expires_at);

CREATE TABLE IF NOT EXISTS persona_bundle_briefs (
  code    TEXT NOT NULL REFERENCES persona_bundles (code) ON DELETE CASCADE,
  walk_id TEXT NOT NULL CHECK (length(walk_id) BETWEEN 4 AND 100),
  body    TEXT NOT NULL CHECK (length(CAST(body AS BLOB)) <= 65536),
  PRIMARY KEY (code, walk_id)
);

-- persona_exports: a short-lived code that opens a round's reports once or a few times.
CREATE TABLE IF NOT EXISTS persona_exports (
  code       TEXT PRIMARY KEY CHECK (length(code) = 10),
  round      INTEGER NOT NULL CHECK (round BETWEEN 1 AND 9999),
  reads      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS persona_exports_expires ON persona_exports (expires_at);

-- persona_rate: how many times a visitor (a keyed hash) did something this UTC hour.
CREATE TABLE IF NOT EXISTS persona_rate (
  key  TEXT NOT NULL,
  hour TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, hour)
);
`;

/**
 * Sizes and counts kept. A report's problem list is cut to its first `problemsShown` lines (plus one saying how many
 * more), in the answer and in storage, so the stored list stays far under the column's limit however bad a report is.
 * A walk keeps at most `versionsPerWalk` versions, so one walk stuck handing in again can never fill its round.
 */
export const CAPS = { briefBytes: 64 * 1024, reportBytes: 256 * 1024, textBytes: 4 * 1024, rowsPerRound: 500, versionsPerWalk: 30, questions: 2000, problemsShown: 60 };
export const RETENTION_DAYS = 90;
/** A pending bundle lives an hour; at most this many are pending at once (every visitor together). */
export const BUNDLE_TTL_MS = 3_600_000;
export const MAX_PENDING_BUNDLES = 20;
/** At most this many pending bundles per visitor (a third replaces their oldest), one bundle at most this big, and every pending bundle together. */
export const BUNDLES_PER_VISITOR = 2;
export const MAX_BUNDLE_CONTENT_BYTES = 4 * 1024 * 1024;
export const MAX_PENDING_BYTES = 32 * 1024 * 1024;
/** An export code lives 15 minutes or 3 reads; at most this many are live at once. */
export const EXPORT_TTL_MS = 15 * 60_000;
export const EXPORT_READS = 3;
export const MAX_LIVE_EXPORTS = 20;
/** The note board: a note's length in characters, notes kept (the oldest drop), and notes answered at once. */
export const NOTE_CHARS = 2000;
export const MAX_NOTES = 50;
export const NOTES_SHOWN = 20;
/** A walk's start can be taken again when it has no accepted report and its start is over this old. */
export const RESTART_AFTER_MS = 3 * 3_600_000;
const MAX_ROUND = 9999;
const MAX_ANSWERS = 200;

/** The refusal a tester gets for a tool that is the coding thread's. */
export const CODING_ONLY = "That tool is for the coding thread.";

/** Ten characters a person can read out: lower-case letters and the digits 2 to 9. */
export const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz23456789";
export const CODE_RE = /^[a-z2-9]{10}$/;
/** A fresh code, drawn without bias (bytes past the last whole alphabet are drawn again). */
export function newCode(random = (b) => void crypto.getRandomValues(b)) {
  const n = CODE_ALPHABET.length;
  const cap = 256 - (256 % n);
  let out = "";
  const buf = new Uint8Array(16);
  while (out.length < 10) {
    random(buf);
    for (const x of buf) {
      if (x >= cap) continue;
      out += CODE_ALPHABET[x % n];
      if (out.length === 10) break;
    }
  }
  return out;
}

const WALK_ID = { type: "string", pattern: "^r\\d+-[a-z0-9-]{1,80}$", description: "The walk's id, the brief's name, like r2-04-walk-ins-owner-cold-app." };
const ROUND = { type: "integer", minimum: 1, maximum: MAX_ROUND };
const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const READS = { readOnlyHint: true, openWorldHint: false };

/** Every tool, with the role that may call it (`role` is internal and is left out of `toolsFor`). */
export const TOOLS = [
  {
    name: "next_walk",
    role: "tester",
    description: "The next walk to do: the first walk with no accepted report yet of the newest round that is open and still has one (or of the round you name). Answers {id, round, brief}, or {done: true} when every open round has its reports; both carry check_again_minutes: check again after `check_again_minutes`; never check while a walk is under way.",
    inputSchema: { type: "object", properties: { round: { ...ROUND, description: "A round number; leave it out for the newest open round with a walk to do." } }, additionalProperties: false },
    annotations: { title: "Next walk", ...READS },
  },
  {
    name: "get_brief",
    role: "tester",
    description: "One walk's brief by its id: who you are, which door you arrive through and what to try.",
    inputSchema: { type: "object", properties: { id: WALK_ID }, required: ["id"], additionalProperties: false },
    annotations: { title: "Get a brief", ...READS },
  },
  {
    name: "start_walk",
    role: "tester",
    description: "Start a walk's clock: call it with the walk's id just before you begin, as next_walk says. The server stamps the time (the first call wins, so calling again is harmless) and every report's minutes are counted from it. Answers {id, started, already}.",
    inputSchema: { type: "object", properties: { id: WALK_ID }, required: ["id"], additionalProperties: false },
    annotations: { title: "Start a walk", ...WRITES, idempotentHint: true },
  },
  {
    name: "submit_report",
    role: "tester",
    description: "Hand in a walk's report: the whole report text, one fenced json block then prose, exactly as the guide shows. A walk that was never started with start_walk is refused, and so is a walk of a closed round. Answers {accepted: true, version, clock_minutes}, or {accepted: false, version, problems} listing every problem in plain words; fix them and hand it in again. Each hand-in is a new version and the latest accepted one is the walk's report. Never put anything after a # of an address in it.",
    inputSchema: { type: "object", properties: { id: WALK_ID, report: { type: "string", description: "The report as text, at most 256 KB." } }, required: ["id", "report"], additionalProperties: false },
    annotations: { title: "Hand in a report", ...WRITES },
  },
  {
    name: "ask",
    role: "tester",
    description: "Ask the coding thread a question, about one walk or in general. Answers {question_id}; the answer comes back through answers.",
    inputSchema: { type: "object", properties: { id: { ...WALK_ID, description: "The walk it is about; leave it out for a general question." }, question: { type: "string", description: "The question, at most 4 KB." } }, required: ["question"], additionalProperties: false },
    annotations: { title: "Ask a question", ...WRITES },
  },
  {
    name: "answers",
    role: "tester",
    description: "Answered questions, newest last; give since (a UTC time like 2026-11-25T17:05:00Z) for only those answered after it.",
    inputSchema: { type: "object", properties: { since: { type: "string", description: "Only answers given after this UTC time." } }, additionalProperties: false },
    annotations: { title: "Answers", ...READS },
  },
  {
    name: "guide",
    role: "tester",
    description: "The tester's guide: what a walk is, the ground rules and the report's exact shape. Answers the guide of the round you name, else of the round next_walk would serve, else of the latest round that has one. On every check call notes first, then do any open walk.",
    inputSchema: { type: "object", properties: { round: { ...ROUND, description: "A round number; leave it out for the round next_walk would serve." } }, additionalProperties: false },
    annotations: { title: "The guide", ...READS },
  },
  {
    name: "notes",
    role: "tester",
    description: "For the tester: call this first on every check. The notes the coding thread left, newest first, at most 20, each {id, at, round, text}; give since (a note id or a UTC time) for only newer ones (then the oldest 20 newer ones come back, and more says how many are left: call again with the highest id you got). Also answers open_walks, how many walks of every open round still have no accepted report, and open_rounds, [{round, open}] newest first, so one call says whether there is anything to do. Answers check_again_minutes too: check again after `check_again_minutes`; never check while a walk is under way.",
    inputSchema: { type: "object", properties: { since: { type: ["string", "integer"], description: "A note id, or a UTC time like 2026-11-25T17:05:00Z; only newer notes come back." } }, additionalProperties: false },
    annotations: { title: "Notes", ...READS },
  },
  {
    name: "publish_round",
    role: "coding",
    description: "For the coding thread: publish a round's briefs (and optionally its guide), replacing that round's briefs, either as briefs or as bundle, the code a bundle posted to this server answered (exactly one of the two; the bundle brings its own guide). A closed round is opened again. Refused if it would drop a walk that already has an accepted report. Ids start r<round>- and use lower-case letters, digits and hyphens; at most 500 briefs of 64 KB each. To post a bundle: POST <this server>/bundle with the json {round, guide?, briefs: [{id, brief}]}; it answers {code}.",
    inputSchema: {
      type: "object",
      properties: {
        round: ROUND,
        guide: { type: "string", description: "The tester's guide text, at most 64 KB; leave it out to keep the one there." },
        briefs: { type: "array", minItems: 1, maxItems: CAPS.rowsPerRound, items: { type: "object", properties: { id: WALK_ID, brief: { type: "string" } }, required: ["id", "brief"], additionalProperties: false } },
        bundle: { type: "string", description: "The code POST <this server>/bundle answered, in place of briefs." },
      },
      required: ["round"],
      additionalProperties: false,
    },
    annotations: { title: "Publish a round", ...WRITES, destructiveHint: true },
  },
  {
    name: "close_round",
    role: "coding",
    description: "For the coding thread: close a round so next_walk never serves it and no report is taken for its walks (its reports stay readable); give reopen: true to open it again. Answers {round, closed}.",
    inputSchema: { type: "object", properties: { round: ROUND, reopen: { type: "boolean", description: "true opens the round again." } }, required: ["round"], additionalProperties: false },
    annotations: { title: "Close a round", ...WRITES, idempotentHint: true },
  },
  {
    name: "rounds",
    role: "coding",
    description: "For the coding thread: every round, newest first, as {round, briefs, accepted, open, closed, has_guide, updated}.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Rounds", ...READS },
  },
  {
    name: "export_round",
    role: "coding",
    description: "For the coding thread: a code for a round's reports. GET <this server>/export?code=<code> answers them as JSON (the latest accepted version of each walk, else its latest, with when it started, when it came and the clock minutes between). The code dies after 15 minutes or 3 reads. Answers {code, expires}.",
    inputSchema: { type: "object", properties: { round: ROUND }, required: ["round"], additionalProperties: false },
    annotations: { title: "Export a round", ...WRITES },
  },
  {
    name: "post_note",
    role: "coding",
    description: "For the coding thread: leave the tester a note (at most 2,000 characters; nothing after a # of an address is kept). The tester reads it with notes on its next check. Answers {id, at}; the oldest of 50 notes drop.",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "The note, at most 2,000 characters." }, round: { ...ROUND, description: "The round it is about, if one." } }, required: ["text"], additionalProperties: false },
    annotations: { title: "Post a note", ...WRITES },
  },
  {
    name: "clear_notes",
    role: "coding",
    description: "For the coding thread: remove one note by id, or every note when no id is given. Answers {cleared}.",
    inputSchema: { type: "object", properties: { id: { type: "integer", minimum: 1 } }, additionalProperties: false },
    annotations: { title: "Clear notes", ...WRITES, destructiveHint: true },
  },
  {
    name: "list_reports",
    role: "coding",
    description: "For the coding thread: every walk of a round with its report's status (accepted, rejected or none), version, when it came, how many problems it has, when the walk started and the clock minutes between.",
    inputSchema: { type: "object", properties: { round: ROUND }, required: ["round"], additionalProperties: false },
    annotations: { title: "List reports", ...READS },
  },
  {
    name: "get_report",
    role: "coding",
    description: "For the coding thread: one walk's report text with its status and problems; the latest accepted version unless you name one (the latest version when none was accepted).",
    inputSchema: { type: "object", properties: { id: WALK_ID, version: { type: "integer", minimum: 1 } }, required: ["id"], additionalProperties: false },
    annotations: { title: "Get a report", ...READS },
  },
  {
    name: "open_questions",
    role: "coding",
    description: "For the coding thread: the tester's questions that have no answer yet, oldest first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Open questions", ...READS },
  },
  {
    name: "answer",
    role: "coding",
    description: "For the coding thread: answer one of the tester's questions (answering again replaces the answer).",
    inputSchema: { type: "object", properties: { question_id: { type: "integer", minimum: 1 }, text: { type: "string", description: "The answer, at most 4 KB." } }, required: ["question_id", "text"], additionalProperties: false },
    annotations: { title: "Answer a question", ...WRITES },
  },
];

const byName = (name) => TOOLS.find((t) => t.name === name);
/** Whether `v` is the name of a tool. */
export const isToolName = (v) => typeof v === "string" && TOOLS.some((t) => t.name === v);

/** The tool definitions (name, description, inputSchema, annotations) a role may call: the coding role every one, the tester its own. */
export function toolsFor(role) {
  return TOOLS.filter((t) => role === "coding" || t.role === "tester").map(({ role: _role, ...def }) => def);
}

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const refuse = (error) => ({ content: [{ type: "text", text: JSON.stringify({ error }) }], isError: true });
class Refusal extends Error {}
const no = (why) => {
  throw new Refusal(why);
};

const bytes = (s) => new TextEncoder().encode(s).length;
const kb = (n) => `${n / 1024} KB`;
const iso = (ms) => new Date(ms).toISOString();
const isRec = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** The arguments as an object holding only the tool's own keys. */
function argsOf(name, raw) {
  if (raw === undefined || raw === null) return {};
  if (!isRec(raw)) no("The arguments must be an object.");
  const allowed = Object.keys(byName(name).inputSchema.properties);
  for (const k of Object.keys(raw)) if (!allowed.includes(k)) no(`${name} takes no ${k.slice(0, 40)}${allowed.length ? `; it takes ${allowed.join(", ")}` : ""}.`);
  return raw;
}
function walkId(v, what = "id") {
  if (typeof v !== "string" || !REPORT_NAME.test(v)) no(`${what} must be a walk id like r2-04-walk-ins-owner-cold-app: r, the round, a hyphen, then lower-case letters, digits and hyphens.`);
  return v;
}
function round(v) {
  if (!Number.isInteger(v) || v < 1 || v > MAX_ROUND) no(`round must be a whole number from 1 to ${MAX_ROUND}.`);
  return v;
}
function text(v, what, cap) {
  if (typeof v !== "string" || v.trim() === "") no(`${what} must be text.`);
  if (bytes(v) > cap) no(`${what} is over ${kb(cap)}.`);
  return v;
}

/** Deletes every row older than the retention window (and every spent code); run before each write. */
function retention(db, now) {
  const cut = iso(now - RETENTION_DAYS * 86_400_000);
  return [
    db.prepare("DELETE FROM persona_answers WHERE answered_at < ? OR question_id IN (SELECT id FROM persona_questions WHERE asked_at < ?)").bind(cut, cut),
    db.prepare("DELETE FROM persona_questions WHERE asked_at < ?").bind(cut),
    db.prepare("DELETE FROM persona_reports WHERE received_at < ?").bind(cut),
    db.prepare("DELETE FROM persona_briefs WHERE updated_at < ?").bind(cut),
    db.prepare("DELETE FROM persona_rounds WHERE updated_at < ?").bind(cut),
    db.prepare("DELETE FROM persona_walks WHERE started_at < ?").bind(cut),
    db.prepare("DELETE FROM persona_bundle_briefs WHERE code IN (SELECT code FROM persona_bundles WHERE expires_at <= ?)").bind(iso(now)),
    db.prepare("DELETE FROM persona_bundles WHERE expires_at <= ?").bind(iso(now)),
    db.prepare("DELETE FROM persona_exports WHERE expires_at <= ?").bind(iso(now)),
  ];
}
async function inOrder(db, statements) {
  if (db.batch) await db.batch(statements);
  else for (const s of statements) await s.run();
}
const write = (db, now, statements) => inOrder(db, [...retention(db, now), ...statements]);

const brief = (db, id) => db.prepare("SELECT walk_id, round, body FROM persona_briefs WHERE walk_id = ?").bind(id).first();
const startOf = async (db, id) => (await db.prepare("SELECT started_at FROM persona_walks WHERE walk_id = ?").bind(id).first())?.started_at ?? null;
const isClosed = async (db, r) => ((await db.prepare("SELECT closed_at FROM persona_rounds WHERE round = ?").bind(r).first())?.closed_at ?? null) !== null;
/** Whole minutes (rounded) from a walk's start to its report; null when either is missing. */
const clockMinutes = (started, received) => (started && received ? Math.max(0, Math.round((Date.parse(received) - Date.parse(started)) / 60_000)) : null);
/** A stored problem list: the lines shown (at most `problemsShown` plus the "more" line) and how many there were in all. */
const problemsOf = (row) => {
  try {
    const p = JSON.parse(row.problems);
    const lines = Array.isArray(p.lines) ? p.lines.map(String) : [];
    return { lines, total: typeof p.total === "number" ? p.total : lines.length };
  } catch {
    return { lines: [], total: 0 };
  }
};
/** The first lines of a problem list, and one more saying how many were left out. */
const capped = (problems) =>
  problems.length <= CAPS.problemsShown ? problems : [...problems.slice(0, CAPS.problemsShown), `…and ${problems.length - CAPS.problemsShown} more problems; fix these and hand it in again to see the rest.`];
/** The walk's report: the latest accepted version, else the latest version, else null. */
const walkReport = (db, id) =>
  db.prepare("SELECT walk_id, version, body, status, problems, received_at, started_at FROM persona_reports WHERE walk_id = ? ORDER BY status = 'accepted' DESC, version DESC LIMIT 1").bind(id).first();

/** The open rounds (not closed) that still have a walk with no accepted report: [{round, open}] newest first. */
async function openRounds(db) {
  const { results } = await db
    .prepare(
      "SELECT b.round AS round, COUNT(*) AS open FROM persona_briefs b WHERE NOT EXISTS (SELECT 1 FROM persona_rounds r WHERE r.round = b.round AND r.closed_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM persona_reports p WHERE p.walk_id = b.walk_id AND p.status = 'accepted') GROUP BY b.round ORDER BY b.round DESC",
    )
    .all();
  return results.map((r) => ({ round: r.round, open: r.open }));
}

/** The briefs of a publish (or a bundle), checked: ids in the round's shape and unique, sizes and count capped. */
function parseBriefs(r, raw) {
  if (!Array.isArray(raw) || raw.length === 0) no("briefs must be a list of {id, brief}, at least one.");
  if (raw.length > CAPS.rowsPerRound) no(`A round holds at most ${CAPS.rowsPerRound} briefs.`);
  const seen = new Set();
  return raw.map((x, i) => {
    if (!isRec(x)) no(`brief ${i + 1} must be {id, brief}.`);
    const id = walkId(x.id, `brief ${i + 1}'s id`);
    if (!id.startsWith(`r${r}-`)) no(`${id} is not a round ${r} id; round ${r} ids start r${r}-.`);
    if (seen.has(id)) no(`${id} is listed twice.`);
    seen.add(id);
    return { id, body: text(x.brief, `${id}'s brief`, CAPS.briefBytes) };
  });
}

/** Replaces a round's briefs (and its guide when given) and opens the round; `after` runs in the same batch (a spent bundle's deletion). */
async function publishRows(db, now, r, guide, briefs, after) {
  const seen = new Set(briefs.map((b) => b.id));
  const { results: existing } = await db.prepare("SELECT walk_id FROM persona_briefs WHERE round = ? ORDER BY walk_id").bind(r).all();
  const dropped = existing.map((e) => e.walk_id).filter((id) => !seen.has(id));
  if (dropped.length) {
    // Bound by the round alone (D1 takes at most 100 parameters a query), filtered here.
    const { results: accepted } = await db.prepare("SELECT DISTINCT r.walk_id FROM persona_reports r JOIN persona_briefs b ON b.walk_id = r.walk_id WHERE b.round = ? AND r.status = 'accepted' ORDER BY r.walk_id").bind(r).all();
    const kept = accepted.filter((k) => !seen.has(k.walk_id));
    if (kept.length) no(`Not published: it would drop ${kept.map((k) => k.walk_id).join(", ")}, which already ${kept.length === 1 ? "has an accepted report" : "have accepted reports"}. Keep ${kept.length === 1 ? "it" : "them"} in the list.`);
  }
  const at = iso(now);
  await write(db, now, [
    ...dropped.flatMap((id) => [db.prepare("DELETE FROM persona_briefs WHERE walk_id = ?").bind(id), db.prepare("DELETE FROM persona_walks WHERE walk_id = ?").bind(id)]),
    ...briefs.map((b) => db.prepare("INSERT INTO persona_briefs (walk_id, round, body, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (walk_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at").bind(b.id, r, b.body, at)),
    db.prepare("INSERT INTO persona_rounds (round, guide, closed_at, updated_at) VALUES (?, ?, NULL, ?) ON CONFLICT (round) DO UPDATE SET guide = COALESCE(excluded.guide, persona_rounds.guide), closed_at = NULL, updated_at = excluded.updated_at").bind(r, guide, at),
    ...after,
  ]);
  return { round: r, briefs: briefs.length, dropped };
}

/**
 * A round posted straight to the server and kept PENDING under a random code, in no table a tool reads, until
 * publish_round names it. Checked as publish_round checks, and at most 4 MB. `visitor` is the poster's keyed hash: a
 * visitor keeps 2 pending (a third replaces their oldest), and the 20-bundle and 32 MB caps are in the one statement that
 * inserts, so requests running together cannot pass them. Answers {status, code} or {status, error}.
 * @param {object} db The store.
 * @param {unknown} raw The parsed body: {round, guide?, briefs: [{id, brief}]}.
 * @param {number} now Milliseconds since the epoch.
 * @param {string} [visitor] The poster's keyed hash.
 * @param {{ secretPaths?: string[] }} [opts] The project's secret paths, stripped from the guide.
 * @returns {Promise<{ status: 201, code: string } | { status: 400 | 413 | 503, error: string }>}
 */
export async function receiveBundle(db, raw, now, visitor = "", opts = {}) {
  try {
    if (!isRec(raw)) no("The body must be {round, guide?, briefs: [{id, brief}]}.");
    for (const k of Object.keys(raw)) if (!["round", "guide", "briefs"].includes(k)) no(`A bundle takes round, guide and briefs, not ${k.slice(0, 40)}.`);
    const r = round(raw.round);
    // A guide is stripped of anything after a # on receipt; a brief keeps its hand-off link by design.
    const guide = raw.guide === undefined ? null : stripFragments(text(raw.guide, "guide", CAPS.briefBytes), opts);
    const briefs = parseBriefs(r, raw.briefs);
    const size = briefs.reduce((n, b) => n + bytes(b.body), guide === null ? 0 : bytes(guide));
    if (size > MAX_BUNDLE_CONTENT_BYTES) return { status: 413, error: `A bundle is at most ${MAX_BUNDLE_CONTENT_BYTES / 1024 / 1024} MB and this one is over it; publish a round that big with publish_round's briefs.` };
    await inOrder(db, retention(db, now));
    const at = iso(now);
    // This visitor's bundles beyond their newest two are dropped, but only after the insert below succeeds: a refused post loses nothing.
    const beyond = `SELECT code FROM persona_bundles WHERE visitor = ? AND code NOT IN (SELECT code FROM persona_bundles WHERE visitor = ? ORDER BY created_at DESC, rowid DESC LIMIT ${BUNDLES_PER_VISITOR})`;
    for (let tries = 0; tries < 5; tries++) {
      const code = newCode();
      // The insert lands only if the 20-bundle and byte caps still have room, in this same statement.
      const res = await db
        .prepare(
          "INSERT OR IGNORE INTO persona_bundles (code, round, guide, created_at, expires_at, visitor, bytes) SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM persona_bundles WHERE expires_at > ?) < ? AND (SELECT COALESCE(SUM(bytes), 0) FROM persona_bundles WHERE expires_at > ?) + ? <= ?",
        )
        .bind(code, r, guide, at, iso(now + BUNDLE_TTL_MS), visitor, size, at, MAX_PENDING_BUNDLES, at, size, MAX_PENDING_BYTES)
        .run();
      if ((res.meta?.changes ?? 0) !== 1) {
        if (await db.prepare("SELECT 1 AS x FROM persona_bundles WHERE code = ?").bind(code).first()) continue;
        return { status: 503, error: `The waiting bundles are full (${MAX_PENDING_BUNDLES} of at most ${MAX_PENDING_BYTES / 1024 / 1024} MB together); each is kept an hour.` };
      }
      try {
        await inOrder(db, briefs.map((b) => db.prepare("INSERT INTO persona_bundle_briefs (code, walk_id, body) VALUES (?, ?, ?)").bind(code, b.id, b.body)));
      } catch (e) {
        await db.prepare("DELETE FROM persona_bundles WHERE code = ?").bind(code).run().catch(() => {});
        throw e;
      }
      await inOrder(db, [db.prepare(`DELETE FROM persona_bundle_briefs WHERE code IN (${beyond})`).bind(visitor, visitor), db.prepare(`DELETE FROM persona_bundles WHERE code IN (${beyond})`).bind(visitor, visitor)]);
      return { status: 201, code };
    }
    throw new Error("bundle code clash");
  } catch (e) {
    if (e instanceof Refusal) return { status: 400, error: e.message };
    throw e;
  }
}

/**
 * What export_round's code opens. Answers null for a code that is unknown, expired or spent; otherwise the round's
 * reports (the latest accepted version of each walk, else its latest; a walk with none is left out) and counts the read:
 * the code is deleted on its third.
 * @param {object} db The store.
 * @param {string} code The export code.
 * @param {number} now Milliseconds since the epoch.
 */
export async function readExport(db, code, now) {
  if (typeof code !== "string" || !CODE_RE.test(code)) return null;
  // The read is claimed first, in one statement: of requests running together only as many as there are reads left get a row.
  const row = await db.prepare("UPDATE persona_exports SET reads = reads + 1 WHERE code = ? AND expires_at > ? AND reads < ? RETURNING round, reads").bind(code, iso(now), EXPORT_READS).first();
  if (!row) return null;
  if (row.reads >= EXPORT_READS) await db.prepare("DELETE FROM persona_exports WHERE code = ?").bind(code).run();
  const { results } = await db.prepare("SELECT walk_id FROM persona_briefs WHERE round = ? ORDER BY walk_id").bind(row.round).all();
  const reports = [];
  for (const { walk_id } of results) {
    const rep = await walkReport(db, walk_id);
    if (rep) reports.push({ id: walk_id, status: rep.status, version: rep.version, started: rep.started_at, received: rep.received_at, clock_minutes: clockMinutes(rep.started_at, rep.received_at), body: rep.body });
  }
  return { round: row.round, reports };
}

/**
 * Takes one unit of `key`'s count for this UTC hour: true (and counted) while it is under `limit`, false once it is at it.
 * Rows of earlier hours are deleted as it goes. The count is taken in one statement, so requests running together cannot
 * pass the limit.
 * @param {object} db The store.
 * @param {string} key What is counted, for example "bundle:<visitor>".
 * @param {number} limit The most per hour.
 * @param {number} now Milliseconds since the epoch.
 * @returns {Promise<boolean>}
 */
export async function reserveHour(db, key, limit, now) {
  const hour = iso(now).slice(0, 13);
  await db.prepare("DELETE FROM persona_rate WHERE hour < ?").bind(hour).run();
  if (!(limit > 0)) return false;
  const res = await db.prepare("INSERT INTO persona_rate (key, hour, n) VALUES (?, ?, 1) ON CONFLICT (key, hour) DO UPDATE SET n = n + 1 WHERE n < ?").bind(key, hour, limit).run();
  return (res.meta?.changes ?? 0) === 1;
}

/** The waits, in minutes, and the elapsed minutes below which each is returned (the running sum of the waits before it: 1, 6, 16, 31, 61, 121, 241, 481, 961, 1681). */
const LADDER = [[1, 1], [6, 5], [16, 10], [31, 15], [61, 30], [121, 60], [241, 120], [481, 240], [961, 480], [1681, 720]];
/**
 * How long the tester waits before checking again: 1 minute while a walk is open; otherwise it backs off with the time
 * since the latest activity (a report received, a note posted, a round published or closed): 1, 5, 10, 15, 30 minutes,
 * then 1, 2, 4, 8, 12, 24 hours. No activity at all is a day.
 * @param {{ openWalks: number, minutesSinceActivity: number | null }} state
 * @returns {number}
 */
export function checkAgainMinutes({ openWalks, minutesSinceActivity }) {
  if (openWalks > 0) return 1;
  if (minutesSinceActivity === null) return 1440;
  for (const [below, wait] of LADDER) if (minutesSinceActivity < below) return wait;
  return 1440;
}

/** The open walks of every open round and the minutes since the latest activity, for checkAgainMinutes. */
async function checkAgain(db, now) {
  const open = (await openRounds(db)).reduce((n, r) => n + r.open, 0);
  const last = await db
    .prepare("SELECT MAX(t) AS t FROM (SELECT MAX(received_at) AS t FROM persona_reports UNION ALL SELECT MAX(created_at) FROM persona_notes UNION ALL SELECT MAX(updated_at) FROM persona_briefs UNION ALL SELECT MAX(updated_at) FROM persona_rounds)")
    .first();
  return checkAgainMinutes({ openWalks: open, minutesSinceActivity: last?.t ? (now - Date.parse(last.t)) / 60_000 : null });
}

/** next_walk's answer gains notes_waiting when (and only when) the coding thread left notes; next_walk and notes say when to check again. */
async function run(name, a, db, now, opts) {
  const out = await runTool(name, a, db, now, opts);
  if (name !== "next_walk" && name !== "notes") return out;
  let answer = out;
  if (name === "next_walk") {
    const n = (await db.prepare("SELECT COUNT(*) AS n FROM persona_notes").first())?.n ?? 0;
    if (n > 0) answer = { ...answer, notes_waiting: n };
  }
  return { ...answer, check_again_minutes: await checkAgain(db, now) };
}

const NO_GUIDE = "No guide has been published yet. Ask the coding thread with ask.";

async function runTool(name, a, db, now, opts) {
  switch (name) {
    case "next_walk": {
      let row;
      if (a.round !== undefined) {
        const r = round(a.round);
        if (await isClosed(db, r)) return { done: true, closed: true };
        row = await db
          .prepare("SELECT walk_id, round, body FROM persona_briefs b WHERE round = ? AND NOT EXISTS (SELECT 1 FROM persona_reports r WHERE r.walk_id = b.walk_id AND r.status = 'accepted') ORDER BY walk_id LIMIT 1")
          .bind(r)
          .first();
      } else {
        row = await db
          .prepare(
            "SELECT walk_id, round, body FROM persona_briefs b WHERE NOT EXISTS (SELECT 1 FROM persona_rounds c WHERE c.round = b.round AND c.closed_at IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM persona_reports r WHERE r.walk_id = b.walk_id AND r.status = 'accepted') ORDER BY round DESC, walk_id LIMIT 1",
          )
          .first();
      }
      if (!row) return { done: true };
      return { id: row.walk_id, round: row.round, brief: row.body, start: `Call start_walk with {"id": "${row.walk_id}"} just before you begin: the clock is the server's, and a report for a walk never started is refused.` };
    }
    case "get_brief": {
      const id = walkId(a.id);
      const row = await brief(db, id);
      if (!row) no(`No brief is named ${id}.`);
      return { id, round: row.round, brief: row.body };
    }
    case "guide": {
      let r;
      if (a.round !== undefined) r = round(a.round);
      else r = (await openRounds(db))[0]?.round ?? null;
      let row = r === null ? null : await db.prepare("SELECT round, guide FROM persona_rounds WHERE round = ?").bind(r).first();
      if (a.round !== undefined) return row?.guide ? { round: r, guide: row.guide } : { round: r, guide: `No guide has been published for round ${r}. Ask the coding thread with ask.` };
      if (!row?.guide) row = await db.prepare("SELECT round, guide FROM persona_rounds WHERE guide IS NOT NULL ORDER BY round DESC LIMIT 1").first();
      return row?.guide ? { round: row.round, guide: row.guide } : { round: null, guide: NO_GUIDE };
    }
    case "start_walk": {
      const id = walkId(a.id);
      if (!(await brief(db, id))) no(`No brief is named ${id}; get the id from next_walk.`);
      const at = iso(now);
      const had = await startOf(db, id);
      if (had !== null) {
        const accepted = await db.prepare("SELECT 1 AS x FROM persona_reports WHERE walk_id = ? AND status = 'accepted' LIMIT 1").bind(id).first();
        if (accepted || now - Date.parse(had) <= RESTART_AFTER_MS) return { id, started: had, already: true };
      }
      await write(db, now, [db.prepare("INSERT INTO persona_walks (walk_id, started_at) VALUES (?, ?) ON CONFLICT (walk_id) DO UPDATE SET started_at = excluded.started_at").bind(id, at)]);
      return { id, started: at, already: false };
    }
    case "submit_report": {
      const id = walkId(a.id);
      if (typeof a.report !== "string") no("report must be the report as text.");
      const raw = a.report;
      if (bytes(raw) > CAPS.reportBytes) no(`The report is over ${kb(CAPS.reportBytes)}; cut the prose and hand it in again.`);
      const b = await brief(db, id);
      if (!b) no(`No brief is named ${id}; get the id from next_walk.`);
      if (await isClosed(db, b.round)) no(`Round ${b.round} is closed.`);
      const started = await startOf(db, id);
      if (started === null) return { accepted: false, problems: [`${id} was never started: call start_walk with this id just before you begin the walk, then hand the report in.`] };
      const last = await db.prepare("SELECT COUNT(*) AS n, MAX(version) AS v FROM persona_reports WHERE walk_id = ?").bind(id).first();
      if ((last?.n ?? 0) >= CAPS.versionsPerWalk) no(`${id} already has ${CAPS.versionsPerWalk} versions, the most a walk keeps. Ask the coding thread with ask instead of handing it in again.`);
      const inRound = await db.prepare("SELECT COUNT(*) AS n FROM persona_reports r JOIN persona_briefs b ON b.walk_id = r.walk_id WHERE b.round = ?").bind(b.round).first();
      if ((inRound?.n ?? 0) >= CAPS.rowsPerRound) no(`Round ${b.round} already holds ${CAPS.rowsPerRound} reports, the most it keeps. Ask the coding thread.`);
      // What is stored is the stripped text, so that is checked too: a report that only reads cleanly before stripping is not accepted.
      const stored = stripFragments(raw, opts);
      let { problems } = submissionProblems(raw, id, opts);
      if (problems.length === 0) problems = submissionProblems(stored, id, opts).problems;
      const shown = capped(stripDeep(problems, opts));
      const status = problems.length === 0 ? "accepted" : "rejected";
      const version = (last?.v ?? 0) + 1;
      await write(db, now, [
        db
          .prepare("INSERT INTO persona_reports (walk_id, version, body, status, problems, received_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(id, version, stored, status, JSON.stringify({ total: problems.length, lines: shown }), iso(now), started),
      ]);
      if (status !== "accepted") return { accepted: false, version, problems: shown };
      return { accepted: true, version, clock_minutes: clockMinutes(started, iso(now)) };
    }
    case "ask": {
      const id = a.id === undefined || a.id === null ? null : walkId(a.id);
      // Stripped before it is checked, so what is checked is what is stored.
      const asked = text(a.question, "question", CAPS.textBytes);
      const q = stripFragments(asked, opts);
      if (!/[\p{L}\p{N}]/u.test(q)) no(q !== asked ? "The question was only a link or key, which is never stored; say it in words." : "The question needs words; say it in words.");
      if (id !== null && !(await brief(db, id))) no(`No brief is named ${id}; leave id out for a general question.`);
      await inOrder(db, retention(db, now));
      const count = await db.prepare("SELECT COUNT(*) AS n FROM persona_questions q WHERE NOT EXISTS (SELECT 1 FROM persona_answers a WHERE a.question_id = q.id)").first();
      if ((count?.n ?? 0) >= CAPS.questions) no(`There are already ${CAPS.questions} unanswered questions, the most kept. Ask the coding thread to answer some first.`);
      const row = await db.prepare("INSERT INTO persona_questions (walk_id, text, asked_at) VALUES (?, ?, ?) RETURNING id").bind(id, q, iso(now)).first();
      return { question_id: row.id };
    }
    case "answers": {
      let since = "";
      if (a.since !== undefined) {
        if (typeof a.since !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(a.since) || Number.isNaN(Date.parse(a.since))) no("since must be a UTC time like 2026-11-25T17:05:00Z.");
        since = iso(Date.parse(a.since));
      }
      const { results } = await db
        .prepare("SELECT * FROM (SELECT q.id AS question_id, q.walk_id AS id, q.text AS question, a.text AS answer, a.answered_at AS answered FROM persona_answers a JOIN persona_questions q ON q.id = a.question_id WHERE a.answered_at > ? ORDER BY a.answered_at DESC, q.id DESC LIMIT ?) ORDER BY answered, question_id")
        .bind(since, MAX_ANSWERS)
        .all();
      return { answers: results };
    }
    case "publish_round": {
      const r = round(a.round);
      if (a.bundle !== undefined) {
        if (a.briefs !== undefined) no("Give briefs or a bundle, not both.");
        if (a.guide !== undefined) no("A bundle brings its own guide; leave guide out.");
        if (typeof a.bundle !== "string" || !CODE_RE.test(a.bundle)) no("bundle must be the 10-character code that posting the bundle answered.");
        const code = a.bundle;
        const row = await db.prepare("SELECT round, guide FROM persona_bundles WHERE code = ? AND expires_at > ?").bind(code, iso(now)).first();
        if (!row) no("No pending bundle has that code; one is kept an hour, so post it again.");
        if (row.round !== r) no(`That bundle is for round ${row.round}, not round ${r}.`);
        const { results } = await db.prepare("SELECT walk_id, body FROM persona_bundle_briefs WHERE code = ? ORDER BY walk_id").bind(code).all();
        return publishRows(db, now, r, row.guide, parseBriefs(r, results.map((x) => ({ id: x.walk_id, brief: x.body }))), [
          db.prepare("DELETE FROM persona_bundle_briefs WHERE code = ?").bind(code),
          db.prepare("DELETE FROM persona_bundles WHERE code = ?").bind(code),
        ]);
      }
      if (a.briefs === undefined) no("Give briefs (a list of {id, brief}) or a bundle (the code posting one answered).");
      // Stripped as a bundle's guide is, so the same guide is stored the same way however it arrives.
      const guide = a.guide === undefined ? null : stripFragments(text(a.guide, "guide", CAPS.briefBytes), opts);
      return publishRows(db, now, r, guide, parseBriefs(r, a.briefs), []);
    }
    case "close_round": {
      const r = round(a.round);
      if (a.reopen !== undefined && typeof a.reopen !== "boolean") no("reopen must be true or false.");
      const has = await db.prepare("SELECT 1 AS x FROM persona_briefs WHERE round = ? LIMIT 1").bind(r).first();
      if (!has) no(`Round ${r} has no briefs.`);
      const closing = a.reopen !== true;
      const at = iso(now);
      await write(db, now, [
        db
          .prepare("INSERT INTO persona_rounds (round, guide, closed_at, updated_at) VALUES (?, NULL, ?, ?) ON CONFLICT (round) DO UPDATE SET closed_at = excluded.closed_at, updated_at = excluded.updated_at")
          .bind(r, closing ? at : null, at),
      ]);
      return { round: r, closed: closing };
    }
    case "rounds": {
      const { results } = await db
        .prepare(
          "SELECT b.round AS round, COUNT(*) AS briefs, SUM(CASE WHEN EXISTS (SELECT 1 FROM persona_reports p WHERE p.walk_id = b.walk_id AND p.status = 'accepted') THEN 1 ELSE 0 END) AS accepted, MAX(b.updated_at) AS touched FROM persona_briefs b GROUP BY b.round ORDER BY b.round DESC",
        )
        .all();
      const { results: meta } = await db.prepare("SELECT round, guide IS NOT NULL AS has_guide, closed_at, updated_at FROM persona_rounds").all();
      const by = new Map(meta.map((m) => [m.round, m]));
      return {
        rounds: results.map((r) => {
          const m = by.get(r.round);
          const closed = (m?.closed_at ?? null) !== null;
          return { round: r.round, briefs: r.briefs, accepted: r.accepted, open: r.briefs - r.accepted, closed, has_guide: m ? m.has_guide === 1 : false, updated: m?.updated_at ?? r.touched };
        }),
      };
    }
    case "export_round": {
      const r = round(a.round);
      const has = await db.prepare("SELECT 1 AS x FROM persona_briefs WHERE round = ? LIMIT 1").bind(r).first();
      if (!has) no(`Round ${r} has no briefs to export.`);
      await inOrder(db, retention(db, now));
      const live = await db.prepare("SELECT COUNT(*) AS n FROM persona_exports").first();
      if ((live?.n ?? 0) >= MAX_LIVE_EXPORTS) no(`There are already ${MAX_LIVE_EXPORTS} live export codes; each dies after 15 minutes.`);
      const expires = iso(now + EXPORT_TTL_MS);
      for (let tries = 0; tries < 5; tries++) {
        const code = newCode();
        // The cap is in the insert itself, so exports requested together cannot pass it.
        const res = await db
          .prepare("INSERT OR IGNORE INTO persona_exports (code, round, reads, created_at, expires_at) SELECT ?, ?, 0, ?, ? WHERE (SELECT COUNT(*) FROM persona_exports WHERE expires_at > ?) < ?")
          .bind(code, r, iso(now), expires, iso(now), MAX_LIVE_EXPORTS)
          .run();
        if ((res.meta?.changes ?? 0) === 1) return { code, expires };
        if (await db.prepare("SELECT 1 AS x FROM persona_exports WHERE code = ?").bind(code).first()) continue;
        no(`There are already ${MAX_LIVE_EXPORTS} live export codes; each dies after 15 minutes.`);
      }
      throw new Error("export code clash");
    }
    case "post_note": {
      if (typeof a.text !== "string") no("text must be the note as text.");
      const raw = a.text.trim();
      if (raw === "") no("The note needs words.");
      if ([...raw].length > NOTE_CHARS) no(`The note is over ${NOTE_CHARS} characters; shorten it.`);
      const noteRound = a.round === undefined ? null : round(a.round);
      const t = stripFragments(raw, opts).trim();
      if (!/[\p{L}\p{N}]/u.test(t)) no("The note was only a link or key, which is never stored; say it in words.");
      await write(db, now, []);
      const row = await db.prepare("INSERT INTO persona_notes (round, text, created_at) VALUES (?, ?, ?) RETURNING id").bind(noteRound, t, iso(now)).first();
      await inOrder(db, [db.prepare("DELETE FROM persona_notes WHERE id NOT IN (SELECT id FROM persona_notes ORDER BY id DESC LIMIT ?)").bind(MAX_NOTES)]);
      return { id: row.id, at: iso(now) };
    }
    case "notes": {
      let where = "";
      let bound = 0;
      if (a.since !== undefined) {
        if (typeof a.since === "number" || (typeof a.since === "string" && /^\d{1,12}$/.test(a.since))) {
          bound = Number(a.since);
          if (!Number.isInteger(bound) || bound < 0) no("since must be a note id or a UTC time like 2026-11-25T17:05:00Z.");
          where = "WHERE id > ?";
        } else if (typeof a.since === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(a.since) && !Number.isNaN(Date.parse(a.since))) {
          bound = iso(Date.parse(a.since));
          where = "WHERE created_at > ?";
        } else no("since must be a note id or a UTC time like 2026-11-25T17:05:00Z.");
      }
      // With since, the OLDEST newer notes come back (so paging forward skips none), listed newest first; without it, the newest.
      const pick = where ? "ASC" : "DESC";
      const stmt = db.prepare(`SELECT * FROM (SELECT id, created_at AS at, round, text FROM persona_notes ${where} ORDER BY id ${pick} LIMIT ?) ORDER BY id DESC`);
      const { results } = await (where ? stmt.bind(bound, NOTES_SHOWN) : stmt.bind(NOTES_SHOWN)).all();
      const total = (await (where ? db.prepare(`SELECT COUNT(*) AS n FROM persona_notes ${where}`).bind(bound) : db.prepare("SELECT COUNT(*) AS n FROM persona_notes")).first())?.n ?? 0;
      const more = total - results.length;
      const open = await openRounds(db);
      const base = { notes: results, open_walks: open.reduce((n, r) => n + r.open, 0), open_rounds: open };
      return more > 0 ? { ...base, more } : base;
    }
    case "clear_notes": {
      if (a.id !== undefined && (!Number.isInteger(a.id) || a.id < 1)) no("id must be a note's id.");
      const one = a.id !== undefined;
      const had = (await (one ? db.prepare("SELECT COUNT(*) AS n FROM persona_notes WHERE id = ?").bind(a.id) : db.prepare("SELECT COUNT(*) AS n FROM persona_notes")).first())?.n ?? 0;
      await inOrder(db, [one ? db.prepare("DELETE FROM persona_notes WHERE id = ?").bind(a.id) : db.prepare("DELETE FROM persona_notes")]);
      return { cleared: had };
    }
    case "list_reports": {
      const r = round(a.round);
      const { results } = await db.prepare("SELECT walk_id FROM persona_briefs WHERE round = ? ORDER BY walk_id").bind(r).all();
      const walks = [];
      for (const { walk_id } of results) {
        const rep = await walkReport(db, walk_id);
        const started = rep ? rep.started_at : await startOf(db, walk_id);
        const clock = { started, clock_minutes: clockMinutes(started, rep?.received_at ?? null) };
        walks.push(rep ? { id: walk_id, status: rep.status, version: rep.version, received: rep.received_at, problems: problemsOf(rep).total, ...clock } : { id: walk_id, status: "none", version: null, received: null, problems: 0, ...clock });
      }
      return { round: r, walks };
    }
    case "get_report": {
      const id = walkId(a.id);
      if (a.version !== undefined && (!Number.isInteger(a.version) || a.version < 1)) no("version must be a whole number from 1.");
      const row =
        a.version === undefined
          ? await walkReport(db, id)
          : await db.prepare("SELECT walk_id, version, body, status, problems, received_at, started_at FROM persona_reports WHERE walk_id = ? AND version = ?").bind(id, a.version).first();
      if (!row) no(a.version === undefined ? `No report has come in for ${id}.` : `${id} has no version ${a.version}.`);
      return { id, version: row.version, status: row.status, received: row.received_at, problems: problemsOf(row).lines, report: row.body };
    }
    case "open_questions": {
      const { results } = await db
        .prepare("SELECT q.id AS question_id, q.walk_id AS id, q.text AS question, q.asked_at AS asked FROM persona_questions q WHERE NOT EXISTS (SELECT 1 FROM persona_answers a WHERE a.question_id = q.id) ORDER BY q.asked_at, q.id LIMIT ?")
        .bind(MAX_ANSWERS)
        .all();
      return { questions: results };
    }
    case "answer": {
      if (!Number.isInteger(a.question_id) || a.question_id < 1) no("question_id must be the number ask gave.");
      const t = text(a.text, "text", CAPS.textBytes);
      const q = await db.prepare("SELECT id FROM persona_questions WHERE id = ?").bind(a.question_id).first();
      if (!q) no(`No question has the id ${a.question_id}.`);
      await write(db, now, [db.prepare("INSERT INTO persona_answers (question_id, text, answered_at) VALUES (?, ?, ?) ON CONFLICT (question_id) DO UPDATE SET text = excluded.text, answered_at = excluded.answered_at").bind(q.id, t, iso(now))]);
      return { answered: true, question_id: q.id };
    }
  }
  return no("Unknown tool.");
}

/**
 * Runs one tool. Bad arguments, an unknown tool, a tool the role may not call or an unreadable database are answers with
 * `isError`, never a throw.
 * @param {unknown} name The tool's name.
 * @param {unknown} rawArgs The tool's arguments.
 * @param {{ db: object | undefined, now?: number, role?: "tester" | "coding", secretPaths?: string[] }} deps
 *   `role` is who is calling (default "tester"); `secretPaths` are stripped, with what follows them, from every text stored.
 * @returns {Promise<{ content: Array<{ type: "text", text: string }>, isError?: true }>}
 */
export async function callTool(name, rawArgs, deps) {
  const role = deps?.role === "coding" ? "coding" : "tester";
  const allowed = toolsFor(role).map((t) => t.name);
  if (!isToolName(name)) return refuse(`Unknown tool. The tools are ${allowed.join(", ")}.`);
  if (!allowed.includes(name)) return refuse(CODING_ONLY);
  try {
    const args = argsOf(name, rawArgs);
    if (!deps.db) return refuse("The tester store isn't set up here.");
    const store = { prepare: (sql) => deps.db.prepare(sql) };
    if (deps.db.batch) store.batch = (st) => deps.db.batch(st);
    return ok(await run(name, args, store, deps.now ?? Date.now(), { secretPaths: deps.secretPaths ?? [] }));
  } catch (e) {
    return refuse(e instanceof Refusal ? e.message : "The tester store couldn't be read just now. Try again in a minute.");
  }
}
