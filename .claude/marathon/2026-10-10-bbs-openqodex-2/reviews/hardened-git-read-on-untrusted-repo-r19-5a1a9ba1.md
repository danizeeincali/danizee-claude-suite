# Review 5a1a9ba1-736b-4301-84ba-703077c54416 — hardened-git-read-on-untrusted-repo, round 19

- Commit: 42a8981
- Angle: accessibility
- Result: pass
- 2 findings

## Low (2)

- **Every input error repeats the full ~600-character usage string on one line** — `src/lib/kit/safe-git.js:1136` (accessibility): run() adds the whole \`usage\` string to the unknown-flag, missing-\`--\`, no-command and reads-stdin errors (lines 1130, 1131, 1134, 1136). On stderr the specific complaint ('cat-file with these options reads stdin: pass --input - before \`--\`') then sits in front of one unbroken ~600-character parenthetical. A screen reader reads all of it, and a narrow terminal wraps it into a block where the actual error is hard to find (reproduced with \`cli.js safe-git -- cat-file --batch\`). The same text is also in .claude/helpers/kit/safe-git.js. — fix: Keep the error to the specific complaint plus a short pointer such as '(see cli.js safe-git --help)', and leave the full usage to --help.
- **The reads-stdin refusal does not name the option that triggered it** — `src/lib/kit/safe-git.js:1136` (accessibility): readsStdin() matches abbreviations (e.g. \`name-rev --an\`, \`cat-file --batch-ch\`, \`show-ref --ex\`), but the error only says '\<subcommand\> with these options reads stdin'. A user who typed an abbreviation, or has several options, cannot tell which argument to change without reading the STDIN\_OPTIONS source. — fix: Have readsStdin return the matching argument (or add a helper that does) and put it in the message, for example "\`--an\` (--annotate-stdin) reads stdin".
