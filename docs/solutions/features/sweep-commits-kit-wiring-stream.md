---
memory_key: project/marathon/2026-10-10-kit-wiring/sweep-commits
date: 2026-10-10
run: 2026-10-10-kit-wiring
stream: sweep-commits
---

# kit stream: sweep-commits (marathon 2026-10-10-kit-wiring)

## What shipped

Eight workflows (the `'w-tdd-swarm'`, `'w-debug'`, `'w-hotfix'`, `'w-security'`, `'w-agent-tdd-swarm'`, `'w-end'`,
`'w-autoresearch'` and `'w-ralph-pick'` blocks of `src/plugins/dot-shortcuts.js`, regenerated into
`.claude/commands/.shortcuts/<name>.md`) now call the kit where they review, commit or push. The owner's rule holds: the
kit is advisory, so a missing kit never blocks a workflow that worked before; each step has a one-line fallback when
`.claude/helpers/kit/cli.js` is missing. Every Code Analysis step says what the range covers, including the
no-upstream case, where `diff-range` falls back to the empty tree and the removal check cannot find removals.

**w-tdd-swarm, w-debug, w-hotfix, w-security.** `lenses` and `impact` run at the review checkpoint (hotfix: the
security review; security: after the analysis), and their findings go into the review findings above. A closing "Scrub
and receipt" step follows: scrub the tracked files, then record the receipt from the review counts. A scrub refusal
(exit 2) or failure (any other non-zero exit) means no commit and no receipt, and the step names every receipt exit
(0, 1, 2, other). The re-record after Compound happens only when a receipt was recorded before Compound and the tracked
tree changed since; after a refusal nothing is re-recorded.

**w-agent-tdd-swarm.** Lenses and impact sit inside the verification checkpoint. Phase 7 is now a chain: a whole-index
diff check (`git diff --quiet`, no path) that gates the scrub, then the scrub, the commit, the receipt, a push-gate
check, the push and the PR. The receipt fails when any high finding remains and says which verdict to record when only
medium or low findings are left. A failed receipt, a scrub refusal, a gate `ask` or `deny`, and a failed push all mean
"not pushed", and the workflow reports `not pushed — <reason>` to the parent: Phase 7, the Phase 9 report, the notify
line ("Agent {id} finished: pushed PR {url} | not pushed — {reason}"), the rules and the checklist all carry it, and
no PR is created on those paths.

**w-end.** The final gate is conditional: after a scrub refusal it no longer says "Commit complete" or offers "Push to
remote". "Push to remote" runs the guarded push-gate check first, every exit named. The re-stage after a diff-check
failure covers only paths that are both staged and listed by `git diff --name-only`; any other unstaged path belongs to
the owner, so the workflow asks the owner and does not pull the edit into the commit.

**w-autoresearch.** A clean-tree precondition runs before each experiment: no unstaged or staged change and no
untracked file except the loop's own state files (`autoresearch.jsonl`, `.autoresearch-off`, the State Files table);
otherwise the loop pauses and touches nothing. The Keep step stages by path (never `git add -A` or `.`), then records
three path lists with `--no-renames`: the experiment's paths, its new paths (`--diff-filter=A`) and its tracked paths.
A scrub refusal is a Crash and reverts in order: `git reset -q -- <paths>` (the checkout restores from the index), then
`git checkout --` of the tracked paths, then `git clean -fd --` of the recorded new paths only, skipped when the list is
empty. Discard and Crash revert the same way and never `git checkout -- .`. Three scrub refusals in a row pause the loop.

**w-ralph-pick.** Lenses only, at Completion Verification, with a "Lens findings" line in the required output. It does
not commit, so it has no scrub and no receipt, and the range sentence drops the removal-check clause it cannot run.

**Generator-wide fixes (all regenerated copies).** The generator wrote triple-escaped backticks in fifteen entries (a
literal backslash before every backtick in the regenerated file; fixed in e5920e7, 328 lines). Regeneration also
brought a broken Pi Brain curl line with an open quote into nine copies, fixed so `bash -n` passes, and restored the
RuFlo blocks and w-end's `AUTO-PROCEED: Continue to Commit phase.` that the drifted generator had dropped. The wording
for the gate's "earlier review" ask now says what the gate really decides (see below).

## Review ledger

| Round | Angle | H/M/L | Result | Tokens | Reviewed commit |
|---|---|---|---|---|---|
| 1 | one input method at a time | 0/2/4 | pass | 70k | e5920e7 |
| 2 | failure conditions and error paths | 0/2/4 | pass | 90k | 6845f97 |
| 3 | older environments and degraded networks | 0/1/2 | pass | 45k | 349d04b |
| 4 | the three safety probes | 0/2/1 | pass | 42k | 3074caf |
| 5 | accessibility | 0/1/2 | pass | 22k | db7f626 |
| 6 | facts and content | 0/2/0 | pass | 30k | d6fa12d |
| 7 | performance and memory | 0/0/1 | pass | 30k | 38552ec |

Total: 7 rounds and about 329k review tokens (read from `store/reviews.jsonl`; the 24 findings match
`store/findings.jsonl`). Each round's fix commit is the next row's reviewed commit (build 4fd59be and generator fix
e5920e7, then 6845f97, 349d04b, 3074caf, db7f626, d6fa12d, 38552ec). There was no high in any round.

## What the reviews taught

**A scrub that reads disk must gate on index equals disk (r2, r4, r5, r6).** `scrub --worktree` lists index entries
but reads each file from disk, while `git commit` commits the index. A secret staged and then edited out on disk passed
the scrub and was committed. Round 4 showed a check limited to the paths just staged misses a path staged earlier, so
the check is a plain `git diff --quiet` with no path. Round 5 moved it from prose into the fenced block, and round 6
made it stop the scrub: it exits 1 on a difference, `$D` on a git error, and the scrub only runs when it is clean.

**`git clean` never without a path (r4).** The autoresearch revert ran `git clean -fd -- <the experiment's new paths>`.
Most experiments create no file, so the placeholder list was empty and the command cleaned every untracked file,
including `autoresearch.jsonl` and the sentinel. The clean is skipped when the recorded new-path list is empty.

**`git checkout -- .` destroys work that is not yours, so require a clean tree instead (r6).** The revert took
`git diff --cached --name-only` as "the experiment's paths", but the index can hold paths someone else staged. Scoping
the revert is not enough while the loop starts from a dirty tree, so each experiment now starts with a clean-tree check
and the lists are recorded by path with `--no-renames`. A test shows a staged file and an unrelated edit fail the
check and that the revert loses nothing else.

**A check in prose is not a check in the block (r5, r6).** The diff check lived in a paragraph while the fenced block a
reader copies ran only the scrub; once in the block, round 6 found it only echoed a message and the block's exit code
was the scrub's. A rule must be in the command that runs, with its own exit code, and a test checks it is one if-chain
before the scrub.

**Order matters when undoing a stage (r3).** The first revert ran `git checkout -- .` before the unstage; the index
still held the refused content, so the checkout restored it. The order is unstage, checkout, clean.

**The gate's "earlier review" ask fires for any receipt in the repository store (r2).** `push-gate` keeps one store
per repository, so once any review exists the "no review recorded, push goes on" path stops applying; the wired text
now describes the ask correctly and treats it as not pushed. This is a kit behaviour, left for its own stream.

**Regenerating from a drifted generator exposes old escaping bugs (r1, generator fix).** The committed copies had been
edited by hand while the generator kept stale text: triple-escaped backticks, a curl line with an open quote, missing
RuFlo blocks and AUTO-PROCEED. Regenerating exactly the eight copies surfaced all of them; each is fixed in the
generator and asserted by a test, and the copies compare equal to `getCommands()`.

**A refusal path needs its own wording everywhere (r1, r2, r3).** "Commit complete" and "Push to remote" were left on
the refusal path of w-end, "completed. PR: {url}" on every not-pushed path of w-agent-tdd-swarm, and "record no
receipt" was undone by an unconditional post-Compound re-record. Each state the workflow can end in needs its own text.

## Open at close

One low, from round 7, not fixed: the Discard revert stages every changed file with `git add` only to record path
lists, then runs three `git diff --cached --name-only` calls plus reset, checkout and clean, six git calls per Discard
in a loop that runs forever, and the staging writes loose blobs that wait for auto-gc. One
`git diff --cached --name-status --no-renames` split by status, or deriving the lists without staging, would do. It is
behaviour-neutral. Kit follow-up, in its own stream: the push gate's "earlier review" ask fires for any receipt in the
repository store, so the wired "no review recorded" path only applies to a repository with no receipt.

## Tests

`test/sweep-commits-command.test.js` is a new file of 454 lines with 56 cases in 8 suites (all passing with
`node --test`):

- Text assertions (about 50 cases, several run once per workflow): each copy equals the generator output; lenses and
  impact inside the review checkpoint and scrub then receipt before Compound for the four review workflows; the
  w-agent-tdd-swarm chain, exit codes and not-pushed report; w-end's conditional gate and guarded push; autoresearch
  and ralph-pick wording; one case per fix from rounds 1 to 6; the Pi Brain curl line and AUTO-PROCEED checks (one case
  runs `bash -n` on the fixed line).
- Run-based cases (4, in temp git repos with the block extracted from the generated text and run as written): the
  w-end, w-agent-tdd-swarm and w-autoresearch scrub blocks each exit 1 and run no scrub when index and disk differ,
  with and without the kit; and the autoresearch precondition fails on a staged file and on an unrelated edit while
  the scoped revert loses nothing else.
