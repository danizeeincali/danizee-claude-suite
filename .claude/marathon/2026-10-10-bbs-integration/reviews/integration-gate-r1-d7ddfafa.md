# Review d7ddfafa-9f52-4896-9ceb-1d8c6fa25451 — integration-gate, round 1

- Commit: fb48992
- Angle: one input method at a time
- Result: over tolerance
- 8 findings

## High (1)

- **Reach command never tied to the reach test file** — `src/lib/bbs/wiring.js:156` (correctness): any exit-0 command counts — fix: command must run the test file

## Medium (4)

- **entersThrough substring match of short anchors** — `src/lib/bbs/wiring.js:108` (correctness): '/' matches any import path — fix: quoted literal outside comments; short anchors need surface import
- **usesEntry counts comments, strings, multi-line imports** — `src/lib/bbs/wiring.js:70` (correctness): entry never checked to exist — fix: strip comments, join imports, require a call; check entry exists
- **--reach parse breaks on @ in surface path** — `src/lib/bbs/wiring.js:196` (correctness): scoped packages, parallel routes — fix: match against approved surface ids
- **Scanner misses sub-routers, NestJS, Go, Rails** — `src/lib/bbs/surfaces.js:71` (correctness): realistic projects report no api surface — fix: broaden receivers; add framework patterns

## Low (3)

- **Skip patterns drop real route folders** — `src/lib/bbs/surfaces.js:34` (correctness): app/build/page.js etc — fix: build names at root only; router segments exempt from test-dir rule
- **Activity 0 in a repo subdirectory** — `src/lib/bbs/surfaces.js:133` (correctness): git log paths are repo-root relative — fix: --relative
- **--verb order-dependent with --delivered** — `scripts/marathon-measure.js:35` (correctness): pairs only collected after --delivered — fix: collect all then interpret
