---
memory_key: project/marathon/2026-10-10-kit-wiring/marathon
date: 2026-10-10
run: 2026-10-10-kit-wiring
stream: marathon
---

# kit stream: marathon (marathon 2026-10-10-kit-wiring)

## What shipped

`/w-marathon` (the `'w-marathon'` block of `src/plugins/dot-shortcuts.js`, regenerated into
`.claude/commands/.shortcuts/w-marathon.md`) now calls the kit at four steps of the stream loop and at the push
checkpoint. The owner's rule holds: the kit is advisory, so a missing kit never blocks a workflow that worked before.
Every block takes `W` (the stream's worktree) and `BASE` (the stream's base sha), refuses an empty one, and enters `W`
before it tests for the kit.

**4.2 Isolate, scrub-pattern copy.** After `git worktree add`, a block copies the git-ignored
`.claude/kit/scrub-patterns.local` from the main checkout into the worktree, because a fresh worktree has no copy and
the scrub would silently run without the private patterns. The copy refuses a `W` that is not an existing git work
tree ("set it to the new worktree path", "is not the stream worktree: create it first", exit 1) before it creates
anything. Folder mode (`streams.isolation: folder`) skips 4.2 entirely, activates with `--no-isolation` and uses `W=.`.

**4.5 "Kit analysis for the reviewer".** After the brief and before the spawn, the lead resolves the base from
`streams.json` (a `node -e` reader that catches a missing or invalid file; never `cli.js stream <name>`, which writes
to the store). Two blocks then run inside the worktree, over the stream's whole range from its base: `lenses --diff`
and `impact --diff --base`, both fed by one `diff-range --base "$BASE"` file. When a `.claude/kit/secrets` file exists
(here or in the main checkout) the output goes through `redact --keep-lines`. Exit 3 is an empty range ("no change to
review", exit 0), exit 2 a refusal, exit 1 a broken state; skipped files make every result a floor. The reviewer gets
the brief, then a "Kit analysis" section with the two JSON outputs.

**Push-gate receipt, after `record review`.** A pass block and a fail block run `push-gate receipt --verdict ...
--high --medium --low --base "$BASE"` from the review's counts. Exit 1 on an empty `BASE` or an unenterable `W`
(never read as the advisory skip); exit 2 is a refused receipt store.

**4.8 Gate.** Before `cli.js gate`, `scrub --history "$BASE"` runs in the worktree. The block first checks each pattern
file on its own (public and `.local`) and exits 2 when the main checkout has one the worktree lacks, then keeps the
`"configured": false` check for the case where the main checkout has a pattern file and the scrub read none. Exit 2
is recorded as a high security finding and the stream stays open; so does exit 1 or any other non-zero exit, until a
scrub exits 0. Only gate exit 0 plus a clean scrub sets `state=done`; the next queued stream gets its own 4.2 copy.

**CHECKPOINT 6.** Before any `/bcp`: `/bc` first (it commits the solution doc, changing the tree the receipt was keyed
on), then the receipt is re-recorded from the final counts, then `push-gate check --base "$BASE"`, then `/bcp`. Exit 0
`abstain`: go on. Exit 0 `ask` with "no review recorded for this change": go on and say so. Any other `ask`: not
pushed, the reason goes to the owner. Exit 2 (deny or refused store) and exit 1: not pushed.

**Fallbacks and exit codes.** No kit anywhere: one advisory line, exit 0. A kit the main checkout has but the worktree
lacks: "kit missing from the worktree: commit it or copy it", exit 1. Any other non-zero exit is a failure of that
step, never "nothing found".

## Review ledger

| Round | Angle | H/M/L | Result | Tokens | Reviewed commit |
|---|---|---|---|---|---|
| 1 | one input method at a time | 2/1/3 | over | 75k | 15f1f0f |
| 2 | failure conditions and error paths | 0/2/4 | pass | 75k | 5671237 |
| 3 | older environments and degraded networks | 0/1/1 | pass | 60k | 5f081b1 |
| 4 | the three safety probes | 0/1/1 | pass | 45k | 297cfcd |
| 5 | accessibility | 0/1/2 | pass | 45k | 14bea65 |
| 6 | facts and content | 0/0/1 | pass | 30k | c8ddc24 |

Total: 6 rounds and about 330k review tokens (read from `store/reviews.jsonl`). Each round's fix commit is the next
row's reviewed commit (5671237, 5f081b1, 297cfcd, 14bea65, c8ddc24); the round 6 low is not fixed. Both highs were in
round 1.

## What the reviews taught

**Run every verb inside the worktree (r1, high).** `impact` took its diff from `diff-range --dir "$W"` but resolved its
own directory from the cwd, the main checkout on another branch: 1 touched symbol there against 6 in the worktree,
both exit 0. The reviewer would have got a confident, wrong dependency picture. The blocks now `cd "$W"` first and pass
no `--dir`; lenses, impact, receipt, scrub and check all use the worktree's kit copy. Round 2 added the order: enter
`W` before testing for the kit, or a mistyped `W` prints the advisory skip and the lead goes on to `/bcp` with no gate.

**Private scrub patterns are missing from worktrees (r1 high, r2 medium).** The kit install git-ignores
`scrub-patterns.local`, so a fresh worktree has none; with only the private file, scrub reports `configured: false`
with exit 0 and a secret matching a private pattern passes 4.8 and the push gate. The fix was the 4.2 copy; round 2
showed the usual case (public file committed, private file missing) still has `configured: true`, so 4.8 and
CHECKPOINT 6 now check each file separately. Round 4 found the copy itself created a missing `W` and wrote the private
patterns outside the repository; it now requires an existing work tree.

**Streams share one receipt slot (r1, medium).** `push-gate` keeps one store per git common dir holding one latest
receipt, so the next stream's receipt turns every earlier stream's change into "only an earlier review exists". The
checkpoint re-records the receipt right before the check and tells the lead that such an `ask` means rerun the block.

**Folder mode has no W (r3 medium, r5 medium).** In folder mode the stream row has no `isolation` field and the blocks
never said what `W` was; `cd ""` returns 0, so every block ran silently in the cwd. Empty `W` is now refused, folder
mode is named (`W=.`, skip 4.2). Round 5 found 4.2 still told the lead to create a folder and copy patterns into it,
contradicting 4.5; 4.2 now skips folder mode and activates with `--no-isolation`.

**Quote the real text and the real exit.** `push-gate check` builds its own git without a timeout, so it never raises
"took longer than"; only the scrub inside it can, and that arrives as a deny (exit 2), where the remedy
(`--timeout <ms>`) now sits (r4). Round 5 found the quoted deny wording was invented; the text now quotes push-gate's
"the scrub check is configured but could not run: ... took longer than ... ms and was stopped (raise it with --timeout
<ms>)". `impact` has no `--timeout` flag, so its remedy is not offered.

**Tests must run the blocks (r1, low).** The first suite only regex-matched text, which is why the `--dir` mismatch and
the missing private patterns passed it. A second suite now extracts the blocks and runs them against the real kit.

## Open at close

One low from round 6, not fixed: 4.5 still quotes the 4.2 copy's empty-`W` message as "set it to the stream's isolation
path", while 4.2 (changed in round 5) prints "set it to the new worktree path". Behaviour is unaffected; the two
sections disagree on the quoted text. Fix: say the 4.2 copy prints "new worktree path" and the kit blocks print "the
stream's isolation path", or drop "the 4.2 copy included" from the quoted clause, then regenerate.

## Tests

`test/w-marathon-command.test.js` grew by 496 lines (34 new cases, no deletions) across three groups:

- `kit wiring` (19 cases): text assertions for 4.5, the receipt, 4.8 and CHECKPOINT 6, one case per fix from rounds 1
  to 3, and a `bash -n` pass over every extracted bash block.
- `kit blocks run against the real kit in a stream worktree` (12 cases): temp git repos with a real worktree. An empty
  range exits 0 with "no change to review"; impact reads the worktree files, not the main checkout; private patterns
  missing from the worktree fail the 4.8 scrub and report `configured: true` after the 4.2 copy; a missing `W`, an
  empty `W`, an empty `BASE`, a kit in main but not in `W` and a missing `streams.json` each exit 1 with their message;
  the 4.2 copy refuses a non-work-tree and creates nothing; folder mode runs with `W=.`.
- `round 5 wording` (3 cases): folder mode skips 4.2, 4.2 names `W`, CHECKPOINT 6 quotes the real deny text.
