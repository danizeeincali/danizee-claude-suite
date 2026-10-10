# Standing rules

Rules Claude reads at every wake-up and every review. Anything Claude can forget, lose or
talk itself out of lives here, in a test, or in a scripted check — never only in chat.
Add a rule the second time something goes wrong.

## Quality

- **Never weaken an assertion.** A fixer that loosens a test to make it pass has introduced a
  defect. A separate reviewer checks every fix; the next round restores the test.
- A flaky test is a bug, not noise. Fix the code or the test's isolation; never retry it away.
- "Done" means checked in the real, packaged, running thing — not only in the test suite.
- Two clean reviews in a row close a stream. The tolerance in `finish-line.json` decides what
  "clean" means; the human owns that number.
- Findings are rows with a severity and a category. The write-up is generated from the rows,
  never retyped. A category seen in two reviews becomes a test, a scan, a fixture or a rule.

## Process

- Scripts decide, the model acts: streaks, counts, budgets, gates and keep-lists come from
  `node .claude/helpers/marathon/cli.js <verb>`, never from memory or arithmetic in chat.
- Never spawn a helper after `cli.js budget` exits non-zero. Exit 2 = the ceiling or the token
  budget: finish the step, the run is PAUSED, stop. Exit 1 = broken state or invalid input: fix it,
  rerun `budget`, and only then spawn.
- Every helper gets a token budget in its brief and a row in the ledger; the actual spend is
  recorded from the task notification.
- Never build or run browser tests against the port the owner is using. Use a scratch copy on
  its own port and swap the served build once, announced.
- When a rule changes, fix the shared test helper first, then edit only the tests that still fail.
- Each test run gets its own temp folder that is cleaned up afterwards.
- Code and reviews go into git as soon as they exist. State lives in files, never only in chat.

## Ownership

- Nothing is pushed or merged without the owner's go (`/bcp` is that go for a compound).
- Lines only the human can close are listed once under "Waiting on human" and never retried.
- A problem the owner finds while using the build is an escape: record it with
  `cli.js record escape` so skipped reviews show their cost.

## This run (2026-10-10-bbs-openqodex-2)

- Every power lands in `src/lib/kit/<module>.js`, exporting `verb` and `run(args, io)`; `kit/cli.js` discovers it.
  Copy `src/lib/kit/.` into `.claude/helpers/kit/` after every change (a test checks the copy).
- Briefs carry the idea only. Never open `.claude/bbs/runs/*/fetched/`; nothing from the source is copied.
- The packaged check for a stream is `test/kit-<stream>-packaged.test.js`, built on `test/helpers/packaged.js`
  (installs the suite into a temp project, drives the installed kit CLI under the no-egress preload).
- The three measured lines come from `node scripts/marathon-measure.js --stream <s> --verb <v> --module <m.js>
  --test test/kit-<s>-packaged.test.js` — never recorded by hand.
- A caller is a real harness file in its normal flow (a command step, a hook, another helper) that runs the verb
  or imports the module. A doc that only mentions the verb is not a caller.
- Streams run one at a time: each stream branch merges into the run branch `claude/project-thread-p9gbyo`
  before the next starts, so `dot-shortcuts.js` and `installer.js` never conflict.
- Finish-line lines carry `stream`: `gate --stream <s>` judges only that stream's lines (others are other_stream).
- (promoted: docs) A command step that runs a kit verb is copy-pasteable as written: no `a|b` placeholders, no
  backslash-escaped backticks, and the flags it records match the flags the matching check uses. The repo copy of
  any command a stream edits equals the generator output (a test checks it).
- (promoted: correctness) Kit verbs resolve repository paths from `git rev-parse --show-toplevel` / the git common
  dir, never from the cwd; a failure of git itself (missing, unspawnable) is reported as that, not as "not a repo";
  store writes are atomic and clean up their temp file on failure. Unknown flags are refused.
- (promoted: security) Redaction and other safety steps fail CLOSED: when the user configured one (a secrets file
  exists) and it cannot run — unreadable file, kit missing, malformed entry — the output is not produced and the
  command exits 1 naming what is missing. A safety step never degrades silently to "nothing to do".
- (promoted: old git) Never pass `--path-format` to `git rev-parse` (git < 2.31 echoes unknown flags and exits 0).
  Resolve `--git-common-dir` / `--git-dir` output against the command's cwd with `path.resolve`, through the one shared
  kit helper, and test it with a fake git that echoes unknown flags the way old git does.
- (promoted: test-quality) A fake used in a test behaves like the real thing it stands for (exit code, stdout vs stderr,
  echoed flags); a test named for a behaviour asserts that behaviour's observable result, not just "no throw".

## Owner decision (2026-10-10): no parser dependency
Dani chose "No dependency" for the symbol-graph streams (fact-cached-graph-build-with-budget, change-blast-radius-walk, caller-floor-disclosure). Build a small JS/TS-only fact extractor inside the kit; any file it cannot parse (other languages, unparseable syntax) is reported as not read, and results are labelled partial. Build fact-cached-graph-build-with-budget before the two streams that use its graph.

## Lesson (hardened-git, rounds 1-2): allow-list, don't deny-list, untrusted config
Four high findings in two rounds were the same class: the untrusted repo's own config named a command that a read ran (filters, textconv, signing program, submodule filters, transport). Patching keys one by one kept losing. When code must not trust a repo's config, give git a config we write from an allow-list of keys; keep key overrides only as defence in depth.
