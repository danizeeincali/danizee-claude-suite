# Review d93069aa-77a5-4841-b0ce-ad8666b0a0a5 — rounds, round 1

- Commit: 95bf6d0
- Angle: one input method at a time
- Result: over tolerance
- 6 findings

## High (1)

- **read after fetch skips every report as still being written** — `src/lib/persona/read.js:388` (correctness): 15 s mtime guard — fix: drop the guard

## Medium (1)

- **Fetched reports keep sign-in paths on the Worker** — `src/lib/persona/client.js:111` (security): only the server strips — fix: strip in fetch; set paths in wrangler.toml

## Low (4)

- **keys file readable for a moment before chmod** — `src/lib/persona/cli.js:125` (security): temp file default mode — fix: create with mode 0600
- **fixing set drops areas after the first argument** — `src/lib/persona/cli.js:299` (correctness): reads only one word — fix: join the words
- **Unescaped pipe breaks the shortcut table row** — `src/utils/shortcuts.js:190` (docs): pipe in code span — fix: write or
- **Two Added headings under 4.9.0** — `CHANGELOG.md:9` (docs): inserted heading — fix: merge
