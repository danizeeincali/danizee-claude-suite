# Review 581482d9-2a0f-4961-8c19-0acd2866bc6d — change-blast-radius-walk, round 4

- Commit: 1d233ea
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 1 findings

## Medium (1)

- **Untracked file whose name starts with '-' is parsed as a git option and silently dropped from the blast-radius diff** — `.claude/commands/.shortcuts/w-review.md:106` (correctness): The new impact step builds its diff with \`git diff --no-color --no-ext-diff --no-index --no-prefix /dev/null "$f"\` for each untracked file, with no \`--\` before the paths. git parses a top-level untracked name such as \`-x.js\` or \`--output=keep.txt\` as an option: reproduced with git 2.43, it prints the usage text and exits 129, and nothing for that file reaches the temp diff. DF only records a failure of the first \`git diff\`, and the loop's exit status is ignored, so the step runs \`impact\` without that file and exits 0. The file is then missing from \`touched\`, \`unmapped\` and \`partial\`. That breaks the step's promise to report every limit. In this reproduction the option injection only causes the omission (one path remains, so git always stops with a usage error). The same line is mirrored in src/plugins/dot-shortcuts.js (about line 2144). — fix: Put \`--\` before the paths: \`git diff --no-color --no-ext-diff --no-index --no-prefix -- /dev/null "$f"\`. Also treat a status above 1 from that inner diff as DF=1, since 1 only means the files differ.
