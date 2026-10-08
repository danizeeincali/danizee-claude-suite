# Review 55fc36d3-2951-4b2e-9854-261435419b01 — harness-map, round 3

- Commit: 9ea2083
- Angle: older environments and degraded networks
- Result: pass
- 4 findings

## Medium (1)

- **A slow map run can lose map.lock to a second process, and the first run's finally then deletes the second run's lock** — `src/lib/bbs/harness-map.js:125` (correctness): The lock mtime is never refreshed while buildIndex runs under it; a second process sees it stale, removes it and takes its own; the first run's finally rm's without checking ownership. Breaking a stale lock also races, and NFS clock skew can make a fresh lock look stale. — fix: Build the index before taking the lock; write a random token + pid into map.lock and remove it only if the token is ours; break a stale lock by rename then token check; refresh mtime every 20 s while fn runs. Test with an injected now where fn outlasts the stale window.

## Low (3)

- **tokenize splits on combining marks and does not normalize, so Devanagari/Thai names are lost and NFD text never matches NFC powers** — `src/lib/bbs/harness-map.js:31` (correctness): \[^\p{L}\p{N}\] treats \p{M} as a separator; no NFC normalisation. — fix: Normalize NFC before lowercasing and split on \[^\p{L}\p{M}\p{N}\]+. Tests for a Devanagari name and an NFD row vs NFC power.
- **package.json is read whole and its scripts bypass the per-kind cap; a UTF-8 BOM drops every script as EJSON** — `src/lib/bbs/harness-map.js:278` (correctness): Unbounded readFile; scripts rows pushed after capList; JSON.parse rejects a leading BOM. — fix: Strip a leading BOM; put package.json scripts through the cap accounting; stat first and refuse over a size limit with a named error.
- **A failing lock release after map.json is committed fails the verb** — `src/lib/bbs/harness-map.js:134` (correctness): fs.rm force ignores only ENOENT; EACCES/EBUSY/EIO throw after the map.json write. — fix: Wrap the release in try/catch; after fn resolved, a release failure becomes a warning naming map.lock.
