# Review b810a7a1-9076-4ac9-bfbf-a774f3a847d0 — fact-cached-graph-build-with-budget, round 4

- Commit: 650fa8e
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 1 findings

## Medium (1)

- **Repository-supplied cache entries are trusted as facts (cache poisoning hides callers)** — `.claude/helpers/kit/graph.js:947` (security): cacheGet accepts any \<cacheDir\>/\<key\>.json whose v/key match and whose shape passes validFacts. The key is a public function of the file bytes (cacheKey is exported and deterministic), and the cache folder lives inside the work tree of the repository under review. A branch can force-add .claude/kit/cache/graph/\<sha256(EXTRACTOR\_VERSION,'js',bytes)\>.json with forged facts (for example defs: \[\]), and after checkout the graph uses them instead of scanning the file. Reproduced: a temp repo with a.js calling danger() from b.js plus a committed cache entry for b.js holding empty facts gives files\[b.js\].source='cache', defs=0, edges=\[\], the call reported as unresolved 'unknown export', and partial=false. The header says cache files 'are not trusted' and /w-review relies on partial=false to say what calls a changed definition, so content the reviewed branch controls can silently remove edges from the review. — fix: Do not trust cache entries the repository supplies: when git's file list (already loaded in buildGraph) contains any path under the cache folder, turn the cache off for the run (stats.cache\_error), or bind entries to a machine-local secret (HMAC key in a gitignored file created 0600) and treat entries without a valid MAC as a miss.
