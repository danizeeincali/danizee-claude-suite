# Review 869eeee5-e957-46cf-9ee4-47a1390f25ea — noise-ledger-with-flake-quarantine, round 2

- Commit: 58fcc7b
- Angle: r2: adversarial inputs, ledger lifecycle
- Result: pass
- 3 findings

## Medium (1)

- **Concurrent accept runs silently lose ledger entries** — `src/lib/kit/noise-ledger.js:256` (correctness): accept reads the ledger, adds one entry and renames a temp file over the original. Nothing locks the file or checks that it has not changed in between. Two runs at the same time each write their own snapshot, so whichever rename lands last wins. Checked: 8 parallel \`cli.js noise-ledger accept --id idN\` runs against one ledger all exited 0, and the file ended with only 2 of the 8 entries. Every run reported success, so a user or a parallel swarm agent believes a decision was recorded when it was not. That finding is filed again on the next apply. The same code is mirrored in .claude/helpers/kit/noise-ledger.js:256. — fix: Take an exclusive lock file (fs.open with 'wx') around the read-modify-write and retry or fail with exit 1 while it is held. Or re-read the file just before rename and refuse when its content changed. Add a test that runs parallel accepts and expects all of them kept.

## Low (2)

- **Rewrite silently blanks hand-edited reason and drops non-string added** — `src/lib/kit/noise-ledger.js:117` (correctness): normalizeLedger keeps unknown fields but forces the known ones: a reason that is not a string becomes '' and an added that is not a string becomes undefined, which JSON.stringify then drops. Any accept or prune writes that back to the committed file. Checked: an entry with reason \['line one','line two'\] and added 20261001 came back from an unrelated accept as reason "" with no added field. The reason for a suppression is deleted from the committed record without any warning. — fix: Refuse (exit 1) an entry whose reason or added is present but not a string, as is already done for expires, rather than coercing it.
- **Ledger saved with a UTF-8 BOM is rejected as invalid JSON** — `src/lib/kit/noise-ledger.js:206` (correctness): readLedger passes the raw file text to JSON.parse. The ledger is a committed file that people edit by hand, and several editors save a leading BOM. With one, apply, accept and prune all exit 1 with 'is not valid JSON' even though the content is fine (checked with a BOM-prefixed valid ledger). Because the ledger is read on every apply, the whole advisory step fails until someone finds the invisible character. — fix: Strip a leading \uFEFF before JSON.parse (text.replace(/^\uFEFF/, '')).
