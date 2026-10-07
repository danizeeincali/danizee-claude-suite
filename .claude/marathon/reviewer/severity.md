# Severity definitions

Grade every finding with exactly one of these. Neither inflate nor deflate: a finding that
does not meet the bar for `high` is `medium`, and one that does not meet `medium` is `low`.
Without definitions every finding reads as serious, and the gate loops forever.

## high

The change is wrong or unsafe in a way a user or operator will hit:

- data loss, data corruption, or a wrong result on a normal input
- a security boundary crossed: secrets exposed, egress to an unexpected host, a sandbox
  escape, an injection, an auth or permission check missing
- a crash, hang or unrecoverable state on a realistic path
- a weakened or deleted assertion that hides any of the above
- a claimed finish-line check that is not actually enforced

## medium

The change works on the happy path but is wrong somewhere real:

- an error path, edge case or concurrency case handled incorrectly
- a regression in behaviour that existing users rely on
- an accessibility failure that blocks a task (focus trap, unlabeled control, no keyboard path)
- a measurable performance problem on expected data sizes
- a fact or copy error that misleads the reader
- a missing test for a behaviour the spec names

## low

Worth fixing, does not change what the code does for anyone:

- naming, comments, dead code, duplicated logic, style
- a log message or error text that could be clearer
- a test that passes but asserts less than it could
- documentation drift that does not mislead

## Not a finding

- A matter of taste with no spec or rule behind it.
- Anything already covered by a promotion (a test, scan, fixture or rule) — check
  `store/promotions.jsonl` before reporting it again.
