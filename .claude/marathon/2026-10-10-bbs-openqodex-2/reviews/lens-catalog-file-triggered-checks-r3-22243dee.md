# Review 22243dee-1ea1-4dbb-8896-f9fba0938d27 — lens-catalog-file-triggered-checks, round 3

- Commit: 4ee2094
- Angle: older environments and degraded networks
- Result: pass
- 1 findings

## Medium (1)

- **Trailing \`; rm -f "$D"\` masks the lens verb's non-zero exit** — `.claude/commands/.shortcuts/w-review.md:87` (correctness): The new snippet runs \`node .claude/helpers/kit/cli.js lenses --diff "$D"; rm -f "$D"\`, so the block's exit status is rm's (0), never node's. The very next paragraph tells the agent that an empty/non-diff input exits 1 and that 'A non-zero exit means a lens file is broken: report it, do not skip the step'. Traced: with an empty $D (empty range, or mktemp failing on a read-only/full /tmp in an older or constrained environment so \`\> ""\` fails and --diff "" resolves to the cwd), the CLI prints 'kit: no diff was given ...' to stderr and the Bash tool reports exit=0. Same for a broken lens file. The agent's exit-code-based check is silently defeated; the stderr text also names a temp path that has already been deleted. The same text is in src/plugins/dot-shortcuts.js:2125 and test/w-review-command.test.js:53 asserts this exact masking form. — fix: Preserve the status: \`node .claude/helpers/kit/cli.js lenses --diff "$D"; s=$?; rm -f "$D"; (exit $s)\` (or a \`trap 'rm -f "$D"' EXIT\` before running node), mirror it in dot-shortcuts.js, and update the w-review-command test regex to require the preserved status.
