# Finish-line scope — run-wide lines stop failing per-stream gates

Memory key: `project/features/marathon-gate-scope` · Commit `8cb3d9d` · Origin: RC-D010 from run `2026-10-07-bbs`

## Why

During the 2026-10-07-bbs run, `cli.js gate --stream <s>` evaluated every finish-line line against one
stream's runs, reviews and findings. Run-wide lines (e2e streak, packaged check, helpers over budget,
human `pushed`) can never be met by a single stream, so the per-stream gate reported them as failing
the whole run. The lead closed streams by a written rule instead of by the gate, which defeats the
gate. RC-D010 recorded the gap.

## What changed

- `src/lib/marathon/gate.js`: new exported `SCOPES = ['run', 'stream']`. A line may carry an optional
  `scope`. `validateFinishLine` rejects any other value ("scope must be one of run, stream").
- `evaluateGate`: with a `stream` given, a counted line with `scope: run` gets status `run_scoped`.
  It is reported but excluded from the counted set, so it affects neither `buildGateMet` nor `gateMet`.
  The result gains `runScoped` (ids) and each line gains a `scope` field (`null` when unset).
- Without `--stream` (the run-wide gate) every counted line is judged as before, scope or not.
- Lines with `scope: stream` or no scope are counted per stream exactly as before (compatible).
- `status.js` / `page.js`: label `run_scoped` as "run-wide (judged by the run gate)", styled muted.
- `finish-line.example.json` (src/templates and .claude/marathon) tags e2e_streak, packaged,
  helpers_over_budget and pushed as `run`, review/finding lines as `stream`; its `$comment` explains it.
- `.claude/helpers/marathon/*` synced from `src/lib/marathon/*`; README and the `w-marathon` command doc
  (and its copy in `src/plugins/dot-shortcuts.js`) mention the field.
- Tests: `test/marathon-gate-scope.test.js` (88 lines).

## How to use

In `finish-line.json`, add `"scope": "run"` to lines only the whole run can satisfy; leave stream-local
lines as `"stream"` or untagged:

```json
{ "id": "e2e_streak", "source": "runs.streak:e2e", "value": 6, "scope": "run" }
```

`node .claude/helpers/marathon/cli.js gate --stream intake` now lists those lines under `runScoped`
and decides the stream gate from the remaining lines. Run `gate` with no `--stream` to judge the run.

## Verify

`node --test test/marathon-gate-scope.test.js` (RC-D034). If it fails, re-apply the change (RC-F034).
