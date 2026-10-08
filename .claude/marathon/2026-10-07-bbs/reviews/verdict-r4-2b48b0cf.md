# Review 2b48b0cf-406d-41c9-860d-be6a20331643 — verdict, round 4

- Commit: 1d5572f
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: over tolerance
- 4 findings

## Medium (3)

- **recordDecisions and recordProbe trust row.legal and vj.sandbox stored in verdicts.json, so use can be decided from a stale file** — `src/lib/bbs/verdict.js:668` (security): use is checked only against stored needs\_probe/legal; neither the current licence policy nor a fresh sandbox check is consulted; a verdicts.json computed while docker ran (or by an earlier build counting a remote context) lets --probe clean + --decide use succeed with no sandbox. — fix: Inside the lock re-derive each named row via recomputeRow against the current power + cfg licence class; before accepting use require vj.sandbox.present true, probe clean AND a fresh detectSandbox present. Test: stale verdicts.json with sandbox present, sandbox now absent → refused exit 2.
- **A WITH exception is ignored, so Apache-2.0 WITH Commons-Clause or MIT WITH GPL-3.0 classify as permissive and make use legal** — `src/lib/bbs/verdict.js:86` (security): atom() skips the exception id; restrictive exceptions unlock use for a non-permissive licence. — fix: Classify the exception: an allowlist of permission-granting SPDX exceptions (LLVM-exception, Classpath-exception-2.0, GCC-exception-\*, Autoconf-exception-\*, Bison-exception-\*, Font-exception-2.0, OpenJDK-assembly-exception-1.0, Universal-FOSS-exception-1.0) keeps the base class; anything else → the stricter of base and none (or the exception's own class). Tests for Commons-Clause → not permissive, LLVM-exception → permissive.
- **Any failed docker context inspect (timeout, non-zero exit) is treated as a local endpoint, so docker info may then reach a remote daemon** — `src/lib/bbs/verdict.js:221` (security): dockerEndpoint maps every non-ok inspect to local and detectSandbox then runs docker info with the same env; a podman shim with CONTAINER\_HOST=ssh:// or a timeout fails open. — fix: A failed inspect counts as local only when stderr shows the context command is unknown; ETIMEDOUT or any other non-zero → present:false naming the inspect failure, no docker info. Tests for inspect timeout and non-zero status.

## Low (1)

- **The docker/unshare stderr kept in sandbox.reason is not redacted and carries private paths into verdicts.json, status.md and labels.jsonl** — `src/lib/bbs/verdict.js:154` (security): 'Cannot connect to the Docker daemon at unix:///Users/\<user\>/.docker/run/docker.sock' is stored and repeated everywhere including withdrawal reasons. — fix: Run the line through redactUrlsInText, replace os.homedir() with ~, pass scheme URLs through redactDockerEndpoint. Test with a home-path stderr.
