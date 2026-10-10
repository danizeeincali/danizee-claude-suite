# Review 726f28eb-9460-4591-a041-070db4aeb11d — identity-checked-file-writes, round 3

- Commit: 0017647
- Angle: older environments and degraded networks
- Result: pass
- 1 findings

## Medium (1)

- **push-gate check now fails (exit 1) on a read-only or not-yet-created store location instead of answering** — `src/lib/kit/push-gate.js:176` (correctness): storeFile() now runs fs.mkdir(parent, { recursive: true }) for every command, including the read-only \`check\`. When the store's parent does not exist and cannot be created (read-only HOME, a sandboxed or ro-mounted home, or a KIT\_RECEIPTS\_DIR pointing into a ro mount that does not exist yet), \`check\` throws KitExit 1 "cannot open the receipt store folder ..." instead of returning a decision. Reproduced: with HOME on a read-only tmpfs, the base commit (663025a) prints {decision: "ask", reason: "no review recorded ..."} with exit 0, while HEAD exits 1 with "cannot open the receipt store folder .../.claude/kit: ENOENT ... mkdir". It also means \`check\` now creates ~/.claude/kit as a side effect on every first run. The same code is in .claude/helpers/kit/push-gate.js:176. No test covers check against a missing or unwritable store location. — fix: Only create the parent for \`receipt\` (pass a create flag to storeFile from run()); for \`check\`, if the parent does not exist, return null state (no receipt) without creating anything, e.g. realpath the deepest existing ancestor or treat ENOENT/EROFS from mkdir as 'no store yet'. Add a test that runs check with a HOME whose store parent is missing and cannot be created.
