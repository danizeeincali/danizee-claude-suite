# Review 76e67b7b-07b0-4bcb-8426-8b03e7f075ba — exit-code-contract-separating-infrastruc, round 1

- Commit: 4dbe3b4
- Angle: one input method at a time
- Result: pass
- 3 findings

## Medium (2)

- **Tool-limit refusals (exit 2) are classified as a blocking regression** — `src/lib/kit/exit-codes.js:30` (correctness): Status 2 maps to \`regression\` (blocks: true) for every verb with no per-verb override. But existing verbs use exit 2 for tool or environment refusals that say nothing about the product: diff-range exits 2 when the review range is over 32 MiB (diff-range.js:340) or the repo config has an include.path (diff-range.js:215), and safe-git exits 2 for every refused argument (safe-git.js:171). Confirmed: \`cli.js exit-codes blocks 2 --verb safe-git\` and \`describe 2 --verb diff-range\` both return class regression, blocks true, so a large PR or a refused git option turns the gate red. That is the false red the idea says must never happen. The test at test/kit-exit-code-contract-separating-infrastruc.test.js (\`classify({ code: 2, verb: 'safe-git' }).class === 'regression'\`) locks this in. — fix: Add overrides for diff-range 2 and safe-git 2 that map to a non-blocking class (usage or precondition), so only verbs whose 2 means a product verdict (e.g. push-gate) block; or make blocking opt-in per verb, and test it.
- **Contract says timeouts and crashes are infrastructure, but they actually exit 1 and are classified as usage** — `src/lib/kit/exit-codes.js:32` (facts): The infrastructure class claims to cover 'timeout, crash, signal, git failure', but nothing in the kit produces 5 for those. cli.js returns 1 for any non-KitExit error (a crash), Node's own uncaught exception exits 1, and diff-range exits 1 when a git child times out or git fails (diff-range.js:9,27,33). So \`exit-codes describe 1 --verb diff-range\` reports class usage with 'Invalid input ... Fix the caller.' for what is a git timeout. A CI that follows this contract tells people to fix their call when the tool itself failed. That is a wrong classification for a case the contract names. — fix: Either describe 1 as 'usage or tool failure (not separable yet)', or add a diff-range 1 override and note that crashes surface as 1 until cli.js maps non-KitExit errors to 5. Add a test for the diff-range timeout path.

## Low (1)

- **\`--flag=value\` form is refused, unlike sibling verbs** — `src/lib/kit/exit-codes.js:86` (correctness): diff-range (diff-range.js:95), safe-git and scrub accept \`--name=value\`, but exit-codes only accepts \`--verb v\`: \`cli.js exit-codes describe 2 --verb=safe-git\` exits 1 with 'unknown option --verb=safe-git'. A CI step written in the style the other verbs accept fails loudly instead of classifying. \`describe --help\` is also refused as an unknown option. — fix: In parse, split an \`--name=value\` argument at the first '=' and handle it like the two-argument form; add a test.
