# Review a0d726b8-eea1-43ef-a369-ba7325ab2c49 — fetch, round 3

- Commit: 952736d
- Angle: older environments and degraded networks
- Result: pass
- 3 findings

## Medium (1)

- **GIT\_CONFIG\_GLOBAL=/dev/null is ignored on git \< 2.32, so ~/.gitconfig still applies to the clone** — `src/lib/bbs/fetch.js:315` (security): Git reads GIT\_CONFIG\_GLOBAL only from 2.32; older gits (Debian 10, Ubuntu 20.04, RHEL 8) still load ~/.gitconfig, so url.insteadOf can rewrite the clone URL past checkHost, http.extraHeader/cookieFile can send auth, and other filter drivers can run. — fix: In cloneEnv also set HOME and XDG\_CONFIG\_HOME to an empty temp dir; assert them in the clone-env test.

## Low (2)

- **Clone -c settings persist in fetched/repo/.git/config, including core.hooksPath pointing at a deleted temp dir** — `src/lib/bbs/fetch.js:364` (security): Options after \`clone\` are written into the new repo's config; core.hooksPath keeps pointing at a deleted /tmp dir another local user could recreate and plant hooks in. — fix: Use core.hooksPath=/dev/null (no temp dir), or pass settings as top-level \`git -c\` options so nothing persists.
- **Real network failures surface only undici's generic 'fetch failed' and the cause is dropped** — `src/lib/bbs/fetch.js:199` (other): Node's fetch rejects with TypeError('fetch failed') and the real reason in err.cause; the error and the egress row log only err.message. — fix: Build the text from err.cause (code or message, recursing into AggregateError.errors) for both the egress row and the thrown Error; test with a fake fetchImpl throwing TypeError('fetch failed', {cause}).
