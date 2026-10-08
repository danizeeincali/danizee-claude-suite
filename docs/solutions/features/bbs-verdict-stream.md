# BBS stream `verdict`: licence policy, sandbox gate, review ledger, cost

Memory key: `project/marathon/2026-10-07-bbs/verdict`
Run: `2026-10-07-bbs` (marathon), stream 5 of 7. Merged to local main as 9a23f18. Not pushed.
Spec: `.claude/plans/2026-10-07-w-bbs.md` ("Licence policy"). Code: `src/lib/bbs/verdict.js` (907 lines) plus the `verdict` verb in `src/lib/bbs/cli.js`. Tests: `test/bbs-verdict.test.js`.

## What the stream built

- **SPDX expression parser.** Precedence is AND tighter than OR, parentheses group. AND takes the strictest class of its sides, OR the most permissive. Unbalanced or unrecognised input classes as `none`. `WITH` exceptions are classified: an allowlist of permission-granting exceptions (LLVM, Classpath, GCC, Autoconf, Bison, Font, OpenJDK-assembly, Universal-FOSS) keeps the base class; any other exception (for example Commons-Clause) makes the result the stricter of base and none. Classes: permissive, copyleft, commercial, none.
- **Sandbox detection that never contacts a remote daemon.** `docker` counts only when the endpoint is local (unix or npipe; `DOCKER_HOST` unset or unix). `docker context inspect` runs before `docker info`. A failed or timed-out inspect is local only when stderr shows the context command is unknown; otherwise the result is `present:false` naming the inspect failure and `docker info` is not run. `unshare` is the Linux fallback, with a reason built from code, status and first stderr line. Stderr kept as a reason is stripped of control and format characters, cut by code point at 200, URLs redacted, home directory replaced by `~`. `BBS_SANDBOX=absent` is honoured (safe direction, with a stderr warning); `present` is refused with exit 1. Config `sandbox.required_for_use:false` is ignored with a warning.
- **`legalVerdicts` / `defaultVerdict`.** Every removed verdict carries a reason string (use and, after r6, buy). `use` needs a permissive class, a sandbox present on this machine and a clean probe. Decisions outside the legal set are refused with exit 2, and the message names the cause, the legal set and the next command.
- **Probes.** Network-call probe per `use` candidate. Evidence is capped at 2 KiB, control characters stripped, URLs redacted. `probe --force` found or incomplete clears a `use` decision.
- **Decisions with append-only labels.** `labels.jsonl` rows `{ts, run, power, verdict, label}`, approve = 1, skip = 0. Clearing a decision that already has a label appends a withdrawal row. Repeat submission is idempotent: identical decisions append only the missing label or registry rows, and the warning names the repair command built from the input label (`--from <file>`, `--from -`, `--decide`). Duplicate top-level keys in the decisions input are refused naming the power.
- **Superseding registry rows.** A cleared decision appends a superseding `registry.jsonl` row, so `lookupSource` no longer returns the cleared verdict.
- **The `use` gate is re-derived under the lock.** Inside `map.lock`, `recordDecisions` and `recordProbe` recompute each named row from the current power, current licence policy and a fresh `detectSandbox`. A stored `verdicts.json` is never trusted for `use`. `inventory --force` takes the same lock and `verdicts.json` stores `powers_ts` so a stale write is refused; a `powers.json` without `ts` is refused with its own message.
- **Table.** An unprobed `use` shows as "use (probe first)" with the probe command in Why; the probe result shows when present.
- **Store fix.** `store.js` stale-lock break restores with rename (not `link`), and throws naming the aside file if restore fails (works on filesystems without hard links).

## Review ledger (six rounds, 26 findings fixed)

| Round | Commit reviewed | Angle | H/M/L | Result | Headline |
|-------|-----------------|-------|-------|--------|----------|
| r1 | 50f2ffb | one input method at a time | 1/3/1 | over | Parenthesised OR beside AND classed permissive; `BBS_SANDBOX=present` replaced detection; config could waive the sandbox |
| r2 | e910330 | failure conditions, error paths | 0/3/4 | over | Cleared decision left registry and label claiming it; no retry after failed append; `inventory --force` bypassed the lock (stale `verdicts.json` written back) |
| r3 | c8a8030 | older environments, degraded networks | 0/2/1 | pass | Stale-lock restore by `link` can steal a live lock; remote docker daemon counted as sandbox |
| r4 | 1d5572f | egress, secrets, sandbox escape | 0/3/1 | over | `use` decided from stored `legal`/`sandbox`; `WITH` exception ignored; failed context inspect treated as local |
| r5 | 4d9da8c | accessibility | 0/1/1 | pass | Table hid `needs_probe`; refusals omitted cause and next command |
| r6 | 7caf67d | facts and content | 0/0/5 | pass | Refused buy named no cause; two docstrings wrong; ts-less `powers.json` message false; repair hint named a nonexistent file |

Rounds 2 and 4 each broke the streak after r1 for ways the `use` gate could fail open: stale `verdicts.json` (r2 write-back, r4 stored `legal`/`sandbox`), remote docker contexts (r3, r4), `WITH` exceptions (r4), config override and `BBS_SANDBOX=present` (r1). Round 3 passed, round 4 reset the streak, rounds 5 and 6 closed it at 2/2. Fixes: e910330, c8a8030, 1d5572f, 4d9da8c, 7caf67d, 723c14d (+16, +13, +12, +12, +3 and +3 regression tests as stated in the commit messages).

## Lead decision reversals (three), each toward the safe direction

1. **Labels withdrawal row (r2).** The design wrote one label at decision time. Clearing a decision later (probe `--force` found, sandbox gone) left label 1 and a `use` registry row standing. Reversal: append-only stays, but a cleared decision gets a withdrawal row and a superseding registry row. Safe because a stale approval can no longer be read as current.
2. **Inspect-before-info order (r3, tightened r4).** The first build ran `docker info` and treated its exit 0 as a sandbox. A remote `DOCKER_HOST` or context passes that test. Reversal: inspect the endpoint first, and a failed inspect means not-a-sandbox. Safe because the failure mode moved from "use becomes legal" to "use is refused".
3. **Probe-first table marker (r5).** The approval table listed `use` as legal for an unprobed power; the owner's pick was then refused with exit 2. Reversal: mark `use (probe first)` and say why. Safe because the human sees the same state the gate will enforce; it adds information and loosens nothing.

Promoted rule from this stream (`rules.md`): the table the human approves shows every state the code knows.

## Cost

From `cli.js model-stats` (run-wide, taken at compound time): sonnet 17 spawned, 16 done, 16 green, 1,477,679 tokens; opus 34 spawned, 34 green, 3,704,771 tokens; haiku 3 spawned, 2 done, 254,701 tokens. First-pass green 1.0 on all models. No escalations.
`cli.js budget`: spent 5,687,151, remaining 4,312,849.
Per the lead: one fixer in this stream ran over its 150,000 helper budget. Stream helper mix: 1 build, 6 reviews, 6 opus fixers then 3 sonnet fixers, 1 routine compound (budget 100,000). Fixers moved from opus to sonnet for the small, finding-by-finding rounds r5 and r6.
Five of seven streams are done: intake, fetch (see earlier docs), inventory, harness-map, verdict. Remaining: handoff (active), command-docs (queued).

## Durable lessons

- A safety gate must re-derive from current inputs under the lock; a stored file is a cache, not a fact.
- SPDX strings are attacker-controlled input: precedence, grouping and `WITH` all change the class.
- Environment and config switches may only move toward safe (absent, refuse), never toward permissive.
- A fail-closed check needs its failure branch tested: timeout and non-zero exit, not only the happy path.
- Append-only logs need a withdrawal row, or a later reader sees the old claim as current.
