# Review 52937df1-7784-4109-acc1-f30cc9818e96 — finding-triage-with-fingerprint-dedup-an, round 1

- Commit: 6707b32
- Angle: one input method at a time
- Result: over tolerance
- 3 findings

## High (1)

- **A record whose element still fires is closed as fixed when a candidate overlaps two live records** — `src/lib/kit/triage.js:266` (correctness): visit() matches each candidate to only ONE record (the best overlap, lines 221-229) and adds only that record to \`touched\`. Any other live record of the same scope+rule that shares members with the candidate is not touched, so the absence loop (line 266) counts it absent even though its members fired. Confirmed: visit s1 \[a\] -\> R1{a}; s2 \[b\] -\> R2{b}; then s3, s4, s5 each see \[a,b\]: R1 is raised as pending each time and R2 is closed as fixed in s5 with absent\_visits 3, while element b fired in every one of those visits. If R2 was filed, \`closed\` tells the caller to close a tracker issue that is still occurring. This contradicts the header's rule that a record is absent only when none of its members fired. — fix: Mark every record of the same scope+rule that overlaps the candidate's sigs as touched (reset absent\_visits) or merge them into the chosen record, not just the best match; add a test with two disjoint records later seen together.

## Medium (1)

- **A reopened filed issue loses its decision and is raised again every visit without its issue ref** — `src/lib/kit/triage.js:241` (correctness): When a fixed record is sighted again, line 241 sets status to 'new'. The reopened raise carries the old issue ref once, but from the next sighting on the record is a plain 'pending' raise with no \`issue\` field (line 256 only adds it for status 'reopened'), and recurred/occurrence counting for the issue stops. Confirmed: filed GH-1, closed by absence, s5 sighting gives reopened+GH-1, s6 sighting gives status pending with no issue. A caller that syncs \`raise\` to its tracker will open a duplicate issue for a fingerprint the ledger already filed, which the idea says must not be raised again. — fix: On reopen of a record that has an issue, keep status 'filed' (report it once as reopened) so later sightings go to \`recurred\` with the issue ref; or always include rec.issue in raise rows.

## Low (1)

- **Visit JSON with a UTF-8 BOM is rejected as not valid JSON on both --in and stdin** — `src/lib/kit/triage.js:325` (correctness): readInput passes the raw text to JSON.parse, so a file or pipe starting with a UTF-8 BOM (common from Windows editors and PowerShell) fails with 'visit input is not valid JSON' and exit 1, a misleading error for valid JSON. Confirmed with both \`--in bom.json\` and piped stdin. loadState (line 135) has the same issue for the state file. — fix: Strip a leading \uFEFF before JSON.parse in readInput and loadState.
