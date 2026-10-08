# Review 033d7104-b64c-44cc-9801-fc1aaba6188a — harness-map, round 1

- Commit: 72963af
- Angle: one input method at a time
- Result: over tolerance
- 11 findings

## High (1)

- **Power name tokens weigh 9×, not 3×: tripled in the token list and then given a ×3 boost** — `src/lib/bbs/harness-map.js:293` (correctness): matchPower adds tokenize(name) three times AND passes boost 3 for name tokens, so the name weighs 9× and body occurrences of name tokens are tripled too; on this repo's harness the stored top-5 differs from the spec formula for 4 of 4 sample powers. — fix: Weight the name 3× in one place only (single copy with boost 3). Pin a numeric score against the formula with a name-only vs body-only candidate pair at a 3:1 ratio.

## Medium (4)

- **A bare-string judgment of 'have' or 'partial' is recorded with tool null and skips the candidate check** — `src/lib/bbs/harness-map.js:522` (correctness): The string form sets tool null and bypasses the tool and candidate checks; a 'have' nobody can check makes defaultVerdict skip. The contract test at line 214 enshrines a bare 'partial'. — fix: Accept the bare string only for missing; refuse bare have/partial with a message naming {status, tool, why}. Change the line-214 test to the object form and add a test that a bare have is refused.
- **Fenced JSON with a trailing newline, CRLF or leading whitespace is rejected as 'JSON only'** — `src/lib/bbs/harness-map.js:496` (correctness): Fences are stripped only by a strict prefix/suffix; a file ending in \`\`\`\n or a CRLF fence fails. Inventory r1 fixed this exact pattern. — fix: Share inventory's fence/JSON parser (export it) and reuse it. Tests for trailing newline, CRLF and \`\`\`JSON.
- **map --force drops judgments but leaves verdicts.json and handoff.json built on them** — `src/lib/bbs/harness-map.js:385` (correctness): After re-judging, nextStep finds old decisions and moves to handoff or done; inventory has STALE\_ON\_FORCE, map has no equivalent; recordJudgments --force has the same gap. — fix: Under --force move verdicts.json and handoff.json aside as \*.stale-\<ts\>.json (share inventory's helper) and report stale\_moved. Test: map, judge, write verdicts.json, map --force, judge → next verdict.
- **Tests miss input shapes the contract names, and the name-×3 test passes with the boost deleted** — `test/bbs-harness-map.test.js:157` (test-quality): The ×3 test uses what:'x' idea:'y' which tokenize to nothing, so the ranking is the same at 1×, 3× or 9×; untested: --from \<file\>, fenced/CRLF judgments, map --force CLI, bare have, symlinks under index roots, --force with --brief. — fix: A test where name and body compete with a pinned score; CLI cases for --from \<file\>, a fenced file with trailing newline, map --force after judgments, a symlinked command file.

## Low (6)

- **The map --from parse error does not name its input and echoes raw control bytes** — `src/lib/bbs/harness-map.js:501` (facts): Same message for stdin and file; raw CR/LF printed. — fix: Pass a label from the CLI and JSON.stringify the preview (shared parser).
- **The brief says 'Only these 5 candidates' even when a power has fewer or none** — `src/lib/bbs/harness-map.js:435` (facts): matchPower returns \[\] for no shared tokens; the brief still says 5 and does not say missing is the only valid answer. — fix: Print the real count; when 0 print 'no candidates — answer missing'.
- **Index globs are wider than the spec: nested skills, nested hooks, nested plugins and any \*SKILL.md** — `src/lib/bbs/harness-map.js:154` (correctness): Skills, hooks and plugins are walked recursively; endsWith('SKILL.md') matches MYSKILL.md. — fix: Limit depth per kind: skills exactly .claude/skills/\*/SKILL.md, hooks and plugins depth 1.
- **Unparseable package.json and symlinked index entries are dropped silently** — `src/lib/bbs/harness-map.js:240` (other): A JSON.parse failure is swallowed; Dirent symlinks are skipped with no record. — fix: errors.push({path:'package.json', code:'EJSON'}); record skipped symlinks with code SYMLINK.
- **The index walk reads whole files for 80 lines and ignores the 'Walk only what you will use' rule** — `src/lib/bbs/harness-map.js:123` (performance): Files are read fully then sliced; the walk awaits one entry at a time; only node\_modules/.git skipped; no cap. — fix: Read a bounded 64 KiB prefix via FileHandle; skip SKIP\_DIRS; batch per directory; cap rows per kind.
- **Dead code: an unused ts and empty writeError branches** — `src/lib/bbs/harness-map.js:564` (other): const ts never used; renderStatusSafe writeError checked and ignored in empty if blocks. — fix: Remove the unused ts; return the warning in the result or drop the redundant calls.
