---
memory_key: project/marathon/2026-10-10-kit-wiring/sweep-foreign-and-logs
date: 2026-10-11
run: 2026-10-10-kit-wiring
stream: sweep-foreign-and-logs
---

# kit stream: sweep-foreign-and-logs (marathon 2026-10-10-kit-wiring)

## What shipped

Six workflows (the `'w-multi-repo'`, `'w-suite-sync'`, `'w-compound'`, `'w-ralph-batch'`, `'w-swarm'` and `'w-fix'`
blocks of `src/plugins/dot-shortcuts.js`, regenerated into `.claude/commands/.shortcuts/<name>.md`) now call the kit
where they read a repository they did not write, review a change, look up callers, or write a log or send text off the
machine. The kit stays advisory: each step has a one-line fallback when `.claude/helpers/kit/cli.js` is missing. The
one exception is the owner's rule for secrets: a secrets file with no kit means nothing leaves the machine.

**w-multi-repo and w-suite-sync (safe-git, lenses).** Git reads of a repository you did not write go through
`safe-git` at the top of that checkout. Lenses run in each changed repo at CHECKPOINT 3 Sync Complete (multi-repo) and
over the files created in CHECKPOINT 3 at Verify (suite-sync). Neither grows a verification checkpoint of its own.
w-suite-sync clones the upstream into `U=$(mktemp -d)`, stops when the clone fails, uses the printed path for every
`safe-git --dir`, `ls` and copy, and removes it with `rm -rf -- <literal printed path>`.

**w-fix and w-swarm (callers, lenses, Pi Brain search).** A callers step runs before the required output, one
`callers --symbol src/file.js:name` per symbol to be changed or removed, and carries the floor, reasons and sentences
forward. Lenses run inside the verification checkpoint, before the retry logic. CHECKPOINT 0.5 (the Pi Brain pattern
search) writes the description to a file, redacts it when a secrets file exists, and sends it with
`--data-urlencode "q@$Q"` from a `mktemp -d` directory, with timeouts, a portable status check and every exit named.

**w-compound (redact before anything leaves).** CHECKPOINT 1 redacts the doc text into a file before the doc is
written. CHECKPOINT 7, the only POST off the machine, writes the recipe fields raw to a file, redacts that file, builds
the JSON body from the redacted text, refuses (exit 2) if the encoded body still holds a secret, and then POSTs the
file with `--data-binary`. The fork-check search runs after redaction and reads the redacted title from the file. Fences
resolve the kit and secrets from `git rev-parse --show-toplevel`, so they work from a subdirectory and a linked worktree.

**w-ralph-batch (log redaction).** The generated overnight script routes each of its own messages through a `log()` that
redacts one line at a time with `--keep-lines`, and redacts each `claude -p` output once, as a whole, from a file. A
failed redact still writes the line, with `[redact failed exit N]`, and the loop goes on. The script says in the log
whether redaction is on. With no secrets file or no kit it is a plain `tee`.

## How it was built

Build commit 94c7f56 wired the six workflows and added `test/sweep-foreign-and-logs-command.test.js`. Two of the
shipped repo copies had drifted from the generator, so regenerating would have deleted work. d67fe41 ported the shipped
RuFlo variant of `w-swarm` (pinned by `test/ruflo-integration.test.js`) into the generator. The round 1 fix ported the
shipped `w-ralph-batch` the same way (its `--priority`, `--all` and `--phased` modes, per-candidate execution, rules,
summary report and diagnostic format), added the `log()` wiring on top, and restored the Pi Brain CHECKPOINT 0.5 that
the w-swarm port had dropped. After each port the copy equals `getCommands()`; a test checks it per workflow, and that
w-ralph-batch differs from its shipped copy at base 38552ec only by the `log()` redaction wiring.

The tests moved from regex matches to runs. The redact, search and build fences are extracted from the generated text
and run as written against a local HTTP endpoint with the real kit: a fork and a new recipe each make one POST with no
secret in the received body; a 500 keeps the files; curl exits 28, 6 and 7 keep them with curl's own status; a title
holding backticks and `$( )` runs nothing; a curl without the newer options still works.

## Review rounds

| Round | Angle | H/M/L | Result | Tokens | Reviewed commit |
|---|---|---|---|---|---|
| 1 | one input method at a time | 1/1/3 | over | 80k | d67fe41 |
| 2 | failure conditions and error paths | 1/2/3 | over | 80k | 391ab1e |
| 3 | older environments and degraded networks | 0/2/4 | pass | 80k | 8d8689f |
| 4 | egress, secrets, sandbox escape | 0/2/2 | pass | 60k | f85fa13 |
| 5 | accessibility | 0/0/2 | pass | 45k | 53331bf |

Total: 5 rounds and 345k review tokens (from `store/reviews.jsonl`). Fix commits: 391ab1e (r1), 8d8689f (r2), f85fa13
(r3), 53331bf (r4). The gate was met after round 4 (no high, two mediums under tolerance); the round 4 mediums were
fixed anyway in 53331bf, and round 5 confirmed that commit.

- **Round 1.** High: the Pi Brain POST redacted the JSON-encoded body, so a secret with a quote or backslash went out
  escaped and unredacted. Medium: regenerating w-ralph-batch deleted the shipped modes. Lows: the redact block was only
  regex-matched, the POST fence held both fork and new, and the w-swarm port dropped CHECKPOINT 0.5.
- **Round 2.** High: the fork-check search sent the raw title before redaction, in a double-quoted shell argument.
  Mediums: a POST answered 4xx or 5xx exited 0 and deleted the body, and the encoder folded an unknown `@label` into the
  previous field. Lows: a redact-check parse error read as a secret refusal, the safe-git verb list was too narrow, and
  the ralph log never said whether redaction was on.
- **Round 3.** Mediums: `--fail-with-body` needs curl 7.76, so submission was permanently broken on RHEL 8, Debian 11 and
  Ubuntu 20.04; and a search answered 503 read as "no similar recipe". Lows: no timeouts, a retry could post twice,
  the diff-range timeout was unnamed, and `log()` started two node processes per line.
- **Round 4.** Mediums: the new w-fix and w-swarm searches pasted raw text into a double-quoted argument and sent it
  unredacted; the w-suite-sync clone went to a fixed `/tmp/suite-upstream`. Lows: a kit-missing fallback posted raw
  text when a secrets file existed, and w-compound's temp files sat loose in `/tmp`.
- **Round 5.** Two lows, both open (below).

## What stays open

Two lows from round 5, not fixed, wording only, with no behaviour change at stake:

1. **Keep-or-remove conflict in w-compound.** After the "secrets file present but kit missing" refusal (redact exit 2 or
   build exit 2) the redact and build prose say the files are kept for a rerun, while the cleanup sentence says `$E` is
   removed on every path after a redact exit 1 or a build exit 1 or 2, and omits redact exit 2. The fix is to separate
   the refusal (keep until the kit is back, or remove when giving up) from the failures (remove now). The same text sits
   in `src/plugins/dot-shortcuts.js` and `w-compound.md`.
2. **curl exit codes collide with the block's own.** In the w-fix, w-swarm and w-compound search fences the block ends
   with `exit $RC` for a curl failure, so curl's exit 1 (unsupported protocol) and 2 (init failed) read as the block's
   own exit 1 (nothing sent) and exit 2 (secrets refusal). The stderr line `search failed (curl exit N)` tells them
   apart. Mapping codes at or below 2 to a distinct code, and naming it, would remove the ambiguity.

## Lessons

**Redact before JSON encoding, and before any request (r1, r2, r4).** `redact` matches the raw secret bytes;
`JSON.stringify` escapes quotes, backslashes and control characters, so a redacted-after-encoding body holds a
different string and the secret goes out intact while the step reports success. The order is: raw fields to a file,
redact the file, build the JSON from the redacted text, check the encoded body once more. The same holds for the
search: it reads the redacted file with `q@$Q`, never a title pasted into a double-quoted argument, which also stops
`$( )` and backticks in an error message from running in the shell.

**Use `-o file -w '%{http_code}'`, not `--fail-with-body` (r2, r3).** Plain curl exits 0 on a 500, so `&&` deleted the
body and the retry path. The fix for that, `--fail-with-body`, needs curl 7.76 and broke every older machine, and the
test had pinned the string. Write the status to a variable, treat anything but 2xx as "not submitted", print the
response file, and assert the portable form. Add `--connect-timeout` and `--max-time`, and name exit 28.

**A search that fails is not a search with no result (r3).** A 503 body contains no match, so the agent submitted a new
recipe instead of a fork. A non-2xx search prints `search failed (HTTP N): fork check not done`.

**Secrets file present, kit missing: refuse what leaves, stay advisory for what stays (r4).** The fallback "no kit, use
the raw text" is right for the local doc and wrong for the public registry. The fences resolve both paths from the
repository top, and when the secrets file exists without the kit, search and POST exit 2 and send nothing; the local doc
keeps the advisory path.

**Temp files go in a private `mktemp -d`, never a fixed `/tmp` path (r4).** The fixed upstream clone path was a trust
boundary hole: the second run's clone failed, and the workflow went on to copy whatever was there into the project,
with `safe-git` treating it as the clone. w-suite-sync now uses a fresh directory and the printed path. The same went
for w-compound's `Q`, `B` and their response files; a 2xx removes the directory with `rmdir`, a failure names it.

**A regenerate must not run from a drifted generator (r1, d67fe41).** The shipped w-swarm and w-ralph-batch had been
edited by hand while the generator kept an older shape; regenerating would have overwritten the richer version. Port
the shipped text into the generator first, then add the wiring, then regenerate so copy equals output.

**Test the fence, not the prose (r1, r2).** The redact block was only regex-matched and shipped two ordering bugs. Run
the extracted block against a local endpoint and assert on what was received, not on the words around it.

**Fix an under-tolerance round anyway when it is cheap and in the same lines (r4).** The gate was met after round 4,
but the two mediums sat in text round 5 would have reviewed again; fixing them in 53331bf left round 5 with two lows.
