# Review 2a957315-e5e6-4cab-8662-aae810b7e09b — exit-code-contract-separating-infrastruc, round 3

- Commit: 57e08b0
- Angle: older environments and degraded networks
- Result: pass
- 2 findings

## Medium (1)

- **Product judges' exit 2 on an offline partial clone or a git timeout is classified as a blocking regression** — `src/lib/kit/exit-codes.js:43` (correctness): PRODUCT\_JUDGES makes every exit 2 from push-gate and scrub a blocking regression, but both verbs also exit 2 when nothing about the product was judged. Confirmed: in a --filter=blob:none clone whose remote is unreachable, \`cli.js scrub\` exits 2 with hit\_count 0 and not\_scanned 'object not available locally (partial clone?)'. Also, \`cli.js push-gate check --timeout 1\` exits 2 with decision deny, reason 'the scrub check is configured but could not run: git config took longer than 1 ms', scrub.ran false (push-gate.js:261-262,282). In both cases \`exit-codes blocks 2 --verb scrub|push-gate\` returns class regression, blocks true, with the description 'a verb that judges the product ran and said no'. A missing network or a slow git, which the contract itself names as infrastructure (timeout, git failure), turns the gate red: the false red the idea says must never happen. Failing closed for the push is fine, but CI is told the product regressed. — fix: Let a judge's exit 2 be told apart: have scrub/push-gate return a distinct status (4 or 5) or a machine field for 'could not run' and an incomplete scan with zero hits, and override those in VERB\_OVERRIDES. Or document and test that only a verdict with hits or a review deny is regression. Add tests for the partial-clone and timeout paths.

## Low (1)

- **Status 124 (timeout(1) killed the tool) is reported as unknown, not infrastructure** — `src/lib/kit/exit-codes.js:45` (facts): The new shell\_statuses table maps 126/127 but leaves out 124, which GNU coreutils \`timeout\` returns when it stops a command, the usual way CI caps a hung step on a slow runner or network. Confirmed: \`exit-codes classify --code 124\` returns class unknown, known false, 'not in the contract'. The contract lists a timeout as infrastructure, yet the most common timeout status gets no classification. It does not block, but CI cannot tell a timed-out tool apart from an unclassified failure. — fix: Add 124 to SHELL as infrastructure, with a description saying timeout(1) stopped the command, and a test.
