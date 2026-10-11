# Review 7e5170cf-ea5c-46cb-8b33-4150f83a631a — bbs, round 6

- Commit: 6d3bc53
- Angle: facts and content
- Result: pass
- 2 findings

## Medium (1)

- **SAFE\_GIT\_LINES tells the inventory helper to 'return \`incomplete\`', but the inventory JSON shape has no such value** — `src/lib/bbs/inventory.js:494` (facts): SAFE\_GIT\_LINES is printed only in the inventory helper brief (repo sources). Round 5 added: 'Exit 3 is handled one way: a timeout, overflow or kill ... returns \`incomplete\`; ... only a second failure on a correct call returns \`incomplete\`.' \`clean|found|incomplete\` is the CP4 probe helper's verdict. The inventory helper returns \`{ powers: \[...\] }\` or \`{ powers: \[\], none\_found }\`. In a scratch run, \`inventory --from\` rejected \`{"incomplete":"..."}\` with exit 1 ('input must have a "powers" field'), and \`{"powers":\[\],"incomplete":"x"}\` with exit 1. An inventory helper that follows its brief on a safe-git timeout returns a shape the CLI refuses, or drops the source's powers without saying why. The same sentence is pinned for SAFE\_GIT\_LINES by the r5 test (the \`for (const t of \[s, g\])\` loop), and .claude/helpers/bbs/inventory.js carries the same text. — fix: In SAFE\_GIT\_LINES, replace 'returns \`incomplete\`' with an instruction the inventory schema can carry, e.g. 'stop reading that file and name the failed read (the kit: line) in the evidence of the affected power, or in none\_found'. Keep the \`incomplete\` wording in CP4 only, and split the test so SAFE\_GIT\_LINES asserts the inventory-shaped instruction.

## Low (1)

- **Brief says the Clone top it prints is \`.claude/bbs/runs/\<run-id\>/fetched/repo\`, but it prints an absolute path, and its file list is prefixed \`repo/\`** — `src/lib/bbs/inventory.js:494` (docs): resolveProjectDir returns an absolute path, so the real brief prints 'Root: /abs/.../fetched' and 'Clone top (for safe-git --dir): /abs/.../fetched/repo'. SAFE\_GIT\_LINES, CP2 and CP4 call it the relative \`.claude/bbs/runs/\<run-id\>/fetched/repo\`. The 'Files in this source' list names files relative to Root (\`repo/a.js\`), while git args must be relative to the clone top. A helper that copies a listed path (\`show HEAD:repo/a.js\`) gets exit 3 with 'path does not exist', and nothing tells it to drop the \`repo/\` prefix. Both forms of --dir work, so this misleads mildly; the r5 test only covers a relative root. — fix: Say 'the Clone top line (the absolute path of .claude/bbs/runs/\<run-id\>/fetched/repo)', and add to SAFE\_GIT\_LINES: 'listed files start with \`repo/\`; drop that prefix in git args'.
