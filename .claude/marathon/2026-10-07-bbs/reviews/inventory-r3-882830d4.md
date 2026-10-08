# Review 882830d4-b726-42b3-860d-f9ab845a62ce — inventory, round 3

- Commit: 945e873
- Angle: older environments and degraded networks
- Result: pass
- 6 findings

## Medium (1)

- **Non-UTF-8 file names are reported as missing (ENOENT) and dropped from the listing and the count** — `src/lib/bbs/inventory.js:318` (correctness): readdir with utf8 replaces invalid bytes with U+FFFD so the joined path no longer names the real file; such files land under Could not read as ENOENT and are left out of total. — fix: Read directories with encoding 'buffer' and lstat/recurse with Buffer paths; display names with escaped bytes or list them as EILSEQ errors. Test with a fake readdir.

## Low (5)

- **SKIP\_DIRS is applied to files too, so a file named build, dist, target or vendor is silently left out** — `src/lib/bbs/inventory.js:329` (correctness): The name check runs before the type check; match is exact-case. — fix: Apply SKIP\_DIRS only to directories after the type is known. Test a file named build at the root.
- **On NFS a link() that succeeded but whose reply was lost returns EEXIST and is reported as 'powers.json exists'** — `src/lib/bbs/inventory.js:527` (correctness): Any EEXIST from link is treated as someone else's file although our own call created it; the tmp is removed so nlink cannot tell. — fix: On EEXIST from link, lstat tmp first: nlink 2 means the link succeeded — treat as committed; only report EXISTS when nlink is 1.
- **The hard-link path commits powers.json without fsync, while the fallback path fsyncs** — `src/lib/bbs/inventory.js:525` (correctness): writeFile(tmp) then link never syncs; after a crash powers.json can exist zero-length. — fix: Write tmp through a FileHandle and sync() before link, matching the fallback.
- **Empty-input error does not name the input, unlike the parse error fixed in r1** — `src/lib/bbs/inventory.js:181` (facts): 'JSON only — got empty input' ignores the label. — fix: Use \`JSON only — \<label\> is empty\`; CLI tests for --from - with empty stdin and an empty --from file.
- **Power names in scripts that need combining marks are rejected even after NFC** — `src/lib/bbs/inventory.js:20` (correctness): NAME\_RE allows only \p{L} and \p{N}; Devanagari, Thai and Arabic names keep \p{M} marks after NFC and are refused. — fix: Allow \p{M} after the first character. Test a Devanagari name.
