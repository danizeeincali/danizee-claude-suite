# Review ff312adf-11ef-4e55-a4f6-574d0e402f76 — intake, round 2

- Commit: 2b9e184
- Angle: failure conditions and error paths
- Result: over tolerance
- 6 findings

## Medium (3)

- **Concurrent intakes can pick the same run id and overwrite each other's run** — `src/lib/bbs/intake.js:88` (correctness): runIdFor checks existence but the run dir is only created later inside writeJson; nothing claims the id in between. 6 parallel intakes with the same slug: 3 got the same runId, one source.json survived, egress.jsonl collected 4 rows. — fix: Claim the id atomically: fs.mkdir(runDir) without recursive; on EEXIST move to the next -n suffix (for --run, fail). Only then write source.json. Test parallel intakes get distinct ids.
- **source.json is written before the paste and egress row, so an interrupted intake leaves a run that looks complete** — `src/lib/bbs/intake.js:154` (correctness): source.json (fetched:true) is written first; paste.txt is a plain non-atomic write; a later failure leaves a run that nextStep reports as inventory while paste.txt may be missing or truncated and no longer matches the identity. — fix: Write fetched/paste.txt atomically and the egress row first; write source.json last as the commit marker, or remove the run dir on any failure after the claim.
- **A local git repo with no commits cannot be taken in** — `src/lib/bbs/intake.js:120` (correctness): isGitRepo only checks .git exists; \`git rev-parse HEAD\` fails on an unborn HEAD or a missing git binary, intake aborts and git's stderr is printed raw and repeated. — fix: Catch the git failure and fall back to the path+size manifest (or fail with a clear message); use stdio \['ignore','pipe','pipe'\] in defaultGit.

## Low (3)

- **A literal null row in egress.jsonl crashes status and report** — `src/lib/bbs/status.js:60` (correctness): readJsonl keeps any JSON value; a \`null\` line enters state.egress and the bytes\_in reduce dereferences it. lookupSource has the same unguarded access. Corrupt rows are dropped silently. — fix: readJsonl keeps only plain-object rows and counts the rest as corrupt; show the corrupt-row count in status.
- **status.md is written non-atomically and status fails outright on a read-only run dir** — `src/lib/bbs/status.js:110` (correctness): renderStatusFile uses a plain writeFile; on EACCES the read-only status verb exits 1 without printing the markdown it already rendered. — fix: Write status.md via the tmp+rename helper; in the status verb print the markdown even when the write fails and warn on stderr.
- **Project root silently falls back to cwd when git is missing or fails** — `src/lib/bbs/cli.js:66` (other): If git is missing, resolveProjectDir uses cwd; from a subdirectory a second .claude/bbs tree is created and later status calls from the root cannot find the run. — fix: Walk up from cwd looking for .git or .claude when git is unavailable, or warn on stderr and point to --project.
