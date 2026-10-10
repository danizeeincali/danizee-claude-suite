# Kickoff — 2026-10-10-bbs-integration

Plan: `.claude/plans/2026-10-10-bbs-integration.md`. Fix the /w-bbs process so the powers it builds land in the
workflows the owner actually runs, and the owner is told what they got and how to use it.

## Done means
- /w-bbs discovers the workflows the owner uses (local session transcripts, or the owner's own list) before the
  verdict, and never assumes them.
- Every approved power names where it lands (workflow, step, advisory or blocking) and the one verdict question
  approves those targets with the verdicts. No rebuild/use is recorded without a target.
- The hand-off creates a separate `integration` stream with its own review and `wired_<p>` lines that count only
  real steps in the approved target workflows (no kit siblings, docs or notes), plus a `delivered` note: the keys.
- Replaying the new measure on the OpenQodex powers reports `redact` as not wired on current main.
- Every stream: ≥1 green unit run, 2 clean reviews in a row, no open high finding. Run-wide: 2 green /w-bbs e2e
  runs, full `npm test` green, installed copies regenerated.

## You may decide on your own
- Verb names, JSON shapes and file layout within the plan; test names and fixtures (fake transcripts in tests).
- The exact override grammar wording, as long as it stays one question.
- Reading `~/.claude/projects/**/*.jsonl` read-only for counts; never storing message text.

## Ask me before
- Adding a dependency.
- Changing a finish line or the tolerance.
- Making the one verdict question into more than one question.

## Never
- Never push or merge; the PR is the owner's go.
- Never weaken an assertion or skip a test.
- Never wire the 11 OpenQodex verbs into workflows here (the kit-wiring thread owns that) or change a kit verb.
- Never send transcript content anywhere; usage is counts only, no network.

## Budget
- Run token budget: 10,000,000 (expected spend 2–4M: three sequential streams)
- Usage ceiling: 100% of the weekly allowance, checked before every fan-out
- Helper budget: 150,000 (max 200,000)

## Models
- Lead: the session model · scoped builds: haiku · builds: sonnet · hard builds: opus · review: opus · routine: haiku
- Ladder: haiku → sonnet → opus → session. A failed job retries one tier up, never on the same tier.
