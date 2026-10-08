# Review 44f23eec-7530-4d37-ab7b-694515f450b3 — fetch, round 1

- Commit: 582fcdb
- Angle: one input method at a time
- Result: over tolerance
- 10 findings

## High (2)

- **git clone follows HTTP redirects to any host without the per-hop host check** — `src/lib/bbs/fetch.js:296` (security): The repo path checks the ref host once; git's http.followRedirects stays at its default so a 30x from the named host can land on 127.0.0.1, 10.x or 169.254.169.254, unchecked and unlogged. — fix: Add -c http.followRedirects=false and -c credential.helper= to the clone args; assert them in the clone-args test.
- **Clone checkout runs global filter drivers (git-lfs) that fetch from repo-chosen hosts** — `src/lib/bbs/fetch.js:296` (security): Only GIT\_CONFIG\* env is scrubbed; ~/.gitconfig still loads, so with git-lfs installed the smudge filter downloads from an lfs.url the cloned repo chooses, bypassing checkHost and the egress log. — fix: GIT\_LFS\_SKIP\_SMUDGE=1, -c filter.lfs.smudge= -c filter.lfs.process= -c filter.lfs.required=false, GIT\_CONFIG\_NOSYSTEM=1 and GIT\_CONFIG\_GLOBAL=/dev/null, -c protocol.allow=never with only https/ssh allowed; assert in the clone-args test.

## Medium (5)

- **url fetch requests the redacted ref, not the URL the owner named** — `src/lib/bbs/fetch.js:411` (correctness): intake masks token-like query values; fetchRun then fetches ?key=%3Credacted%3E, so the page is wrong or 4xx and the identity comes from a URL nobody named. — fix: Refuse in fetchRun when source.ref contains \<redacted\>, with a message telling the owner to re-run intake with the URL without that value. Test it.
- **--max-links / max\_urls is checked once per fetch, not per request, so redirects exceed it** — `src/lib/bbs/fetch.js:398` (security): The limit is compared with logged requests before the fetch; fetchUrl can then make up to max\_redirects+1 more requests; failed-then-retried fetches add more. — fix: Pass the remaining URL allowance into fetchUrl and refuse with a refused row before any hop that would pass it. Test --max-links 1 with one redirect.
- **Clone egress row reports bytes\_in 0; clone has no byte limit and no timeout** — `src/lib/bbs/fetch.js:313` (correctness): The git row always records bytes\_in 0; max\_bytes and the 30 s timeout never apply to the clone; execFileSync has no timeout so a stalled server or ssh prompt hangs forever. — fix: Measure fetched/repo after clone and log it as bytes\_in; refuse and remove when over the remaining allowance; pass timeout to execFileSync; GIT\_SSH\_COMMAND='ssh -o BatchMode=yes'.
- **Repo clone accepts http:// and git:// although the spec allows only https:// and git@ shapes** — `src/lib/bbs/fetch.js:127` (security): hostOfRef is the only scheme gate in cloneRepo, so http:// and git:// refs are cloned over plaintext transports. — fix: In cloneRepo accept only https://, ssh:// and user@host:path; refuse http:// and git:// with a refused egress row and exit 2. hostOfRef may still parse git:// (its test stands).
- **No test shows --max-bytes / --max-links change what fetch does** — `test/bbs-fetch.test.js:413` (test-quality): Only flag validation and usage text are tested; the per-run limit test drives limits through cfg, never through maxBytes/maxUrls or the CLI flags. — fix: Add a fetchRun test with maxBytes/maxUrls overriding a larger cfg limit, and a CLI test where --max-bytes 5 with a pre-seeded egress row refuses with exit 2.

## Low (3)

- **Refused rows count as requests in the egress line and the url budget** — `src/lib/bbs/fetch.js:322` (correctness): isRequest counts every http/git row including pre-connect refusals, so requests=1 is reported when nothing was sent and refusals use up max\_urls. — fix: Count a row as a request only when it was actually sent (no pre-connect refused, or carries a status/bytes); keep refusals in the refused count.
- **Too-many-redirects refusal writes no refused egress row** — `src/lib/bbs/fetch.js:197` (correctness): The max\_redirects refusal throws after logging only the 3xx status row, so the log never shows the run was refused. — fix: Log a refused row for the next hop before throwing, as refuse() does.
- **Redirect and byte limits are not tested at their exact boundary** — `test/bbs-fetch.test.js:149` (test-quality): The loop test checks 10 redirects refused, never that exactly 5 are followed and a 6th refused; size tests use 100 vs 50, never maxBytes vs maxBytes+1. — fix: Assert 6 calls for a 5-redirect chain that succeeds and refusal for 6; an exact-maxBytes body succeeds and maxBytes+1 is refused.
