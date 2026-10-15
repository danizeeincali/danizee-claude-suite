# Review 5cf97d51-1475-4847-8994-838680e5f31f — shared-budget-for-claim-sub-sessions, round 5

- Commit: bba263d
- Angle: accessibility
- Result: pass
- 3 findings

## Low (3)

- **shared-budget has no --help; asking for help is an error** — `src/lib/kit/shared-budget.js:286` (accessibility): parse() rejects every flag outside VALUE\_FLAGS, so \`cli.js shared-budget --help\` and \`cli.js shared-budget grant --help\` print 'kit: unknown flag --help' and exit 1. Sibling verbs (caller-floor.js:216/253, diff-range.js:85/204, graph.js:1331) accept --help/-h and return { usage }, and their errors end with '(see --help)'. A user who follows that suite convention gets an error and no per-verb usage. The only way to see the usage is the global \`cli.js help\` dump. The error messages also do not point there. Confirmed by running both commands. Mirrored in .claude/helpers/kit/shared-budget.js. — fix: In parse(), treat --help/-h as a boolean that makes run() return { usage } before the --state check, and add '(see cli.js shared-budget --help)' to the unknown-flag and missing-command errors.
- **Numeric flags reject valid numbers with 'must be a number'** — `src/lib/kit/shared-budget.js:296` (accessibility): num() accepts only /^-?\d+(\.\d+)?$/. \`--cost .5\` prints 'kit: --cost must be a number', and so does \`--steps 1e3\`. Both values are numbers, so the message misleads the user about what went wrong. Confirmed on the CLI. Mirrored in .claude/helpers/kit/shared-budget.js. — fix: Either accept what Number() parses as finite (the later limitOf/nonNeg checks already enforce positive and integer), or reword the error to give the accepted form, e.g. '--cost must be a plain decimal such as 0.5'.
- **Corrupt-state error does not name the file** — `src/lib/kit/shared-budget.js:96` (accessibility): checkState throws 'budget state is corrupt' without the path. The missing-file and invalid-JSON errors in load() (lines 304-305) do include the resolved path. With several jobs' state files, the user cannot tell from the message which file to inspect or delete. Confirmed: \`status --state c.json\` with {"version":2} prints only 'kit: budget state is corrupt'. — fix: In load(), catch the checkState KitExit and rethrow it as \`budget state ${file} is corrupt\`.
