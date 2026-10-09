# Review 040191f3-c09f-47ef-a2a0-c94809e95ab8 — command-docs, round 3

- Commit: 4e8fea5
- Angle: older environments and degraded networks
- Result: pass
- 3 findings

## Medium (1)

- **CHECKPOINT 1 runs fetch with no Bash timeout, but a repo clone may legitimately take up to 300 s** — `.claude/commands/.shortcuts/w-bbs.md:83` (correctness): The Bash tool's default 120 s limit kills a slow clone before cleanup, leaving fetched/ and the tmp HOME behind and no git egress row; neither exit branch in CHECKPOINT 1 covers a killed process. — fix: Tell the lead to run fetch with a Bash timeout above the clone allowance (600000 ms) and add a branch for a killed fetch: remove the fetched/ dir named in the error and rerun with --run \<id\>, or stop with the resume line.

## Low (2)

- **Sandbox sentence implies an installed docker or unshare binary is enough** — `README.md:240` (docs): docker counts only when a local daemon answers docker info within 5 s; unshare only on Linux with user namespaces; a remote DOCKER\_HOST never counts. — fix: Reword to state those conditions.
- **The 'manifest is written before the marathon modules' test does not test the order** — `test/bbs-plugin.test.js:245` (test-quality): A full uninterrupted install checks only the final manifest; it passes if the manifest were written last. — fix: Make one marathon module write fail (dest as a directory) and assert the manifest already lists all planned modules.
