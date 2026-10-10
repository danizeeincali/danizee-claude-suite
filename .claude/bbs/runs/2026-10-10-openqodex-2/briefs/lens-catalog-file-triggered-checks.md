# lens-catalog-file-triggered-checks — rebuild

## Idea (in our words)
Store each review rule as a plain markdown file so adding a rule means adding a file, not editing a prompt. Each file has frontmatter that says when it applies: a set of file globs and a case-insensitive regex run over only the added and removed lines of the diff. A loader parses every file, fails loudly on a missing field or a bad regex, and sorts them by name. At review time, a lens fires only when a changed file matches its globs and its regex hits the changed text. The number of lenses handed over is capped (four in the source) so a broad change does not flood the reviewer, and a lens can stand down when a deterministic scanner already covers the same rule on the same files. Useful for a personal suite: keep a folder of your own recurring checks (for example, forgotten awaits in TypeScript, or secrets in logs) and attach only the relevant ones to each diff.

## Provenance
- Source: repo https://github.com/openqodex/openqodex
- Identity: git:74b60f1
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-10-openqodex-2
- Decided: 2026-10-10T01:20:31.302Z
- Evidence: repo/packages/core/src/lenses.ts:1-120

## What we have
missing — No candidate loads frontmatter rule files or matches globs and regexes against diff lines; follow-up-detector is an unrelated text classifier.

## Finish line (5 checks, written before the build)
- `tests_green_lens-catalog-file-triggered-checks`: lens-catalog-file-triggered-checks: green unit runs in a row
- `egress_zero_lens-catalog-file-triggered-checks`: lens-catalog-file-triggered-checks: zero egress in the packaged check
- `six_sigma_lens-catalog-file-triggered-checks`: lens-catalog-file-triggered-checks: clean reviews in a row
- `callers_lens-catalog-file-triggered-checks`: lens-catalog-file-triggered-checks: callers in the harness
- `packaged_lens-catalog-file-triggered-checks`: lens-catalog-file-triggered-checks: packaged check passes

## Kickoff lines

Done means
- tests_green_lens-catalog-file-triggered-checks — green unit runs in a row
- egress_zero_lens-catalog-file-triggered-checks — zero egress in the packaged check
- six_sigma_lens-catalog-file-triggered-checks — clean reviews in a row
- callers_lens-catalog-file-triggered-checks — callers in the harness
- packaged_lens-catalog-file-triggered-checks — packaged check passes

You may decide on your own
- How to structure the code behind each power's interface, within its brief
- Test names, fixtures and file layout

Ask me before
- Adding a dependency
- Any network call, account, purchase or signature
- Changing a finish line

Never
- Never execute fetched foreign code
- Never copy source code from the source

