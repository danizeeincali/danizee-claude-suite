# Status — updated 2026-10-10 after the first real /w-bbs run

| Stream / piece | Where | Plan | State | Next | Tasks |
|---|---|---|---|---|---|
| Marathon run `2026-10-07-bbs` (ship `/w-bbs`) | `.claude/marathon/2026-10-07-bbs/` | `.claude/plans/2026-10-07-w-bbs.md` | FINISHED — build gate met; 7 streams merged to local `main` | Owner's `/bcp` pushes `main`; tick `pushed` in `checklist.md` after the push | — |
| `/w-bbs` + `/bbs` | `src/lib/bbs/`, `src/plugins/bbs.js`, `.claude/helpers/bbs/`, `.claude/commands/.shortcuts/{w-bbs,bbs}.md` | same | shipped; first real run done 2026-10-10 (OpenQodex, 11 powers approved); two fetch/inventory fixes in PR #7; suite 1063 tests | — | — |
| Marathon run `2026-10-10-bbs-openqodex-2` (rebuild 11 OpenQodex powers) | `.claude/marathon/2026-10-10-bbs-openqodex-2/` | `.claude/bbs/runs/2026-10-10-openqodex-2/briefs/` | queued, nothing built | owner runs `/w-marathon --resume 2026-10-10-bbs-openqodex-2` | — |
| CI | `.github/workflows/test.yml` | — | `npm test` on Node 20 and 22, green on PR #7 | — | — |
| Marathon core follow-up RC-D010 (`scope` on finish-line lines) | `src/lib/marathon/gate.js`, `test/marathon-gate-scope.test.js` | `.claude/ralph-candidates.md` | done 2026-10-09 | — | — |
| Stream worktrees | `../claude-suite-<stream>` | — | removed; merged branches deleted | — | — |
| Package version | `package.json` | — | 4.4.0 bumped, CHANGELOG.md added (release PR) | owner runs `npm publish` after merge | — |

## Open for the owner
- PR #7 (first real /w-bbs run fixes + CI) is a draft: review and merge.
- Start the OpenQodex build: `/w-marathon --resume 2026-10-10-bbs-openqodex-2`.
- RC-D037 and RC-D038 (map candidates, egress line for a model-calling power) need a call.
- `pushed` — the only open finish-line line of run 2026-10-07-bbs; `/bcp` is the go.
- `npm publish` of 4.4.0 — owner publishes from their machine after the release PR merges.

## Where the lessons live
- Per-stream write-ups: `docs/solutions/features/bbs-*-stream.md`
- Run measures: `docs/solutions/ideas/marathon.md` → "First real run: 2026-10-07-bbs"
- Standing rules promoted during the run: `.claude/marathon/2026-10-07-bbs/rules.md`
- Candidates: `.claude/ralph-candidates.md` (RC-D028–033 from the build run, RC-D035–038 from the first real run)
- First real run write-up: `docs/solutions/features/bbs-first-real-run-openqodex.md`
