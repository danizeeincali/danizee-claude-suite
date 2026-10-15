# Review fcb48e58-760e-4789-b0ff-b65ef5238136 — two-pass-finding-clustering, round 2

- Commit: 2eb1640
- Angle: r2: merge safety, determinism
- Result: pass
- 2 findings

## Medium (1)

- **Chained merges join same-rule clusters with disjoint files that pass 1 kept apart** — `src/lib/kit/cluster.js:223` (correctness): The transitive veto only looks at pairs that are in \`pending\`, and same-rule clusters with disjoint file sets are never pending. So A{header.tsx,p1.tsx}, B{header.tsx,footer.tsx}, C{footer.tsx,p2.tsx}, with A~B and B~C approved, all collapse into one cluster with representative A (confirmed: clusters \[\["A",\["A","B","C"\]\]\], blocked \[\]). Nobody judged A against C, and pass 1 had settled them as different parts: the header says disjoint clusters 'are never offered for merging', and the test at test/kit-two-pass-finding-clustering.test.js:89 says such a pair 'never merges'. An unjudged overlapping pair vetoes a chain, but a pair pass 1 already called different does not, so the safety rule is weaker exactly where the evidence for 'different' is strongest. C's issue (footer) is then hidden behind A's title (header), which is the outcome the higher merge bar is meant to prevent. The same code is in .claude/helpers/kit/cluster.js:223. — fix: In the veto loop, also veto when x and y share a rule but are not a pending pair (disjoint files), with why 'disjoint'. Or require every cross pair to be an approved pending pair. Add a test for the A-B-C chain above that expects 2 clusters and one blocked entry.

## Low (1)

- **Line-range locations ('path:12-14') are taken as part of the file name** — `src/lib/kit/cluster.js:93` (correctness): The location regex accepts only 'path:line' and 'path:line:col'. A range such as 'src/a.js:12-14' (the form this suite's own bbs evidence lines use, e.g. 'packages/triage/src/cluster.ts:23-46') does not match, so the whole string becomes the file 'src/a.js:12-14' (confirmed). A finding with that location gets a file set that is disjoint from others in src/a.js. It never pairs with them, so the duplicates stay apart without warning, and the files list names a path that does not exist. Same in .claude/helpers/kit/cluster.js:93. — fix: Extend the regex to /^(.\*?):(\d+)(?:\[-:\]\d+)?$/ (take the start line), and add a test with a 'path:start-end' location.
