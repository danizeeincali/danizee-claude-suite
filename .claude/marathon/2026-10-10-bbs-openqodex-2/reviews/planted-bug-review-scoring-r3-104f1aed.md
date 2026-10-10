# Review 104f1aed-e5ed-427b-a782-dde2aaa9dc5a — planted-bug-review-scoring, round 3

- Commit: 757c36a
- Angle: older environments and degraded networks
- Result: pass
- 2 findings

## Low (2)

- **Fixture-leak test passes vacuously on Node 20.0** — `test/kit-planted-bug-review-scoring.test.js:202` (test-quality): package.json allows node \>=20.0.0, but fs.readdir's \`recursive\` option only exists from Node 20.1.0 (and 18.17). On 20.0.x the option is ignored, readdir returns just the case folders (cache-leak, pager-off-by-one, tidy-clean), each is skipped by the isFile() check, and the test asserts nothing while still passing, so a fixture source that names its planted bug would go unnoticed on a supported runtime. — fix: Walk the folders with a small recursive helper (readdir withFileTypes plus recursion), or assert that at least one file was checked so a silent no-op fails.
- **Step 4.5a is labelled offline but spawns model reviewers** — `.claude/commands/.shortcuts/w-marathon.md:170` (docs): The heading says '(optional, offline, ...)' and the step closes with 'reads saved files only and makes no network call', but the step itself spawns one opus reviewer per fixture, and those are model API calls. Only the review-score command is offline. With a degraded or no network an operator reading the heading would expect the step to work, and it cannot. The same text is mirrored in src/plugins/dot-shortcuts.js:3931. — fix: Drop 'offline' from the heading and say that only the review-score scoring command runs offline. The reviewer spawns need the model API.
