# /w-bbs integration — a built power counts only when a user can reach it

Memory key: `project/marathon/2026-10-10-bbs-integration` · Run: `2026-10-10-bbs-integration` · Closed 2026-10-10
Code: `src/lib/bbs/{usage,surfaces,steps,targets,wiring}.js`, `verdict.js`, `handoff.js`, `cli.js`; docs in `src/plugins/dot-shortcuts.js` (w-bbs, w-marathon 4.3a)
Tests: `test/bbs-surfaces.test.js`, `test/bbs-wiring.test.js`, `test/bbs-sample-app.test.js` (fixture `test/fixtures/bbs-app`), `test/bbs-targets.test.js`, `test/bbs-usage.test.js`
Branch: `claude/project-thread-9ow0sy` (streams `targets`, `integration-gate` merged in).

## The problem

The first real run (OpenQodex, see `bbs-first-real-run-openqodex.md`) built 11 powers and wired 1 of them in any
way the owner would meet. The old `callers` measure (any file that names the verb) passed all 11. Building is not
integrating: a power no user reaches is a car with no keys.

## What changed

1. **usage** — which workflows the owner actually runs, counted from their own session history (counts only, no
   content leaves the machine), or named by them (`--workflows a,b`). `evidence: none` means unverified.
2. **surfaces** — where a user meets a feature in *this* project, found in its code: UI pages (Next app/pages,
   SvelteKit, `<Route path>`), API endpoints (express-style routers under any name, Go/gin, FastAPI/Flask, NestJS,
   Django, Rails), jobs, model/prompt steps, CLI commands, feature flags, the library entry, and Claude Code
   workflows with their step headings. Owners can add their own (`surfaces --add`).
3. **targets** — every power names where it lands (`<kind>:<file>` + anchor + how a user gets there, or a
   workflow step) before the verdict; the table shows a **Lands in** column; a power with no standing target never
   defaults to rebuild/use. The owner can move it with `<power>@<where>` in the one verdict answer.
4. **integration stream** — gated like a build. `cli.js integrate` records the power's entry
   (`<module>#<symbol>`) and a **reach test** per surface; `wired` counts a code target only when the surface
   file imports and *uses* the entry and a reach test that goes in through that surface (imports it, or names its
   route as a literal) passes now. A workflow target counts when the step runs the kit verb. `delivered.md` tells
   the owner what they got, what is not wired and why, and the test that proves each one.

## Lessons the reviews forced (28 findings over 6 rounds)

- **A check the builder can satisfy with text is not a check.** Every early version was fooled by a comment, a
  bare mention, a multi-line import, `'/'` as an anchor, or a reach command that never ran its test.
- **A reach command must be one test-runner call, run as argv with no shell.** `node --test t.js || true` and an
  escaped-quote bypass both faked a pass while a regex "single call" check looked fine. Now: own tokenizer, no
  shell syntax, runner allowlist, no inline `-e`/`-c` code, no `npx -y` downloads, and no credentials in its env.
  A timeout kills the whole process group.
- **A nested `node --test` inherits `NODE_TEST_CONTEXT` and exits 0 on failure.** Strip it from any test you run
  from inside a test.
- **Never follow a tracked symlink** when scanning an owner's project; `git ls-files` lists them.
- **Labels must be computed from current state**, not stored flags (the `(unverified)` mark outlived the owner's
  answer).
- **A hand-off with nowhere to land is refused**, naming the repair (`usage`, `surfaces`, `targets --set --force`),
  rather than creating finish lines no one can meet.

## Not done here, by design

- Reach tests are not run under the kit's no-egress preload: an endpoint reach test legitimately calls a local
  server, and the preload blocks all sockets. They run as the project's own tests do, minus credentials.
- The 11 OpenQodex kit verbs are wired by a separate thread; this run fixed the process only.
