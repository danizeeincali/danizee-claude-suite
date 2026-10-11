# Review 0ccc3c40-9d89-44a0-9230-9c8e50258ecc — sweep-foreign-and-logs, round 5

- Commit: 53331bf
- Angle: accessibility
- Result: pass
- 2 findings

## Low (2)

- **Keep-or-remove instructions conflict after the secrets-without-kit refusal** — `.claude/commands/.shortcuts/w-compound.md:309` (accessibility): Line 254 (redact exit 2) says $E is kept for a rerun once the kit is restored; line 296 (build exit 2) says $R is kept; line 309 says $E is removed on every path after a redact exit 1 or a build exit 1 or 2. After a build exit 2 the build prose says keep while the cleanup prose says remove, and a redact exit 2 is missing from the cleanup trigger list. Same wording in src/plugins/dot-shortcuts.js. — fix: In the cleanup sentence separate the refusal from the failures: after a redact or build exit 2 'secrets file present but kit missing' keep the files until the kit is restored or remove them when giving up; after a redact exit 1, a build exit 1, or a build exit 2 'body still holds a secret' remove them now. Keep lines 254 and 296 consistent.
- **curl's own exit code is passed through and collides with the block's named exits 1 and 2** — `src/plugins/dot-shortcuts.js:105` (accessibility): The CHECKPOINT 0.5 Pi Brain block in w-fix and w-swarm (and the w-compound fork-check fence) ends with exit $RC for a curl failure; curl's own exit 1 and 2 collide with the block's named exit 1 (nothing sent) and exit 2 (secrets refusal). An agent branching on the code as documented would misread a curl init failure as the refusal; the stderr line disambiguates. — fix: Map colliding curl exits to a distinct code (for example \[ $RC -le 2 \] && RC=99) and name it in the prose, or state in the prose that curl's exit 1 and 2 are told apart by the 'search failed (curl exit N)' line.
