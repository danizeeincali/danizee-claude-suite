# Status — handoff written by /bcp on 2026-10-09

| Stream / piece | Where | Plan | State | Next | Tasks |
|---|---|---|---|---|---|
| Marathon run `2026-10-07-bbs` (ship `/w-bbs`) | `.claude/marathon/2026-10-07-bbs/` | `.claude/plans/2026-10-07-w-bbs.md` | FINISHED — build gate met; 7 streams merged to local `main` | Owner's `/bcp` pushes `main`; tick `pushed` in `checklist.md` after the push | — |
| `/w-bbs` + `/bbs` | `src/lib/bbs/`, `src/plugins/bbs.js`, `.claude/helpers/bbs/`, `.claude/commands/.shortcuts/{w-bbs,bbs}.md` | same | shipped; suite 1060 tests green; e2e packaged check green 8× | first real source: OpenQodex (`/w-bbs https://github.com/openqodex/openqodex`) | — |
| Marathon core follow-up RC-D010 (`scope` on finish-line lines) | `src/lib/marathon/gate.js`, `test/marathon-gate-scope.test.js` | `.claude/ralph-candidates.md` | done 2026-10-09 | — | — |
| Stream worktrees | `../claude-suite-<stream>` | — | removed; merged branches deleted | — | — |
| Package version | `package.json` | — | 4.3.0, not bumped (ask-before line) | owner decides on 4.4.0 | — |

## Open for the owner
- `pushed` — the only open finish-line line of run 2026-10-07-bbs; `/bcp` is the go.
- Version bump to 4.4.0 and npm publish — not done, needs the owner's word.

## Where the lessons live
- Per-stream write-ups: `docs/solutions/features/bbs-*-stream.md`
- Run measures: `docs/solutions/ideas/marathon.md` → "First real run: 2026-10-07-bbs"
- Standing rules promoted during the run: `.claude/marathon/2026-10-07-bbs/rules.md`
- Candidates: `.claude/ralph-candidates.md` (RC-D028–033 from this run)
