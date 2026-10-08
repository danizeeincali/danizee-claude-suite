# Kickoff — 2026-10-07-bbs

Finish line: `/w-bbs` (alias `/bbs`) shipped in the suite — intake, fetch, inventory, harness map,
verdict gate, hand-off to a marathon run, command markdown, `/bbs` alias, installer and README.
Spec: `.claude/plans/2026-10-07-w-bbs.md`.

## Done means
- Per stream: two clean reviews in a row (tolerance 0 high / 2 medium / 5 low), fresh `opus` reviewer each round, diff since the last certified point.
- Run-wide: six green e2e runs in a row, three green unit runs in a row, zero open high findings.
- Packaged check (inside the e2e test): `init` into a temp project installs `.claude/helpers/bbs/cli.js`, `.claude/commands/.shortcuts/w-bbs.md` and `bbs.md`; the installed CLI drives a local fixture source through intake → fetch → inventory → map → verdict → hand-off and produces a marathon run dir with a typed `finish-line.json`.
- Under 10,000,000 helper tokens; the weekly allowance never past 70%.
- The owner pushes with `/bcp` (the only human line); `buildGateMet` closes without it, `gateMet` waits on it.

## You may decide on your own
- Stub all network in tests — no live HTTP or git fetch in the test suite.
- Zero new npm dependencies; the bbs library is zero-dep like the marathon library.
- Module layout: `src/lib/bbs/*` + `src/plugins/bbs.js` + `src/templates/bbs/*`, installed to `.claude/helpers/bbs/`, run state in `.claude/bbs/`.
- `use` is removed with a reason when no sandbox is present on the machine (macOS without Docker).
- Merge each finished stream branch into local `main` with a local commit — never pushed — so later streams build on it.
- Fake or stub any key, account or external service a test needs.
- Pick the simplest zero-dep algorithm that meets the contract (IDF-weighted cosine, SHA-256, `git` via child_process).

## Ask me before
- Any push to origin.
- Adding an npm dependency.
- Any live network call outside the test suite.
- Non-additive changes to the marathon core (`src/lib/marathon/*`).
- Bumping the package version.

## Never
- Never push or merge to origin.
- Never execute fetched foreign code.
- Never weaken or delete a failing assertion.
- Never make real HTTP requests from the test suite.
- Never write outside the repo and its stream worktrees (no `~/.claude` edits).
- Never spawn a helper after `cli.js budget` exits non-zero.

## Budget
- Run token budget: 10,000,000
- Usage ceiling: 98% (raised from 70% to 95% and then 98% by the owner, 2026-10-07) of the weekly allowance, checked before every fan-out
- Helper budget: 150,000 (max 200,000)

## Models
- Lead: the session model · scoped builds: haiku · builds: sonnet · hard builds: opus · review: opus · routine: haiku
- Ladder: haiku → sonnet → opus → session. A failed job retries one tier up, never on the same tier.
