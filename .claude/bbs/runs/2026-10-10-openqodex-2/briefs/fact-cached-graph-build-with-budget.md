# fact-cached-graph-build-with-budget — rebuild

## Idea (in our words)
Parse each source file once into local facts (definitions, spans, call sites, imports) and cache them under a key made of the file's content hash, the extractor version and the grammar hash, so an unchanged file is never parsed again. Keep cross-file resolution as a separate later pass that is cheap to rerun. Put a wall-clock budget and a parse-count cap on the build, and a per-file parse timeout so one pathological file cannot stall the run. Changed files are parsed first, so a cut never loses the files under review. When the budget runs out, the result is labelled partial and lists what was not read, instead of pretending to be complete. Grammars are loaded lazily per language and the cache key includes a digest of the grammar bytes. A reusable version needs a tree-sitter binding, a file lister and a small on-disk cache.

## Provenance
- Source: repo https://github.com/openqodex/openqodex
- Identity: git:74b60f1
- Licence: Apache-2.0 (permissive)
- Verdict: rebuild
- Run: 2026-10-10-openqodex-2
- Decided: 2026-10-10T01:20:31.307Z
- Evidence: repo/packages/graph/src/build.ts:1-15, repo/packages/graph/src/build.ts:93-98, repo/packages/graph/src/build.ts:96-127, repo/packages/graph/src/build.ts:161-202, repo/packages/graph/src/parser.ts:1-68, repo/packages/graph/src/extract.ts:1-10

## What we have
missing — No candidate parses source into cached facts or runs a wall-clock and parse-count budget; marathon budget.js is a token budget.

## Finish line (5 checks, written before the build)
- `tests_green_fact-cached-graph-build-with-budget`: fact-cached-graph-build-with-budget: green unit runs in a row
- `egress_zero_fact-cached-graph-build-with-budget`: fact-cached-graph-build-with-budget: zero egress in the packaged check
- `six_sigma_fact-cached-graph-build-with-budget`: fact-cached-graph-build-with-budget: clean reviews in a row
- `callers_fact-cached-graph-build-with-budget`: fact-cached-graph-build-with-budget: callers in the harness
- `packaged_fact-cached-graph-build-with-budget`: fact-cached-graph-build-with-budget: packaged check passes

## Kickoff lines

Done means
- tests_green_fact-cached-graph-build-with-budget — green unit runs in a row
- egress_zero_fact-cached-graph-build-with-budget — zero egress in the packaged check
- six_sigma_fact-cached-graph-build-with-budget — clean reviews in a row
- callers_fact-cached-graph-build-with-budget — callers in the harness
- packaged_fact-cached-graph-build-with-budget — packaged check passes

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

