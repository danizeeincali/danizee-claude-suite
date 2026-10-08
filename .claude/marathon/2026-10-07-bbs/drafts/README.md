# Drafts for the remaining streams

Written by the lead ahead of time so a resume in a fresh session does not start from zero.

- `bbs-handoff.test.js` — the contract for stream `handoff` (copy to `test/` in that stream's worktree, `node --check` it, run it red, commit, then build).
- `command-docs-plan.md` — what stream `command-docs` builds and the four test files it needs (plugin, command markdown, docs, e2e packaged check).

Both follow the spec `.claude/plans/2026-10-07-w-bbs.md`; where they disagree, the spec wins.

## Stream `command-docs` (written during handoff r2)

- `bbs-plugin.test.js`, `w-bbs-command.test.js`, `bbs-docs.test.js`, `bbs-e2e.test.js` — copy to `test/` in that stream's worktree.
- `fixtures/bbs/` — copy to `test/fixtures/bbs/` (the e2e source, inventory, judgments and decisions). The fixture is never executed.
- Note for the e2e: `judgments.json` uses bare `missing` only (a `have`/`partial` needs a tool). `decisions.json`: `usage-exporter` is `buy` because it is outbound and moves data off the machine; the other two are `rebuild`.
