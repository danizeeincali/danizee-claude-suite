# /w-bbs stream `intake` — store, config, intake, status, CLI skeleton

Memory key: `project/marathon/2026-10-07-bbs/intake` · Run: `2026-10-07-bbs` · Closed 2026-10-07
Spec: `.claude/plans/2026-10-07-w-bbs.md` · Library: `src/lib/bbs/` (832 lines in 5 modules)

## What the stream built

| Module | Lines | Contract |
|--------|-------|----------|
| `store.js` | 121 | Run dirs under `.claude/bbs/runs/<id>/`, `ACTIVE` pointer, registry and `egress.jsonl` as JSONL, atomic writes (tmp + rename) |
| `config.js` | 66 | `DEFAULT_CONFIG`, `loadConfig`; `paths.runs` / `paths.registry` must stay under `<project>/.claude/bbs` |
| `intake.js` | 340 | `classifySource` -> `repo \| url \| local \| paste`; identity (git HEAD, manifest sha256, paste sha256, `pending` for url); registry lookup (`known`, `reuse_from`); atomic run claim; zero-egress row |
| `status.js` | 123 | Renders `status.md` (atomic; read-only run dirs warn instead of failing); `--next` names the next verb |
| `cli.js` | 182 | Verbs `intake`, `status`, `report`; JSON to stdout, `fail()` -> stderr + exit 1; per-verb flag tables and usage |

Contracts: `intake <source|-> [--paste-file p] [--slug s] [--as t]` creates and claims the run, writes
`source.json` last, sets ACTIVE. `status [--next]` and `report` (`found=.. approved=.. skipped=.. buy=..
marathon=..`) re-render `status.md`. Without `--run`, ACTIVE is used; `--project <dir>` overrides the root.

## Commits (branch `marathon/2026-10-07-bbs/intake`, merged in 9d48a0e)

`2ab1922` contracts as failing tests -> `e51df97` implementation -> `2b9e184` r1 fix (+21 regression
tests) -> `4baf845` r2 (+13) -> `5b7551c` r3 (+5) -> `55e8bb2` r4 (+14) -> `497e7cf` r5 (+6) ->
`5921405` r6 (+2). Total: 61 regression tests added by fixes.

## Review ledger

Tolerance (`finish-line.json`): high 0, medium <= 2, low <= 5, two passes in a row. Rounds 4, 5, 6 passed.

| Round | Angle | H / M / L | Result | What was found |
|-------|-------|-----------|--------|----------------|
| r1 | one input method at a time | 2 / 5 / 4 | over | `--run`/ACTIVE path traversal; path with a space classified as paste; missing path silently a paste; value flag with no value falls back; symlinks skipped in manifest |
| r2 | failure conditions, error paths | 0 / 3 / 3 | over | concurrent intakes share a run id; `source.json` written before its payload; unborn-HEAD repo cannot be taken in; null jsonl row crashes status |
| r3 | older environments, degraded networks | 0 / 4 / 1 | over | non-atomic ACTIVE write; stdin decoded as UTF-8 (identity corrupted); project root silently `~/.claude`; symlinked CLI path is a silent no-op; run-id case |
| r4 | safety probes: egress, secrets, sandbox escape | 0 / 2 / 2 | pass | credentials in source ref persisted; `GIT_DIR` inherited so identity from another repo; `.git` file/symlink escape; config paths escaping `.claude/bbs` |
| r5 | accessibility | 0 / 1 / 4 | pass | stray positionals ignored; run-id errors lack the fix; usage hides flags and `-`; empty-paste unnamed; `report` aborts on write error |
| r6 | facts and content | 0 / 2 / 0 | pass | stale-ACTIVE message advises "omit --run"; empty-paste label says stdin for the source argument |

33 findings in total. Fixes after a pass (r4-r6) were each reviewed by the next round; r6 fixes
were the last change and are covered by two regression tests.

## Promoted rules (seen in two reviews, now in `rules.md`)

1. **Claim atomically, commit last** (`correctness`, r1 + r2): exclusive create (`mkdir` without recursive,
   `wx`, tmp + rename); the marker file that says "done" is written last, so a half-made run never reads complete.
2. **Fail loudly, never fall back silently** (`other`, r1 + r2): every failure names cause and file/input; a
   fallback is an error or a stderr warning naming it.
3. **Nothing the user did not name is read, nothing secret is kept** (`security`, r1 + r4): paths, run ids
   and config values are contained under their root; `git` runs with explicit dir and scrubbed env; refs are
   redacted before print, persist or log.
4. **Every message names the real state** (`facts`, r1 + r6): which input/file/pointer a message is about, and
   dates, limits and formats are read from the same constant the code enforces.

## Lead decision at stream close: per-stream vs run-wide lines

`cli.js gate --stream <s>` scopes `runs.streak:*`, `reviews.*`, `findings.open:*` to the stream, but
`e2e_streak`, `packaged`, `helpers_over_budget` and `pushed` are run-wide and cannot be met before the last
stream exists. Decision: a stream **closes** when its own lines are met (`clean_reviews`, `latest_high`,
`open_high`, `unit_streak`) with all its findings closed and the fixes reviewed; run-wide lines are judged
by plain `cli.js gate` at the end. Follow-up for the marathon core (additive): a `scope: run|stream` field
on finish-line lines so the per-stream gate states this itself.

## Measured numbers (`cli.js model-stats`, at close)

| Tier | Spawned | Done | Green | Red | Tokens total | Mean per helper | First-pass green |
|------|---------|------|-------|-----|--------------|-----------------|------------------|
| sonnet | 5 | 4 | 4 | 0 | 352,733 | 88,183 | 100% |
| opus | 8 | 8 | 8 | 0 | 761,739 | 95,217 | 100% |

- Reviews cost about 80-98k tokens each; builders and fixers about 80-113k. No helper went over budget;
  no escalations.
- Total helper spend for this one stream: 1,114,472 tokens (352,733 + 761,739), about 1.1M.
- Implication: six streams remain against the 10M run budget. At the same rate they would add about 6.7M
  (6 x 1.1M), for roughly 7.8M in total, leaving about 2.2M headroom. That is a straight extrapolation;
  fetch (network guards) and verdict (licence policy) are likely to need more rounds than a skeleton did, so
  watch `cli.js budget` after each stream rather than trusting the projection.

## Habits that worked

- **Contracts as failing tests first** (`2ab1922` before `e51df97`): the builder had an executable spec.
- **Regression test first for every fix**: each review fix commit ships tests (61 across six rounds), so
  a later round cannot silently undo an earlier fix.
- **Fixes after a pass are reviewed by the next round**, never self-certified.
- **Different angle each round** (inputs, failures, environments, safety, accessibility, facts) found new
  classes of defect each time; findings fell from 11 to 2.
- **Promote a category when seen twice**, so builders in later streams get the rule before the review does.
