# Review 38d43fa9-7341-4c7b-be23-6f85eade47fd — unslop-triage-and-refine-only-gate, round 2

- Commit: d63bbeb
- Angle: failure conditions and error paths
- Result: pass
- 2 findings

## Low (2)

- **A failed revoke exits 1 with a generic write error and leaves any earlier confirmation in force, undocumented and untested** — `src/lib/kit/slop-triage.js:287` (correctness): When writeState fails for "Change the direction" (for example a missing parent dir, which a probe confirmed: \`cannot write .../nope/s.json: ENOENT\`, exit 1), the user's 'no' becomes exit 1, not the documented exit 2, and the message does not say the revoke failed. If an earlier confirmed record exists and the write fails (read-only dir, EISDIR), gate keeps exiting 0 with confirmed:true, and nothing in the output says so. The exit is still nonzero, so a careful caller stops, but the header (lines 16-17) promises exit 2 and says the confirmation is revoked. No test covers the revoke-failure path; the unwritable-path test only exercises the Go choice. — fix: In the Change-the-direction branch, catch the write failure and rethrow KitExit(1) with text like 'could not revoke: \<code\>; an earlier confirmation in \<path\>, if any, still stands'. Note it in the header and add a test with a missing parent dir.
- **writeState cleanup deletes a temp file it did not create when wx fails with EEXIST** — `src/lib/kit/slop-triage.js:304` (correctness): The temp name is target.pid.Date.now().tmp. Two in-process confirm calls for the same target in the same millisecond (library use of run()) collide. The second call's writeFile with flag wx fails EEXIST, and its catch then runs fs.rm(tmp, {force:true}) on the first call's temp file, so the first call's rename fails ENOENT. Both calls report 'cannot write', and the record that should have landed is lost. Separate CLI processes are not affected, because their pids differ. — fix: Only rm the temp file when writeFile succeeded (track a \`created\` flag), or add a random suffix (crypto.randomUUID()) to the temp name.
