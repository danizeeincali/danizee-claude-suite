# Review b71e32be-77fa-4e30-9bd1-3472823e6baa — unslop-do-not-list-and-final-checklist, round 2

- Commit: 8f97a9a
- Angle: failure conditions and error paths
- Result: pass
- 3 findings

## Medium (2)

- **Dropping a repeated heading is not reported** — `.claude/helpers/kit/redesign-checklist.js:298` (correctness): compare checks drops with a Set of after ids (setA.has(id)), and orderChanged only compares positions up to the length of \`common\`, so when a heading text appears more than once, removing one of its occurrences is invisible to both checks. Probe: before.md with \`## Example\`, \`## Setup\`, \`## Example\` and after.md with only the first two gives violations: \[\], pass: true, exit 0 even with --strict. Pages with repeated headings (several \`### Example\` or \`## FAQ\` blocks) are common in markdown specs and docs, so a dropped section passes the blocking review step. — fix: Compare heading/section counts per id (a multiset): report section-dropped when after has fewer occurrences of an id than before, and add a test with a repeated heading where one copy is removed.
- **Markdown reference-style link targets are never read** — `.claude/helpers/kit/redesign-checklist.js:231` (correctness): linkTargets for markdown only matches inline \`\](target)\` links, so a target given as a reference definition (\`\[d\]: https://x.y/docs\`, used as \`\[docs\]\[d\]\`) is not collected and its removal is not flagged. The header documents link-removed as covering 'an href or markdown link target'. Probe: before \`See \[docs\]\[d\].\n\n\[d\]: https://x.y/docs\` and after \`See docs.\` returns violations: \[\], pass: true under check. READMEs and docs use reference links often, so a removed URL passes --strict. — fix: Also collect \`^ {0,3}\\[\[^\\]\]+\\]:\s\*\<?(\S+?)\>?(\s|$)\` definitions (outside fences) as link targets, and add a test that removes one.

## Low (1)

- **Template test passes when no sentence could be read** — `.claude/helpers/kit/redesign-checklist.js:184` (correctness): contentWords only matches ASCII \`\[a-z\]\` words, so copy in a non-Latin script yields sentences: 0, generic\_ratio 0 and pass: true with the 'The copy reads as this product' next line. Probe: \`\<h1\>Тест\</h1\>\<p\>Лучшая платформа для команд.\</p\>\` with --name Тест passes although nothing was checked. The 0-sentence ratio is documented, but the result claims a pass rather than saying the test could not judge the copy, and check --strict inherits it. — fix: When sentences is 0, say so in next (no readable sentences, check by eye), or match words with \p{L} so non-ASCII copy is counted.
