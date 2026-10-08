# Review 2dd0287e-30b6-4c96-bb5d-a38e4f82ced5 — handoff, round 2

- Commit: 0de3813
- Angle: failure conditions and error paths
- Result: over tolerance
- 4 findings

## Medium (4)

- **Failures after init has moved ACTIVE but before the guarded block do not say so, and a corrupt finish-line.json also blocks --force** — `src/lib/bbs/handoff.js:494` (correctness): Non-JSON init output, a checkInit refusal or a corrupt finish-line.json/streams.json read throw a bare error while ACTIVE points at the new run; under --force a corrupt old finish-line.json is read before force is checked, so the suggested recovery fails every time. — fix: Put everything after a successful init inside the same recovery wrapper (or restore prevActive before rethrowing); under force treat an unparseable old finish-line.json/streams.json as 'holds' and overwrite. Tests for non-JSON init output and a corrupt finish-line.json.
- **--force refill leaves stale queued stream rows (and briefs) for powers that are no longer rebuild/use** — `src/lib/bbs/handoff.js:533` (correctness): Rows are only upserted for current powers; a power now skip/buy keeps its queued row pointing at an old brief; with zero approved powers on refill the old marathon run is never touched while handoff.json says marathonRun null. — fix: On a forced refill mark every stream row not in the new set blocked with a reason (the marathon CLI has no remove verb), delete stale briefs/memos, and when approved is empty name/clear the previously recorded marathon run. Test: first hand-off two rebuild powers, forced one has one.
- **A tolerance the marathon gate accepts (null = unlimited) is refused with a wrong message** — `src/lib/bbs/handoff.js:62` (correctness): validateTolerance allows null for high/medium/low; buildFinishLine insists on numbers and tells the user to change a valid config. — fix: Accept null or a non-negative integer for high/medium/low; require only passes\_in\_a\_row. Test with a null limit in the example file.
- **Check-then-write on handoff.json with no lock: concurrent handoff, or handoff during verdict --from, can produce a stale or interleaved hand-off** — `src/lib/bbs/handoff.js:393` (correctness): The stat and the final write are separated by every brief write and the marathon calls; handoff reads verdicts.json without the lock recordDecisions holds. — fix: Run buildHandoff inside withMapLockDetailed (the run lock verdict uses) and re-check verdicts/powers\_ts inside it; claim handoff.json exclusively at the end.
