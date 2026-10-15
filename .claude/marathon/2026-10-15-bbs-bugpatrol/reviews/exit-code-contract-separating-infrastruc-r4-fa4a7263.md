# Review fa4a7263-d5e7-46b1-82e4-55ad26d6d572 — exit-code-contract-separating-infrastruc, round 4

- Commit: 7b20e3e
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: over tolerance
- 2 findings

## High (1)

- **--result turns scrub's fail-closed incomplete scan into a non-blocking pass, so an oversized file can carry a secret through the gate** — `src/lib/kit/exit-codes.js:87` (security): incompleteNoHits treats ANY scrub result with hit\_count 0 and a non-empty not\_scanned (or complete false) as 'could not judge' infrastructure, whatever the not\_scanned reason. scrub lists product content there too: a file larger than --max-file-bytes (default 32 MiB), everything past the 2 GiB total, and a tracked path that is not a regular file in --worktree mode. scrub exits 2 on these precisely to fail closed, because the unscanned bytes may hold a secret. Confirmed: a repo whose creds.txt holds AKIAABCDEFGHIJKLMNOP plus padding, with pattern AKIA\[0-9A-Z\]{16}; \`scrub --max-file-bytes 100\` exits 2 with hit\_count 0 and not\_scanned \[{creds.txt, 'larger than 100 bytes'}\]; \`exit-codes blocks 2 --verb scrub --result out.json\` returns class infrastructure, blocks false. The same file scanned in full is a hit (regression). With the default cap, padding a secret-bearing file past 32 MiB does the same, and push-gate takes the same path via line 97 (scrub.ran true, hit\_count 0, incomplete). A PR author controls file size, so CI wired to --result lets a secret through. The r3 fix only needed the partial-clone / unreachable-remote case. — fix: Only reclassify when every not\_scanned entry has an environment reason (e.g. 'object not available locally (partial clone?)'); keep 'larger than N bytes', 'total size limit reached', 'not a regular file on disk' and any unknown reason as a blocking regression. Add tests for an oversized-file result for scrub and push-gate that assert blocks true.

## Low (1)

- **Packaged push-gate test never checks the egress log** — `test/kit-exit-code-contract-separating-infrastruc-packaged.test.js:53` (test-quality): Only the first packaged test asserts pkg.egress() is empty (line 32). The second test runs a real push-gate check plus four exit-codes calls under the no-egress preload, and never reads the log. The preload refuses network attempts by throwing, and push-gate turns a thrown error into 'could not run' with exit 2 and scrub.ran false, which is exactly what this test expects. So an egress attempt in that path would be refused, hidden by the expected outcome, and pass, which weakens the egress\_zero finish line for this check. A manual probe found no egress today. — fix: Add assert.deepEqual(pkg.egress(), \[\]) at the end of the second packaged test.
