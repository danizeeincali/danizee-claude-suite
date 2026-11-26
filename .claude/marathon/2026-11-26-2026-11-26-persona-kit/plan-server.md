# Stream `server`: the tester connector, product-agnostic

Goal: the persona-testing connector that today lives inside the Ezi HQ site (bos) becomes a library in the suite that any
project can run, locally with Node or as a Cloudflare Worker with D1. **bos is read-only reference; never edit it.**

## Sources to port (read these first)

- `/home/user/bos/scripts/persona-test/report-shape.mjs` (the report's shape and the secret stripper)
- `/home/user/bos/packages/site/functions/_lib/tester-tools.ts` (tools and storage). The newest version, with
  `check_again_minutes`, is on a branch: `git -C /home/user/bos show origin/claude/project-thread-7khxy1:packages/site/functions/_lib/tester-tools.ts`
- `/home/user/bos/packages/site/functions/tester-mcp.ts`, `_lib/mcp-transport.ts`, `api/tester/bundle.ts`, `api/tester/export.ts`
- `/home/user/bos/packages/site/migrations/0007_tester.sql`, `0009_tester_bundles.sql`
- Tests to port (vitest to `node --test`): `/home/user/bos/packages/site/test/functions/tester-{tools,notes,bundles,hardening,mcp}.test.ts`
  and the report-shape tests under `/home/user/bos/scripts/persona-test/` or `/home/user/bos/test` (find with grep `report-shape`).
- `/home/user/bos/docs/design/persona-testing.md`, section "The tester connector".

## Conventions

Plain ESM JavaScript (`.js`), Node >= 20, **no new npm dependency**, JSDoc comments in the suite's plain style. Library in
`src/lib/persona/`, tests in `test/persona-*.test.js` (run by `npm test`, which is `node --test test/*.test.js test/reach/*.test.js`).
Everything in `src/lib/persona/` must run unchanged in a Cloudflare Worker except `sqlite.js` and `serve.js`: so no
`node:` import in `report-shape.js`, `tools.js`, `mcp.js`, `http.js` (use `crypto.subtle`, `crypto.getRandomValues`,
`TextEncoder`, `Request`/`Response`, which both have). **No product name** in `src/lib/persona/`: the strings "Ezi",
"ezihq", "bos", "Duet", "Dani" never appear (a test greps for it). Words are plain: "the tester", "the coding thread".

## Files

### `src/lib/persona/report-shape.js`
Port of `report-shape.mjs`, same exports (`SEVERITY, STEPS, stripFragments, stripDeep, show, safeName, REPORT_NAME,
MAX_LIST, MAX_REPORT_BYTES, DEEP_KEYS, parseReport, UNREADABLE, unreadableProblem, submissionProblems`), same behaviour, with:
- The host rule of the address stripper takes any top-level domain of 2 to 24 letters (not the fixed list).
- The `_door/tester` rule is dropped. In its place `stripFragments(text, { secretPaths = [] })`: for each path in
  `secretPaths` (plain strings like `/_door/tester`, matched also with `/` written `%2F`), everything after it up to
  whitespace is dropped. `stripDeep(v, opts)`, `parseReport(raw, opts)`, `submissionProblems(raw, walkId, opts)` pass it through.
- `SITTINGS` becomes 9 (a sitting is any whole number 1 to 9).
- New export `REPORT_TEMPLATE(walkId = "<walk id>", testerName = "the tester")`: the report example as markdown text (a
  heading, one fenced json block with every key of the shape and example values with `example.com` addresses, then a
  `## Notes` section). `submissionProblems(REPORT_TEMPLATE("r1-01-a"), "r1-01-a").problems` must be `[]` (a test holds it).

### `src/lib/persona/schema.sql` and `SCHEMA` (exported string from `tools.js` with the same text; a test holds them equal)
One schema, no migrations probe (drop bos's `modern`/`schemaCurrent`/`NEEDS_MIGRATION`). Tables prefixed `persona_`:
`persona_rounds (round PK, guide TEXT NULL, closed_at TEXT NULL, updated_at)`, `persona_briefs (walk_id PK, round, body,
updated_at)`, `persona_walks (walk_id PK, started_at)`, `persona_reports (walk_id, version, body, status, problems,
received_at, started_at, PK(walk_id, version))`, `persona_questions`, `persona_answers`, `persona_notes`,
`persona_bundles`, `persona_bundle_briefs`, `persona_exports`, `persona_rate (key TEXT, hour TEXT, n INTEGER, PK(key, hour))`.
Keep bos's CHECK constraints and indexes. Every statement `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
so applying it twice is harmless.

### `src/lib/persona/tools.js`
Port of `tester-tools.ts` over the same D1-like interface (`db.prepare(sql).bind(...).first()/all()/run()`, optional
`db.batch([...])`). Same caps, retention (90 days), refusals as JSON `{error}` with `isError`, never a throw. Changes:

1. **Roles.** Every tool has `role: "tester" | "coding"`. Tester tools: `notes, next_walk, get_brief, guide, start_walk,
   submit_report, ask, answers`. Coding tools: `publish_round, close_round, post_note, clear_notes, list_reports,
   get_report, export_round, open_questions, answer, rounds`. `callTool(name, args, { db, now, role, secretPaths })`:
   role `coding` may call every tool; role `tester` calling a coding tool gets the refusal "That tool is for the coding
   thread." `toolsFor(role)` lists the tool definitions (name, description, inputSchema, annotations; the internal
   `role` key is not in the listed definition) a role may call.
2. **Every start is required.** No `needs_start` column: a report for a walk never started is always refused, as bos
   does for `needs_start = 1`.
3. **Rounds can be closed and are served newest open first.** `close_round({round, reopen?})` (coding) sets or clears
   `closed_at`; answers `{round, closed}`. A closed round is never served and `submit_report` to one of its walks is
   refused in words ("Round N is closed."). `next_walk` with no `round` serves the first open walk (no accepted report)
   of the **highest-numbered round that is not closed and still has an open walk**; so when round 6 is done and round 5
   is open, it serves round 5. Its answer always carries `round`. `{done: true}` only when no unclosed round has an open
   walk. With `round` given it serves that round only (a closed one answers `{done: true, closed: true}`).
   `publish_round` on a closed round reopens it. `guide({round?})` answers the guide of the given round, else of the
   round `next_walk` would serve, else of the latest round that has one. `notes` answers `open_walks` (all unclosed
   rounds together) and `open_rounds: [{round, open}]` newest first.
   New coding tool `rounds()`: `{rounds: [{round, briefs, accepted, open, closed, has_guide, updated}]}` newest first.
4. **check_again_minutes** on `notes` and `next_walk`, exactly as the branch version (`checkAgainMinutes` exported, same
   ladder), with "open walks" meaning open walks in any unclosed round.
5. `publish_round`'s guide is stored on `persona_rounds`; the bundle form is kept (`receiveBundle`, `readExport` exported
   as in bos, without the `visitor` cap being optional: keep the per-visitor cap of 2).
6. Walk ids keep the shape `r<round>-<slug>`.
7. `submit_report`, `ask`, `post_note` strip with the `secretPaths` they are given.
8. Tool descriptions say "the coding thread" and "the tester" and never name a product or a site path; where bos says
   "POST /api/tester/bundle" say "POST <this server>/bundle", and for export "GET <this server>/export?code=<code>".

### `src/lib/persona/mcp.js`
`handleRpc(message, { db, now, role, product, secretPaths })` → the JSON-RPC response object (or `null` for a
notification). Methods: `initialize` (answers `protocolVersion` = the client's if it is one of `2024-11-05`,
`2025-03-26`, `2025-06-18`, else `2025-06-18`; `capabilities: {tools: {}}`; `serverInfo: {name: "persona-tester",
title: "<product> persona testing (dev)", version}`; `instructions` = bos's instruction text with `<product>` in place
of the name, the bundle words generalised, and the check-again sentence), `notifications/*` (null), `ping` (`{}`),
`tools/list` (`toolsFor(role)`), `tools/call` (`callTool`; an unknown tool is a tool result with `isError`, as bos).
Anything else: JSON-RPC error `-32601`. A batch (array) is answered as an array. Malformed: `-32600`.

### `src/lib/persona/http.js`
`createHandler({ db, testerKey, codingKey, product = "This product", secretPaths = [], now = () => Date.now(), clientIp = (req) => null })`
→ `async (request: Request) => Response`. `db` may be the store or a function returning it.
- **Off unless keyed.** A key counts only when it is a string of 24+ characters; the two keys must differ. With no
  valid key at all every path answers 404 (`not_found`). A role whose key is missing is simply not reachable.
- `POST /mcp` with `Authorization: Bearer <key>`, and `POST /k/<key>/mcp` (the key in the path, for clients that cannot
  send a header): the key decides the role. Keys are compared by SHA-256 digest of both sides with a constant-time
  byte comparison. Wrong or missing key: 401 `{error: "unauthorized"}` on `/mcp`, 404 on `/k/...` (so a path probe
  learns nothing). `GET` on either: 405. Body over 2 MB: 413. Not JSON: 400 with a JSON-RPC parse error `-32700`.
  Answers `application/json` (no SSE), `cache-control: no-store`; a notification-only body answers 202 with no body.
- `POST /bundle` (no sign-in, inert until `publish_round` names its code): as bos's route: JSON only (415), cross-origin
  refused (403), at most 5 MB (413), 6 an hour per visitor, answers 201 `{code}`. `GET /export?code=`: as bos, 30 an
  hour per visitor, anything wrong is 404. The visitor is `clientIp(request)` hashed with HMAC-SHA-256 keyed by the
  coding key (else the tester key) and the UTC day, 16 hex characters; hourly counts live in `persona_rate`
  (old hours deleted on write). With no ip the visitor is `""` and shares one bucket.
- Any other path: 404. A thrown error: 500 `{error: "unavailable"}`, nothing about the error in the body.

### `src/lib/persona/sqlite.js` (Node only)
`openStore(file = ":memory:")` → a D1-like store (`prepare/bind/first/all/run` with `run()` answering `{meta: {changes}}`,
and `batch` as one transaction that rolls back on a throw) over `node:sqlite` (`DatabaseSync`) when it can be imported,
else `better-sqlite3`, else it throws one sentence saying Node 22.5 or newer (or `npm i better-sqlite3`) is needed.
Applies `SCHEMA`. Also `store.close()` and `store.raw`. Silence the ExperimentalWarning for sqlite only (do not
silence other warnings).

### `src/lib/persona/serve.js` (Node only)
`startServer({ file, port = 8787, host = "127.0.0.1", testerKey, codingKey, product, secretPaths })` → `{ url, close() }`
bridging `node:http` to the handler (`clientIp` = the socket's address). Run as a script:
`node serve.js --db <file> [--port n] [--host h] [--product "Name"]` with keys from the environment
(`PERSONA_TESTER_KEY`, `PERSONA_CODING_KEY`) or `--keys <json file>` (`{tester_key, coding_key}`); prints one JSON line
`{url, mcp}` (never a key). With no valid key it exits 1 with one sentence.

### `src/lib/persona/worker/`
`worker.js`: `export default { fetch(request, env) }` → `createHandler({ db: env.DB, testerKey: env.PERSONA_TESTER_KEY,
codingKey: env.PERSONA_CODING_KEY, product: env.PERSONA_PRODUCT, secretPaths: (env.PERSONA_SECRET_PATHS ?? "").split(",").filter(Boolean),
clientIp: (r) => r.headers.get("cf-connecting-ip") })` importing `../http.js`. `wrangler.example.toml` (name, main,
compatibility_date, one D1 binding `DB` with placeholder id, `[vars] PERSONA_PRODUCT`). No secret in any file.

## Tests (write first, see them fail, then build)

Port the bos tests listed above to `node --test` + `node:assert/strict`, against `openStore()` (give tests a `now`).
Add: roles (a tester key cannot publish; `tools/list` differs by role), closed rounds and newest-open-first serving,
`rounds`, check-again ladder, the http handler end to end with `fetch`-style `Request`s (both key forms, off without
keys, 401/404/405/413, bundle then `publish_round({bundle})`, export code dying after 3 reads, rate limits), the local
server over real HTTP on port 0 with a full walk (initialize, tools/list, notes, next_walk, start_walk, a rejected
`submit_report`, an accepted one, coding `list_reports`), the worker module called with a fake `env`, schema file equals
`SCHEMA`, no product name in `src/lib/persona/`, and no `node:` import in the four Worker-safe modules. Property tests
with fast-check (already a dev dependency) for `stripFragments`: no output contains `#` followed by 20+ key characters,
and stripping twice equals stripping once.

Done when `npm test` is green (the whole suite, not only the new tests) and the files above exist as specified.
