# Review e152092e-e278-4f1f-babc-8847a8b27431 — verdict, round 2

- Commit: e910330
- Angle: failure conditions and error paths
- Result: over tolerance
- 7 findings

## Medium (3)

- **A decision cleared after the registry row and labels were written leaves them claiming the cleared verdict** — `src/lib/bbs/verdict.js:405` (correctness): probe --force found/incomplete or a recompute after the sandbox disappears nulls the decision in verdicts.json only; registry.jsonl latest row still says use and labels.jsonl keeps label 1. — fix: When a decision with a label/registry row behind it is cleared, append a superseding registry row and a withdrawal label row. Test: decide all, re-probe found --force, lookupSource no longer returns use.
- **If the registry or labels append fails after commit, there is no clean way to retry** — `src/lib/bbs/verdict.js:463` (correctness): A failed appendRegistry/labels append is only a warning; resubmitting is refused with already decided; --force duplicates labels and appends another registry row; the warning names no repair command. — fix: Make the repair idempotent: resubmitted identical decisions skip the refusal and append only missing label/registry rows; name the repair command in the warning. Tests for each append throwing then a retry.
- **inventory --force does not take map.lock, so a running probe or decision can write a stale verdicts.json back** — `src/lib/bbs/verdict.js:449` (correctness): writeInventory --force moves verdicts.json aside without the lock; a concurrent recordDecisions writes the old rows back beside the new powers.json. — fix: writeInventory --force takes withMapLockDetailed around the stale move and the powers.json write; or store powers.json ts/identity in verdicts.json and refuse a mismatched write.

## Low (4)

- **Wrong advice and counts when verdicts.json is corrupt or unreadable** — `src/lib/bbs/verdict.js:336` (facts): The --force hint is appended to every read failure including EACCES; --force overwrites a corrupt file instead of moving it aside; dropped reports 0 although unknown. — fix: Hint only for corrupt JSON; move the corrupt file aside; report dropped as unknown.
- **docker stderr goes into the stored and printed reason with no length cap or control-character stripping** — `src/lib/bbs/verdict.js:151` (security): firstLine(docker.stderr) is stored verbatim in sandbox.reason and repeated in rows and the table; stdout is piped and never read. — fix: Strip control chars and cap at ~200 chars; spawn with stdio ignore/ignore/pipe.
- **The unshare failure reason does not say why** — `src/lib/bbs/verdict.js:159` (other): ENOENT, EPERM and timeout all collapse to unshare is unavailable. — fix: Build the reason from code/status/first stderr line like dockerWhy.
- **A power listed twice in the decisions input is silently resolved to the last value** — `src/lib/bbs/verdict.js:422` (correctness): JSON.parse keeps the last duplicate key with no warning. — fix: Detect duplicate top-level keys and refuse naming the power.
