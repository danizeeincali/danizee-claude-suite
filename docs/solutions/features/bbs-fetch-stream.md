# /w-bbs stream `fetch` — GET-only fetch, host policy, hardened clone, egress log

Memory key: `project/marathon/2026-10-07-bbs/fetch` · Run: `2026-10-07-bbs` · Closed 2026-10-07
Spec: `.claude/plans/2026-10-07-w-bbs.md` ("Fetch guards") · Code: `src/lib/bbs/fetch.js`, `test/bbs-fetch.test.js`
Branch: `marathon/2026-10-07-bbs/fetch`, merged to local `main` (27efdb1). Nothing pushed.

## What the stream built

`fetch.js` implements the `fetch` verb: a GET-only HTTP fetch and a shallow, tagless `git clone`, both
behind one host policy, both writing an `egress.jsonl` row per request. Injection points for tests:
`fetchImpl`, `lookup`, `git` (runner), `now` (no live network in the suite, per run rules).

### Egress guards

| Guard | How enforced | Added by |
|-------|--------------|----------|
| GET only, no body, no `Authorization`/`Cookie`, fixed `User-Agent` | request builder in `fetchUrl` | builder (spec) |
| Private/loopback/link-local/unspecified/IPv4-mapped hosts refused; `localhost`, `*.local`, `*.internal` refused | `checkHost`: injected `lookup`, all addresses checked; literal IPs without DNS | builder (spec) |
| Host check on every redirect hop, max 5 hops | each hop re-checked; private redirect is a refusal | builder (spec) |
| 25 URLs / 20 MB per run, 30 s per request | per-run accounting read from `egress.jsonl` | builder (spec); per-request URL allowance passed into `fetchUrl` by r1 |
| Every request logged | `egress.jsonl` row `{ts, kind, method, url, host, status, bytes_in, bytes_out: 0, refused?}` | builder (spec); refused row on too-many-redirects added by r1 |
| Cited links never fetched | recorded in `source.json.cited` only | builder (spec) |
| Clone does not follow HTTP redirects, no credential helper | `-c http.followRedirects=false -c credential.helper=` | r1 (high) |
| Clone runs no LFS/filter drivers | `GIT_LFS_SKIP_SMUDGE=1`, `filter.lfs.*` blanked, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null` | r1 (high) |
| Clone protocol allowlist | `protocol.allow=never`, only https/ssh allowed; `http://` and `git://` refs refused with a refused row | r1 (high + medium) |
| Clone timeout and size | `timeout` on `execFileSync`; `fetched/repo/.git` measured and logged as `bytes_in` (was the whole tree until 2026-10-10); over allowance is refused and removed; `GIT_SSH_COMMAND='ssh -o BatchMode=yes'` | r1 |
| Redacted ref refused | `fetchRun` refuses when `source.ref` contains `<redacted>` | r1 |
| Refusals not counted as requests | a row is a request only if actually sent | r1 |
| Corrupt egress log fails closed | read with `report:true`; corrupt rows refuse naming `egress.jsonl` | r2 |
| Lookup bounded by the timeout | lookup raced against `timeoutMs` | r2 |
| Failed fetch leaves no false `fetched` | committed flag; `fetched/` survives a post-commit throw | r2 |
| Failed/timed-out clone accounts partial bytes | `treeBytes(dest/.git)` logged before removal | r2 |
| Clone bytes are wire bytes | `bytes_in` = `.git` only; the expanded checkout is refused past `limits.max_checkout_bytes` (200 MB). The first real run (openqodex, 3.4 MiB pack, 22 MB on disk) was refused under the old whole-tree count | first real run, 2026-10-10 |
| Empty 2xx body is an error | zero-byte 200 and 204 leave `source.json` unfetched | r2 |
| Clone ignores user git config on old git | scrubbed `HOME` and `XDG_CONFIG_HOME` pointing at an empty temp dir | r3 |
| No persisted hooks path | `core.hooksPath=/dev/null` instead of a temp dir | r3 |
| Real network cause surfaced | `err.cause` (recursing into `AggregateError`) in the row and the error | r3 |

Known gap (documented in the spec, not fixed): DNS rebinding between check and connect. The sandbox is
the hard boundary; `use` is removed when none is present.

## Review ledger

Findings are counted high/medium/low. Stream closed on two clean reviews in a row (r2, r3).

| Round | Angle | Counts | Result | Found |
|-------|-------|--------|--------|-------|
| r1 (582fcdb) | one input method at a time | 2/5/3 | over | 2 highs on the clone path; redacted-ref fetch; max_urls checked once per fetch; clone bytes/timeout; http:// and git:// accepted; no limit-flag tests |
| r2 (d099877) | failure conditions and error paths | 0/2/3 | pass | fetched/ deleted after commit marker; corrupt egress rows dropped; lookup outside timeout; partial-clone bytes; empty body |
| r3 (952736d) | older environments, degraded networks | 0/1/2 | pass | `GIT_CONFIG_GLOBAL` ignored on git < 2.32; hooksPath persisted in clone config; generic "fetch failed" |

The two highs were both invisible to the HTTP-level host check: `checkHost` guards the one connection
`fetch.js` opens, but `git clone` is a subprocess with its own transport. (1) git followed HTTP
redirects (`http.followRedirects` default) to loopback, RFC1918 or `169.254.169.254`, unchecked and
unlogged. (2) With git-lfs installed, the global filter's smudge step downloads from an `lfs.url` the
cloned repo chooses, again bypassing `checkHost` and the log. Fixes were applied as clone arguments and
env, asserted in the clone-args test.

### Why the clone needed a scrubbed HOME/XDG and a protocol allowlist

r1 scrubbed `GIT_CONFIG_*` and set `GIT_CONFIG_GLOBAL=/dev/null`, but git reads that variable only from
2.32. On older gits (Debian 10, Ubuntu 20.04, RHEL 8) `~/.gitconfig` still loaded, so `url.insteadOf`
could rewrite the clone URL past `checkHost`, `http.extraHeader`/`cookieFile` could send auth, and other
filter drivers could run. r3 added an empty temp `HOME` and `XDG_CONFIG_HOME`. The allowlist exists
because `hostOfRef` was the only scheme gate: `http://` and `git://` refs would have cloned over
plaintext, which the spec forbids (https and `git@` shapes only).

## Numbers

- Reviews: ~99-111k tokens each (3). Builder: 122k. Fixers: 91-118k (3). Helper budget per brief: 150k (max 200k).
- Cumulative helper spend (`cli.js model-stats`): opus 14 spawned/14 green, 1,403,437 tokens (mean 100,245); sonnet 7 spawned/6 done/6 green, 529,179 (mean 88,197); haiku 1 spawned, 0 done, 0 tokens. About 1.93M of the 10M run budget.
- Two streams done of seven (intake, fetch). Fetch took 3 reviews and 3 fix rounds; intake took 6 reviews.
- Fix commits: +12, +6, +5 regression tests for r1, r2, r3.

## Habits confirmed

- Contract tests first (38dfe2c), then the implementation (582fcdb).
- Fixes land after a pass and are reviewed by the next round via `--base`; r2 and r3 re-reviewed r1 and r2 fixes under new angles.
- Stream-close rule: a stream closes on its own lines (`clean_reviews`, `latest_high`, `open_high`, `unit_streak`) with every finding closed and fixes reviewed; run-wide lines are judged by plain `cli.js gate` at the end.
- A finished stream is merged into local `main` before the next stream's worktree is created.
- Scripts decide (budget, streaks, gates); `cli.js budget` non-zero stops spawning.
- Never weaken an assertion; a category seen twice becomes a rule (security and correctness were already promoted from intake).
