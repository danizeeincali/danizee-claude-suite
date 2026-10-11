---
memory_key: project/marathon/2026-10-10-kit-wiring/bc
date: 2026-10-10
run: 2026-10-10-kit-wiring
stream: bc
---

# kit stream: bc (marathon 2026-10-10-kit-wiring)

## What shipped

`/w-background-compound` (the `'w-background-compound'` block of `src/plugins/dot-shortcuts.js`, regenerated into
`.claude/commands/.shortcuts/w-background-compound.md`) now calls the kit before every commit and every push. The
owner's rule: the gate stays advisory, so a missing kit or a missing review receipt never blocks `/bc` or `/bcp`.

**Step 0, session base.** The lead runs `diff-range --base-only` into `BASE` before the handoff commit. With no
upstream (the verb prints the empty-tree id), a failed verb or no kit, `BASE` is the pre-handoff HEAD. The sha is
printed and written into the dispatch prompt, because shell state does not carry between tool calls.

**Step 1, category.** One `awk` pass over `diff-range --base "$BASE" --no-untracked` (file headers skipped) scores the
five categories; the temp file sits under a subshell and a `trap`. Exit 3 is an empty range (feature), exit 2 a
refusal, anything else a failure; each prints its own line and the category falls back.

**CHECKPOINT 1, handoff scrub.** The lead `git add`s the handoff paths, runs `scrub --worktree`, and commits only those
paths. After a refusal it unstages with `git reset -q --` (checking the exit), reports "not committed", and tells the
agent "handoff scrub refused: <hits>" so Phases 2 and 3 are skipped.

**Phase 1, redact first.** The first step: `diff-range` into a temp file, `redact --keep-lines` into a second, then
`node -e` writes the `text` field to a third and prints one line, `replaced=<n> bytes=<n> file=<path>`. Analyze,
RC-D/RC-F entries, the solution doc, memory exports and the commit message take only that file. Phase 4 names the
file if it is still there.

**Phase 2.** Scrub, then `git commit -m ... -- <own paths>`; never the handoff files; a scrub hit means no commit.

**Phase 3, push gate.** `push-gate check` before any push. Abstain: push. Ask with reason "no review recorded for this
change": push, and the summary says so. Any other ask: not pushed. Exit 2 (deny or refused store): not pushed. `MB`
(merge-base with upstream) is recorded and printed before the branch push, then reused as `--base` on the main
re-check. A failed branch or main push stops Phase 3 (no merge, no clean-up, no retry, no force).

**CHECKPOINT 4, relay.** The lead relays a "not pushed (branch|main) - gate asks/denied" line word for word. Only an
explicit go on an ask lets the lead push, without rerunning the stop rule and still running the main check; a deny is
never pushed past. The lead records `MB` itself on a branch stop; the agent's summary carries it on a main stop.

`test/w-background-compound-command.test.js` (new, about 100 cases) asserts the text and runs the Step 0, Step 1 and
Phase 1 blocks against real-kit fixtures (git repos built in temp dirs).

## Review ledger

| Round | Angle | H/M/L | Result | Tokens | Reviewed commit |
|---|---|---|---|---|---|
| 1 | one input method at a time | 1/3/3 | over | 75k | e996509 |
| 2 | failure conditions and error paths | 1/3/1 | over | 75k | c1cfd8c |
| 3 | older environments and degraded networks | 0/3/1 | over | 65k | ac22d3d |
| 4 | the three safety probes | 0/2/1 | pass | 60k | a122148 |
| 5 | accessibility | 0/2/3 | pass | 62k | 57b8a1b |
| 6 | facts and content | 0/0/5 | pass | 75k | 622f44a |
| 7 | performance and memory | 0/1/1 | pass | 45k | e19452d |
| 8 | one input method at a time | 0/2/1 | pass | 45k | 08c8757 |
| 9 | failure conditions and error paths | 0/0/2 | pass | 42k | 9ab93ad |

Total: 9 rounds and about 544k review tokens (read from `store/reviews.jsonl`). Each round's fix commit is the next
row's reviewed commit; the round 9 fix is not written, its two lows stay open. The only highs were in rounds 1 and 2.

## Headline findings

- **Redact skipped in a linked worktree (r1, high).** The block checked `.claude/kit/secrets` relative to the cwd and
  wrote raw text when it was missing; the verb also reads the main checkout's copy, and streams run in linked
  worktrees. Fix: never test for the file, always run `redact --keep-lines`.
- **No receipt returns ask, not abstain (r1, medium).** `push-gate` answers `ask` (threshold none) or `deny` (stricter
  threshold) with "no review recorded for this change". The text said abstain, so every `/bcp` would have stopped,
  making the gate blocking. Fix: name that one ask reason as the push-goes-on case; every other ask stops.
- **HEAD~1 diffed the handoff commit (r2, high).** The lead commits the handoff before dispatch, so `git diff HEAD~1`
  covered that commit, not the session. Fix: the lead records the session base and passes `BASE` in the prompt.
- **MB was recorded after the push (r3, medium).** A successful push moves the remote-tracking ref, so the merge-base
  became HEAD and the main re-check never matched the branch receipt. Fix: record before the push. r5 added that the
  value must be printed and carried, since shell state dies between calls; r6 that the lead needs it too.
- **git restore --staged on old git (r3, medium).** It needs git 2.23; on older git the unstage failed unchecked and the
  secret-bearing paths stayed staged. Fix: `git reset -q --` with a checked exit.
- **Lazy-fetch git diff (r4, medium).** A bare `git diff "$BASE"` in a partial clone fetches over the network and can hang
  on a credential prompt. Fix: use `diff-range`, which turns lazy fetch off, for every range read.
- **The JSON range on stdout (r7, medium).** `redact` prints the whole range as one JSON line; a Bash result is cut at
  about 30K characters, so Analyze worked on a partial view. Fix: write `text` to a file, print one summary line.
- **The guard deleting inherited files (r8, medium).** When an earlier `mktemp` failed, later variables kept inherited
  values and the guard's `rm -f` deleted those files. Fix: clear `D=; J=; R=` before the guard. The same round found the
  cleanup of `R` ran in a fresh shell with `R` empty; the agent now uses the path from `file=`.
- **Relay loop and the main re-check (r2, medium).** A foreground rerun of Phase 3 stopped on the same ask forever, and
  the main re-check, keyed on a different base, held reviewed changes while unreviewed ones went through. Fix: go
  skips the stop rule; `--base "$MB"` on the main check; a deny is never pushed past.
- **Redact covered only the solution doc (r4, medium).** Diff text also lands in `ralph-candidates.md` and the commit
  message. The rule now covers every write and commit that carries diff text (r5 moved redact to the first step).

## Open at close

Two lows from round 9 stay open, neither fixed:

- The test "failure paths leave no file" runs no failure path: the exit-3 case only checks stdout has no `file=`.
  Run exit 3 and one failure case (redact exit 1, non-JSON output) against an empty `TMPDIR` and assert it is empty.
- The `node -e` JSON-to-file step, if it fails after redact exited 0 (bad JSON, no `text`, write error), exits 1 with
  only Node's stack trace. Add `|| echo "redact output could not be written (exit $RC): nothing redacted" >&2` and
  name the path in the prose.

## Lessons

- Harden every git read in a template, not only the first: a bare `git diff` lazy-fetches, a bare `git restore` may not
  exist, a pipe hides git's exit behind the next command's. Route ranges through the kit verb (`diff-range`) and write
  to a file so git's own exit is checked; use `git reset -q --` for unstaging.
- A background agent and the lead do not share a shell. Carry every value (`BASE`, `MB`, a temp path) across tool
  calls by printing it and writing it into the next prompt or step; never rely on a variable surviving.
- Split the lead/agent roles by name for each value and each stop: who records it, who holds it, who relays a gate
  stop, who may push after a go. An agent cannot hold a conversation with the owner; it writes a line and stops.
- Redact everywhere diff text lands: the solution doc, candidates file, memory exports and the commit message. Make
  redact the first step and let nothing read the raw range after it.
- Commit with path-limited commits (`git commit -m ... -- <paths>`) so the agent never carries the lead's staged files.
- Check the verb, not the memory: read what `push-gate` returns with no receipt (ask, not abstain) and what each exit
  code means before writing the branch; test with real-kit fixtures, not only the wording.
- Clear temp-file variables before a guard that deletes them, put the `trap` where the files are made, and keep
  large output in a file and print one line.
