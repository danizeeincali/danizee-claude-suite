# Review 19af5b0b-aada-441c-8c27-78c8bccddff0 — harness-map, round 2

- Commit: 13c0586
- Angle: failure conditions and error paths
- Result: over tolerance
- 6 findings

## Medium (3)

- **A failure after map.json is committed fails the verb (buildMap and recordJudgments)** — `src/lib/bbs/harness-map.js:381` (correctness): renderStatusSafe calls loadState outside its try; a corrupt verdicts.json/handoff.json or EACCES on egress.jsonl throws after map.json is written; a retry of recordJudgments is refused with already judged. Same commit-then-fail pattern fixed in writeInventory. — fix: After the map.json write, wrap renderStatusSafe in try/catch in both functions and the CLI finally; return a warning naming the unreadable file, exit 0. Test with a corrupt verdicts.json.
- **A corrupt map.json cannot be rebuilt even with --force** — `src/lib/bbs/harness-map.js:339` (correctness): readJson(mapPath) runs before the force check and throws on corrupt JSON. — fix: With --force, catch the corrupt-JSON error, count 0 judgments dropped, move the corrupt map.json aside; without --force keep the error and say --force will rebuild. Test with a truncated map.json.
- **Check-then-write gap: a concurrent map and map --from can silently drop judgments or overwrite a rebuilt map** — `src/lib/bbs/harness-map.js:340` (correctness): buildMap checks judgments, builds the index slowly, then overwrites map.json; recordJudgments reads, validates, writes back. Either can lose the other's write. — fix: Compare-and-swap on map.json ts just before the final write, or hold an exclusive map.lock ('wx') around the read-modify-write in both functions.

## Low (3)

- **Status is rendered twice and a write failure is reported twice** — `src/lib/bbs/cli.js:259` (other): The library renders and returns a warning; the CLI finally renders again and warns on stderr. — fix: Render in the finally only on the error path, or drop it from the library.
- **The per-kind cap records the limit, not how many files were left out** — `src/lib/bbs/harness-map.js:175` (correctness): capped.command is 2000 with nothing saying how many were dropped; the kept rows are not the lexicographically first. — fix: Keep counting after the cap and record capped\[kind\] = {kept, total}.
- **A power named "judgments" is mistaken for the wrapper object** — `src/lib/bbs/harness-map.js:490` (correctness): parsed?.judgments ?? parsed treats any top-level judgments key as the wrapper. — fix: Unwrap only when judgments is the sole key, a plain object, and not a power name.
