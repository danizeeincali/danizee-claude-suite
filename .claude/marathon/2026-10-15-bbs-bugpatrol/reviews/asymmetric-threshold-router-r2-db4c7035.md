# Review db4c7035-c75a-40ef-ba67-f170c6f8c7c1 — asymmetric-threshold-router, round 2

- Commit: 779aca3
- Angle: r2: rule-order completeness
- Result: pass
- 2 findings

## Medium (1)

- **Misspelled threshold keys silently fall back to the looser defaults** — `src/lib/kit/threshold-route.js:58` (correctness): resolveThresholds reads only t.low and t.high and ignores every other key. The CLI likewise reads only data.items and data.thresholds (line 175-180) and ignores other top-level keys. So a caller who means a stricter floor but writes {"thresholds":{"hi":0.95}}, {"High":0.95} or a top-level "threshold" (singular) gets high = 0.8 with exit 0 and no warning. Confirmed: echo '{"items":\[{"answer":{"kind":"suppress","confidence":0.85}}\],"thresholds":{"hi":0.95}}' | cli.js threshold-route routes to 'suppress', and the same with "threshold":{"high":0.95} routes a fix at 0.85 to 'auto-fix'. In module form, routeAll(items, {High:0.95}) also suppresses at 0.85. The silent routes then open at a lower confidence than the caller set, which is the one direction this verb exists to prevent. The r1 fix closed the non-object case but not this one. Same code in .claude/helpers/kit/threshold-route.js. — fix: In resolveThresholds, throw exit 1 on any key other than low/high. In run(), throw exit 1 on any top-level key of the object form other than items/thresholds. Add a test for each.

## Low (1)

- **A UTF-8 BOM in the input file is rejected as invalid JSON** — `src/lib/kit/threshold-route.js:172` (correctness): run() passes the file text straight to JSON.parse, and readFile with 'utf-8' keeps a leading BOM. A JSON file written by a tool that adds a BOM (for example Windows PowerShell Out-File / Set-Content -Encoding utf8) fails with 'input is not valid JSON' and exit 1, so no item is routed and a regression in it never reports 'blocks'. Confirmed with a BOM-prefixed \[{"deterministicRegression":true}\] passed through --file. The failure is loud, not silent. — fix: Strip a leading \uFEFF before JSON.parse: text.replace(/^\uFEFF/, '').
