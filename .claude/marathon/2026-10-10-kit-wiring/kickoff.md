# Kickoff — 2026-10-10-kit-wiring

Wire the eleven kit verbs (`node .claude/helpers/kit/cli.js <verb>`, rebuilt from the OpenQodex /w-bbs run)
into the suite's workflows. Today only /w-review (lenses, graph, impact, push-gate receipt) and /w-marathon
step 4.5a (review-score, wording judge) call the kit. The owner asked for /pt, /bc, /bcp, /w-marathon and /bbs
by name, plus a sweep of every other workflow for places a verb fits.

## Done means
- Every stream: green unit runs in a row ≥ 1, clean reviews in a row ≥ 2, no open high finding.
- Run-wide: the repo copies under `.claude/commands/.shortcuts/` equal the generator output (`regenerated`), and
  one full `npm test` is green after the last stream (`full_suite`).
- Each wired step says what to do when the kit is not installed (`.claude/helpers/kit/cli.js` missing): say so in
  one line and continue. A wiring never blocks a workflow that worked before.
- Each wired step says what a non-zero exit means (1 = wrong input or broken state, report it; 2 = refused or hits,
  stop that step) and never reads it as "nothing found".
- The push gate stays advisory: it abstains, asks or denies, and never skips the user's own permission prompt.
- Streams:
  - `diff-range`: a new kit verb that prints the review range (committed since the merge base with the upstream,
    or the whole history, plus uncommitted edits and untracked files) as one unified diff on stdout, so every
    workflow calls `cli.js diff-range | cli.js <lenses|graph|impact> --diff -` instead of copying w-review's
    three bash blocks; w-review switches to it.
  - `pt`: /w-plan-tdd-swarm — lenses, graph and impact at CHECKPOINT 6 Review; `callers --symbol` for the
    Search phase's file:line targets; a closing step with `scrub --worktree` and `push-gate receipt`.
  - `bc`: /w-background-compound (/bc, /bcp) — `scrub --worktree` before the lead's commit and the background
    agent's commit; `push-gate check` at the start of Phase 3 before any push (deny → not pushed, say so; ask →
    put it to the owner; no receipt → abstain, the push goes on); the "never abort" clause no longer swallows a
    gate deny; `redact` on the diff text before it is written into the solution doc when `.claude/kit/secrets`
    exists.
  - `marathon`: /w-marathon — 4.5 appends lenses and impact (`--base` = the stream's base commit) to the reviewer
    brief and records a `push-gate receipt` from the review counts; 4.8 runs `scrub --history <base>`; CHECKPOINT
    6 runs `push-gate check` before any /bcp; the text says review-brief already redacts the diff.
  - `bbs`: /w-bbs — the inventory and probe helper briefs (generated in src/lib/bbs) tell helpers to run any git
    read of `fetched/` through `safe-git --dir <clone> -- <args>`; CHECKPOINT 4 redacts probe evidence when a
    secrets file exists; CHECKPOINT 6 runs `scrub --worktree` before /bc.
  - `sweep-commits`: w-tdd-swarm, w-agent-tdd-swarm, w-debug, w-hotfix, w-security, w-end, w-ralph-pick,
    w-autoresearch — lenses (plus impact where a review step exists), `scrub --worktree` before every commit,
    `push-gate receipt` at the closing step, `push-gate check` before every push the workflow itself performs.
  - `sweep-foreign-and-logs`: w-multi-repo and w-suite-sync (`safe-git` for every read of a repo the user did not
    write, lenses at the verify step), w-compound (`redact` before the Pi Brain POST and the stored doc),
    w-ralph-batch (`redact --keep-lines` in the generated script's log pipe), w-swarm and w-fix (lenses at the
    verification checkpoint, `callers` at investigation).

## You may decide on your own
- The wording of each wired step, as long as it names the verb, the exit codes and the no-kit fallback.
- Which of the sweep's optional fits (guarded-write for plan files, graph in w-perf and w-architect) to leave out.
- Test names, fixtures and file layout; a command test per stream in the pattern of test/w-review-command.test.js.
- Regenerating `.claude/commands/.shortcuts/` from the generator after every text change.

## Ask me before
- Adding a dependency.
- Changing a finish line or the tolerance.
- Making any wired step blocking for a workflow (the default is advisory with a one-line fallback).
- Any network call beyond the existing Pi Brain reads.

## Never
- Never push or merge; /bc commits only, the owner's /bcp or PR merge is the go.
- Never weaken an assertion or skip a test to get green.
- Never make the push gate bypass or answer the user's permission prompt.
- Never change a kit verb's behaviour from a wiring stream; a verb change is its own stream (`diff-range`).

## Budget
- Run token budget: 10,000,000 (expected spend 4–6M: seven streams, mostly command text)
- Usage ceiling: 100% of the weekly allowance, checked before every fan-out
- Helper budget: 150,000 (max 200,000)

## Models
- Lead: the session model · scoped builds: haiku · builds: sonnet · hard builds: opus · review: opus · routine: haiku
- Ladder: haiku → sonnet → opus → session. A failed job retries one tier up, never on the same tier.
