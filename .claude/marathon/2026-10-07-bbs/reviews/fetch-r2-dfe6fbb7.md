# Review dfe6fbb7-b42e-4b86-9a42-aca5f825b022 — fetch, round 2

- Commit: d099877
- Angle: failure conditions and error paths
- Result: pass
- 5 findings

## Medium (2)

- **A failure after the source.json commit deletes fetched/ while source.json still says fetched** — `src/lib/bbs/fetch.js:503` (correctness): result() runs inside the try after the commit marker; if loadState/readJsonl throws, the catch removes fetched/ and the run is left fetched:true with no files; a retry says already fetched. — fix: Build the result outside the try/catch that removes fetched/, or set a committed flag after writeJson and skip the rm. Test: loadState throws after commit → fetched/ survives.
- **Corrupt egress.jsonl rows are silently dropped from the max\_urls/max\_bytes accounting** — `src/lib/bbs/fetch.js:465` (correctness): readJsonl without report skips unparsable lines, so used.requests and used.bytes\_in undercount and the per-run limits fail open on a corrupt log. — fix: Read with report:true; when corrupt \> 0 refuse naming egress.jsonl and the count (or count each corrupt row as a full request). Test with a truncated last row.

## Low (3)

- **Host lookup runs outside the request timeout, so a hanging resolver blocks fetch indefinitely** — `src/lib/bbs/fetch.js:170` (correctness): checkHost runs before the AbortController timer on every hop and in cloneRepo; a lookup that never settles hangs the verb. — fix: Race the lookup against timeoutMs with an EgressRefused('cannot resolve \<host\>: timeout after N ms'). Test with a lookup that never resolves.
- **A failed or timed-out clone logs bytes\_in 0 although data was transferred** — `src/lib/bbs/fetch.js:357` (correctness): On git error or timeout the partial dest is removed and the row records only error with bytes\_in 0, so repeated failed attempts read unaccounted bytes. — fix: Measure treeBytes(dest) before the rm and log it as bytes\_in on the error row.
- **An empty or absent response body is committed as a successful fetch** — `src/lib/bbs/fetch.js:241` (correctness): A 2xx with a null or zero-byte body writes an empty file and marks fetched:true with the sha of the empty string, so every empty-body source shares one identity. — fix: Treat a zero-byte 2xx body (and 204) as a fetch error leaving source.json unfetched. Test 204 and empty 200.
