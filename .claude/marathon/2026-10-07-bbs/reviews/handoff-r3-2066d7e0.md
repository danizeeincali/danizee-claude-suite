# Review 2066d7e0-ae32-4a36-b65a-2ae8b9b844e3 — handoff, round 3

- Commit: 8775915
- Angle: older environments and degraded networks
- Result: over tolerance
- 5 findings

## Medium (3)

- **From a linked git worktree, init and stream calls hit the main checkout's marathon dir while handoff writes into the worktree's** — `src/lib/bbs/handoff.js:568` (correctness): The bridge runs the marathon CLI with cwd=projectDir and no --project; the CLI maps a linked worktree to the main checkout, so init creates the run there while handoff writes finish-line.json into the worktree's .claude/marathon and fails on a missing kickoff.md; the --force hint fails the same way. — fix: Pass --project \<projectDir\> on every marathonRunner call. Test from a git worktree add checkout.
- **Synchronous execFileSync under the run lock stops the lock refresh, so a slow init or many stream calls make map.lock look stale** — `src/lib/bbs/handoff.js:522` (correctness): execFileSync blocks the event loop so the 20 s refresh cannot fire; N stream calls back to back can exceed the 60 s stale window and a concurrent command takes the lock mid-write. — fix: Run the marathon CLI with promisified execFile (async) so the refresh keeps running, or touch the lock between calls; keep per-call timeouts well below the stale window.
- **A failed or timed-out init leaves ACTIVE moved to a half-made run without restoring it or saying so** — `src/lib/bbs/handoff.js:569` (correctness): marathon init sets ACTIVE before printing JSON; a non-zero exit or a timeout after that throws a bare marathon: \<line\> without restoreActive or naming the run. — fix: In the init catch await restoreActive() and append the 'ACTIVE was restored' text; name the run dir init may have created.

## Low (2)

- **The claimJson fallback without hard links can leave an empty or partial handoff.json** — `src/lib/bbs/handoff.js:401` (correctness): The wx fallback writes directly; a write failure leaves a truncated file that reads as done and refuses later runs. — fix: On a write failure in the fallback branch remove the file this call created before rethrowing.
- **When an older helper's init output is rejected, the error does not name the run dir it left behind** — `src/lib/bbs/handoff.js:579` (docs): checkInit refuses and restores ACTIVE but the seeded run dir stays undiscovered. — fix: Name the likely run dir (or the raw output's runDir/id) and say it may need removing.
