---
memory_key: project/marathon/2026-10-10-kit-wiring/pt
date: 2026-10-10
run: 2026-10-10-kit-wiring
stream: pt
---

# kit stream: pt (marathon 2026-10-10-kit-wiring)

## What shipped

`/w-plan-tdd-swarm` (the `'w-plan-tdd-swarm'` block of `src/plugins/dot-shortcuts.js`, regenerated into
`.claude/commands/.shortcuts/w-plan-tdd-swarm.md`) now calls the kit at three points. The phase list grew from 9 to 12.

**Callers, at CHECKPOINT 0 Search.** For every file:line target the search produces for a symbol that will be changed or
removed, the step runs `callers --symbol <file>:<name>` (path relative to the repository top) and carries each symbol's
callers, `floor`, `reasons` and `sentences` forward. Zero callers with `floor: true` is never "unused". Exit 0 can
still leave a symbol out: `missing` (with reasons), `partial` and `not_read` are read, and a symbol in `missing` was not
answered, never "no callers".

**Code Analysis, at CHECKPOINT 6 (review).** Three bash blocks, in order, over the `diff-range` output (merge base to
working tree plus untracked files): `lenses --diff`, `graph --diff --budget-ms 20000 --max-parses 300`, and `impact
--diff --base`. The impact block resolves the base once with `diff-range --base-only` into `B` and gives it to both
verbs. A paragraph says how to read the results: `fired` bodies as extra checks, `partial`/`not_read` for the graph,
`removed_with_live_callers`, `risk` and `cuts` for impact, and "floor, never nothing else is affected" whenever
`partial`, `risk.lower_bound`, `cuts` or a skipped file is present.

**Closing step, Scrub and receipt.** After Verification and before Compound: `git add` the new files, `scrub --worktree`,
then `push-gate receipt --verdict pass|fail --high --medium --low` (`--incomplete` if a category was skipped). After
Compound, `git add` its new files and re-record the receipt if the tracked tree changed. The user is told to run
`push-gate check` before pushing.

**Housekeeping:** phase count 9 to 12 in the template, `src/utils/shortcuts.js` and `WORKFLOW-SHORTCUTS.md`; three new
checklist lines; `test/w-plan-tdd-swarm-command.test.js` asserts the command text (new in this stream, grew each round).

## Review ledger

| Round | Angle | H/M/L | Result | Tokens | Reviewed commit |
|---|---|---|---|---|---|
| 1 | one input method at a time | 0/2/4 | pass | 75k | abb7690 |
| 2 | failure conditions and error paths | 0/1/4 | pass | 45k | 12a60f3 |
| 3 | older environments and degraded networks | 0/0/3 | pass | 60k | 1948b45 |
| 4 | the three safety probes | 0/0/1 | pass | 45k | 15c224c |

Total: 4 rounds and about 225k review tokens (read from `store/reviews.jsonl`). Each round's fix commit is the next
row's reviewed commit; the round 4 finding stayed open.

## Headline findings

- **Callers can exit 0 and still answer nothing (r1, medium).** A typo, a renamed file or an unread file puts the symbol
  in `missing` with no entry, which reads as "no callers". The step now reads `missing`, `partial` and `not_read`.
- **The receipt and the scrub skipped the new files (r1, medium).** Both cover tracked files only, and a build's new
  files are untracked. The receipt was also recorded before Compound, so the committed tree would not match. Fix: `git
  add` first, re-record after Compound, say untracked files are in neither.
- **Exit 0 from `diff-range` is not always a complete range (r2, medium).** Skipped untracked files (too_large,
  max_untracked, nested repository) mean every result is a floor. In r3 the text was corrected to what the output
  shows: too_large names files on stderr, max_untracked gives only a count, a nested repository is visible only with
  `--json`.
- **One exit code, two instructions (r2).** "Any other non-zero exit is broken state" overlapped the exit 2 refusal. Codes
  were split per code; r3 added a catch-all for 127 and signals so a dead verb is never read as nothing found.
- **An empty range ended the block with status 3 (r2).** The tool shows non-zero as an error. The `3)` branch now sets
  `RC=0`.
- **A missing kit looked like a diff-range failure (r2).** Each block starts with a guard on `cli.js` that prints a one-line
  skip and ends `(exit 0)`, which sets the status without closing the shell.
- **A failing mktemp was reported as a diff-range failure (r3).** Guarded: it prints `mktemp failed` and `diff-range`
  does not run.
- **`push-gate check` exits were unnamed (r1, r2).** 0 is abstain or ask, 2 is deny or a refused receipt store, 1 an
  error, none an allow.

## Open at close

One low finding from r4 remains open: the range temp file is left behind if a block is interrupted. The three Code
Analysis blocks write the full `diff-range` output, which can include an untracked `.env`, to a `mktemp` file (mode
0600) that only the trailing `rm -f` removes, with no `trap`. An interrupt during graph or impact leaves the copy in
TMPDIR. The same pattern exists in the existing /w-review blocks, so a fix belongs in both
(`trap 'rm -f "$D"' EXIT INT TERM` after mktemp succeeds, or a subshell with that trap).

## Lessons

- Use one shared bash block for every kit call that reads a range: a kit guard (`[ -f .claude/helpers/kit/cli.js ]`,
  else print one line and `(exit 0)`), a mktemp guard (`D=$(mktemp 2>/dev/null) && [ -n "$D" ] || {...}`) so a tool
  failure is named as itself, then `case $RC in 0) verb;; 3) echo ...; RC=0;; *) echo ... >&2;; esac`. Setting 3 to 0
  is what keeps an empty range from showing as an error.
- Split exit codes per code in the prose (0, 1, 2, 3) and add a catch-all for everything else. Check each verb's own exit
  2 (a refusal, report as printed) separately from the shared producer's.
- Exit 0 is not "complete". For every verb, read what it can leave out (`missing`, `partial`, `not_read`, skipped
  files, `lower_bound`) and say results are a floor; test that the text contains it.
- The receipt and `scrub --worktree` cover tracked files only. Tell the agent to `git add` new files first, and again
  after Compound; say untracked files are in neither.
- Check that the text promises only what the output shows. "Name each skipped file" failed because only one of three
  skip reasons prints names.
- Update every copy of a count (template, `src/utils/shortcuts.js`, `WORKFLOW-SHORTCUTS.md`) when phases change, or
  drop the count.
- Write the temp-file `trap` into the shared block from the start, and sweep every block that copies the pattern.
