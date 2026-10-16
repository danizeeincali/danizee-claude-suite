# Review 23e6278e-31d3-4bae-8ebb-a955fe7986b3 — noise-ledger-with-flake-quarantine, round 4

- Commit: 6ffb2c2
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 1 findings

## Medium (1)

- **Stale-lock break can still remove a fresh lock, so two runs hold it and an accept is lost** — `src/lib/kit/noise-ledger.js:258` (correctness): withLock decides the lock is stale from fs.stat (line 258) and only afterwards reads its token (readToken), which it passes to breakStale as 'seen'. If another waiter breaks the dead lock and creates its own fresh lock between that stat and that read, this waiter reads the new holder's token. breakStale then re-reads the same token, finds it unchanged (line 240) and deletes the live lock. Both runs then do the read-modify-write and the last rename wins. Every run still reports success. The token check proves only that the content did not change between the two reads. It does not prove that the lock read is the stale one. Checked: with a pre-aged ledger.json.lock and 8 parallel accepts, plus 0-15 ms of latency added after fs.stat (as on a slow or network filesystem or a loaded CI host), 2 of 30 trials ended with 7 entries after 8 successful runs. Without the added latency, 0 of 300 trials failed, so the existing tests do not catch it. The same code is mirrored in .claude/helpers/kit/noise-ledger.js. This is the round 3 finding, narrowed but not closed. — fix: After taking \<lock\>.break in breakStale, stat the lock again and remove it only if it is still older than LOCK\_STALE\_MS and still holds the token 'seen'. The holder's heartbeat and a just-created lock both make it fresh. Add a test that injects a delay after stat, for example by wrapping fs.stat, and expects every entry kept.
