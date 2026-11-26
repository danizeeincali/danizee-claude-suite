---
memory_key: project/marathon/2026-11-26-persona-kit/compound
date: 2026-11-26
run: 2026-11-26-persona-kit
stream: persona-testing-kit
---

# Persona testing kit (marathon 2026-11-26-persona-kit, suite 4.9.0)

## What shipped

A product-agnostic persona-testing kit, generalized from another project's tester connector. `src/lib/persona/` holds
the tester connector over a D1-like store (a local Node server on SQLite and a Cloudflare Worker), the report shape, the
project file (`persona-testing/project.json`), the round planner with side rounds, brief and guide renderers, the client,
the reader that merges reports into findings, and the deliver step that writes a deck for `decision-deck` and a markdown
findings file. `src/plugins/persona.js` installs it as a helper, and `/w-persona-test` (alias `/ptest`) drives it. No
product name appears in the library (a test holds it). Two streams built it, the server and the rounds, with three and
seven review rounds; the second stream's seven rounds found 40 things, all fixed with tests.

## Lessons worth reusing

**Cutting secrets from text a stranger wrote**
- A stripper that skips slug-like runs lets hex keys through, because a hex key reads as a slug. Cut the connector's exact
  keys and its `/k/` and Bearer forms, whatever the key looks like (round 4, the one high finding of that round).
- Strip at every place tester text is written to disk, not only where it is first stored. The server stripped, the client's
  fetch did not, and the key reached committed files (rounds 1, 2 and 4). Fetch must also cut when `project.json` has a
  problem, so read the project tolerantly there.
- A file that holds a key is created with mode 0600, never chmod-ed afterwards. A temp file with the default mode is
  readable for a moment.
- Validate what is stored, not what was received. A path rule that ate to whitespace removed a closing quote and stored a
  broken report that had passed the check on the raw text.
- Error messages print the origin, never the full server URL, which can carry a key.

**The client and the network**
- Never follow redirects with a body (`redirect: "manual"`), and allow `http://` only for this computer. Anything else is
  `https`, or the coding key goes out in clear.
- A timeout while reading the body is not "not JSON". Check the error name before choosing the sentence.
- Mark a round published before the request that publishes it. A lost answer otherwise leaves a round on the server that
  the project never learns about.
- Fetch a few reports at a time instead of one round trip per walk, and keep every server failure code the same across verbs.
- Server refusals on bundle and publish are exit 2 (a refusal), not 1 (a break).

**Order of writes and what a replan may assume**
- Write the record only after everything derived from it renders. `plan` wrote `rounds.json` before the briefs rendered,
  and a failed render left them out of step. Render first, record last.
- A replan of something already sent must ask the server and treat any failure as a stop. Reading local reports only drops
  a walk the server accepted that nobody fetched, and a transient error read as "no reports" does the same.
- A "still being written" mtime guard copied from a mount-based design breaks fetch-then-read: every fetched report is
  fresh and was skipped. Drop it when the files arrive by fetch.
- On the server, read before you claim. An export marked as read before its reports were read spent the read on a failure.
  Make cleanup after a successful write best effort so it cannot turn a success into a 500.
- Put the version inside the INSERT, not MAX+1 then insert, so concurrent hand-ins cannot collide. Use set-based queries,
  because a D1-style store caps queries per invocation (one query per round, not 1+2N). Send a bundle as one batch.

**Words that count things**
- A sentence that counts something counts only that thing. An unreadable project or clock file was counted as an unreadable
  report; a pick that was applied was listed under "not applied"; "middle walk" was said where no walk held the median; a
  lede called findings left off the deck "smaller".
- A round number that is nowhere is refused, never read as an empty round. `read`, `fetch` and `status` of an unplanned
  round used to say "no findings".
- Say the consequence in the sentence the person reads: a replan refusal names its flag, replanning a published round says to
  publish again, a fetch of an unpublished round says so, an unplanned store says which setup step is missing.
- Do not promise what the guide cannot hold (sitting, resets of a shared account, "Remembered" on every finding).

**Docs and installs**
- Every command line a doc gives is run as written by a test. The deck steps named kit commands that failed as written, and
  the README gave the wrong Node floor (`node:sqlite` is unflagged from 22.13).
- Ship `{"type":"module"}` with ESM helpers that get copied into other projects, or the installed CLI does not start in a
  CommonJS project.
- An unescaped pipe inside a code span breaks a markdown table row. Merge duplicate headings when inserting a changelog block.

**Performance**
- Index by shared word to keep title merging from going quadratic (`mergeFindings` compared every pair of findings).
- Do not re-strip full tester notes on every pass. Strip once, keep the clean text.

**Process**
- A category seen in two reviews became a rule in `rules.md` (facts, docs, secrets). The cheapest review angles to run
  early were "one input method at a time" and "failure conditions and error paths".
