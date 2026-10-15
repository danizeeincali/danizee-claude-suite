# Review fe230e47-568b-436c-a166-063addfc5290 — exit-code-contract-separating-infrastruc, round 10

- Commit: 7295632
- Angle: older environments and degraded networks
- Result: pass
- 1 findings

## Medium (1)

- **A large partial-clone scrub result (the degraded-network case) is classified as a blocking regression** — `src/lib/kit/exit-codes.js:110` (correctness): scrub's not\_scanned list has no cap (scrub.js:335 adds one entry per missing object), and cli.js prints it pretty-printed at about 160 bytes per entry. A zero-hit scrub in a sparse or partial clone with the remote unreachable and about 6,600 or more missing files therefore prints more than MAX\_RESULT\_BYTES (1 MiB). The header names this exact case as infrastructure that never blocks. This diff now treats an oversized result at exit 2 as 'Fail closed ... the judge crashed or refused' and returns blocks: true (judgeResult line 110, readResult lines 156/163). Confirmed: a 1.1 MB scrub result with 7,000 entries, all reading 'object not available locally (partial clone?)', with hit\_count 0 and exit 2, gives \`exit-codes classify --code 2 --verb scrub --result big.json\` -\> class regression, blocks true. The same result with 6,000 entries -\> infrastructure. The library is inconsistent with itself: classify({code:2,verb:'scrub',result:obj}) returns infrastructure, but blocksMerge(2,'scrub',null,\<the same text\>) returns true. So a monorepo whose network is degraded gets a false red gate. The description also misleads: the judge did not crash, and 'rerun it' will not help. — fix: Cap scrub's not\_scanned output (keep a count plus the first N entries and a flag saying whether every reason is an environment reason) so a judge's own result always fits under the cap. Alternatively, raise or remove the size cap for a file --result, and make the string and object library paths apply the same rule. Add a test with a zero-hit partial-clone result larger than 1 MiB.
