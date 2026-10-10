---
memory_key: project/marathon/2026-10-10-kit-wiring/bbs
date: 2026-10-10
run: 2026-10-10-kit-wiring
stream: bbs
---

# kit stream: bbs (marathon 2026-10-10-kit-wiring)

## What shipped

`/w-bbs` (the `'w-bbs'` block of `src/plugins/dot-shortcuts.js`, regenerated into
`.claude/commands/.shortcuts/w-bbs.md`, with the helper copies under `.claude/helpers/bbs/`) now calls the kit at
three checkpoints. The owner's rule holds: the kit is advisory, so a missing kit never blocks a workflow that worked
before. Every kit step has a one-line fallback when `.claude/helpers/kit/cli.js` is missing, and a closing checklist
line says the kit steps ran or the kit is not installed.

**SAFE_GIT_LINES, the inventory brief.** For a repository source only, `inventoryBrief` adds a "Reading the clone with
git" section. Every git read of the clone under `fetched/` goes through `safe-git --dir <clone top> -- <git args>`,
never plain `git -C fetched/...`. The brief prints a `Clone top (for safe-git --dir)` line, the absolute path of
`<Root>/repo`, and says listed files start with `repo/` (dropped in git args). The allowed subcommands are log, show,
ls-files, ls-tree, cat-file, diff and rev-list (`blame` is refused). Exit codes are read from the process, not the
output: 0 git ran; 1 bad input (fix and retry once); 2 refused (no retry, named in evidence); 3 git failed or timed
out. JSON is printed only for exit 0 and a git-ran exit 3; a timeout, overflow or kill prints one `kit:` stderr line.
The failure wording is inventory-shaped: name the failed read in the `evidence` of the affected power, or in
`none_found` when nothing could be read, never a probe verdict. The clone is depth 1, so history beyond HEAD is a
wrong call. The no-execute line now says the safe-git read is the one allowed command (non-repo sources: no command).

**SAFE_GIT_LINES, exported once.** It is defined and exported in `src/lib/bbs/inventory.js`; `harness-map.js`
imports it, so the map brief carries the identical rule and still says JSON only.

**CHECKPOINT 2.** Inventory helpers for a repository source are told to use safe-git, with the `Clone top` line named
and `--dir .../fetched` called wrong. The sentence is scoped to repository sources: other sources are told to run no
command.

**CHECKPOINT 4, probe and redact.** Probe helpers get the same safe-git rule with the one exit-3 rule: a timeout,
overflow or kill returns `incomplete`; git ran and failed on a wrong call (missing path, history past HEAD) is fixed
and retried once, a second failure on a correct call returns `incomplete`. Before recording, the lead redacts the
evidence: written with the Write tool to `$E` outside the repository, then a block that bypasses redaction when the kit
is missing, checks both secrets paths with `-e` and `-L` (a dangling symlink or directory is a broken state, not
"absent"), and otherwise runs `redact --keep-lines` under `mktemp`, a `trap` and cleared variables. `$R` (the redacted
text) is kept, printed as `file=<path>` with `replaced=<n>` on stderr, and recorded as
`R=<path>; ... --evidence "$(cat -- "$R")" && rm -f -- "$R" "$E"`: the path binding and the record run in one command.
`$E` is removed on every path; exit 1 and any other non-zero exit are never read as "nothing to redact".

**CHECKPOINT 6, scrub before /bc.** The lead substitutes the run id for `<id>`, then a block stages only the run's
paths (`.claude/bbs/runs/<id>` and `registry.jsonl`), runs `scrub --worktree --json` and, on any non-zero exit
(scrub 1 or 2, or a failed `git add`), unstages with `git reset -q --` and checks that exit. Hits in other files are
reported but do not block `/bc`. Exit 2 blocks on run-path hits, on `complete: false` with a run path in
`not_scanned`, on `truncated: true`, and on `hits_not_shown` above 0. Exit 2 with a `kit: refused:` line and no JSON
means nothing was scanned: report it, never read it as clean. `configured: false` means nothing scanned; say so.

## Review ledger

| Round | Angle | H/M/L | Result | Tokens | Reviewed commit |
|---|---|---|---|---|---|
| 1 | one input method at a time | 0/2/4 | pass | 60k | 3d46f4a |
| 2 | failure conditions and error paths | 0/3/2 | over | 60k | dc86fa4 |
| 3 | older environments and degraded networks | 0/3/3 | over | 62k | 8fe75a6 |
| 4 | the three safety probes | 0/1/2 | pass | 60k | bbb4996 |
| 5 | accessibility | 0/1/3 | pass | 60k | 30ddb19 |
| 6 | facts and content | 0/1/1 | pass | 45k | 6d3bc53 |
| 7 | performance and memory | 0/0/0 | pass | 38k | 6142e83 |

Total: 7 rounds and about 385k review tokens (read from `store/reviews.jsonl`; the 24 findings match
`store/findings.jsonl`). Each round's fix commit is the next row's reviewed commit (build 3d46f4a, then dc86fa4,
8fe75a6, bbb4996, 30ddb19, 6d3bc53, 6142e83). There was no high in any round; round 7 found nothing.

## What the reviews taught

**Wired text must name only subcommands the verb allows (r1).** The build listed `blame` among safe-git reads, but
`READ_SUBCOMMANDS` refuses it with exit 2. A probe that followed the text would have been refused on its first call.
The list now matches the verb, and a run-based test checks every subcommand the wired text names against
`READ_SUBCOMMANDS`.

**Stage only what the workflow wrote, and unstage on refusal (r1, r2, r3).** The build ran `git add -A` before the
scrub, staging the user's unrelated work against `/bc`'s own rule. It now stages the run's two paths. Round 2 found a
refused scrub left the hit in the index while a re-scan of the edited file came back clean; the block now unstages on
every non-zero exit and checks the unstage. Round 3 added the refusal case: a `--shared` clone gives exit 2 with no JSON
and nothing scanned.

**Never paste untrusted text into a quoted argument (r2).** Probe evidence quotes the clone, often JS template
literals; inside double quotes the backticks and `$( )` would run. The text goes through a file and `"$(cat -- "$R")"`,
whose output is not evaluated again. Round 4 moved the raw file `$E` out of the repository, since CP6's `git add` would
stage it and scrub matches patterns, not the user's literal secrets.

**`-f` is not "absent" (r2).** `[ ! -f .claude/kit/secrets ]` is true for a dangling symlink or a directory, so the
block said "nothing to redact" where `redact` itself exits 1. The check is now `-e` and `-L` on both secrets paths.

**A non-JSON scrub report hides hits (r4).** Without `--json` only the first 50 hits are listed and `truncated` stays
false until 1000, so a run-path hit could sit behind earlier hits elsewhere. CP6 uses `--json` and treats
`hits_not_shown` above 0 like `truncated`. A test lists a hit in a new run directory behind 60 committed hits.

**Shell variables do not survive between tool calls (r3).** The record command used `$R` and `$E` as if still set; an
unset `$R` recorded empty evidence and exited 0. The text now binds the printed path in the same command and fails on a
missing or empty file.

**A brief's placeholders must be defined in the brief (r5, r6).** `<clone top>` was never defined and the obvious guess
(`Root`) exits 1. The brief now prints the line, as an absolute path; CP6's `<id>` has an explicit "replace it" sentence.
Round 6 found the printed path was absolute while the text called it relative to the project.

**A sentence copied between two briefs must fit both schemas (r5, r6, r3).** The probe's "return `incomplete`" was copied
into the inventory brief, which has no such value. Exit 3 is now one rule per brief: the probe returns `incomplete`; the
inventory helper names the read in `evidence` or `none_found`. The same pairing caught "the brief says so" in CP2,
false for non-repo sources, and the build's "exit 3 always prints JSON", false for a timeout; one constant now feeds
both briefs.

## Open at close

None. Round 7 found no issue at any severity, and every earlier finding has a fix in a later commit.

## Tests

`test/w-bbs-command.test.js` grew by 421 lines (27 new cases, no deletions) in the `kit wiring (safe-git, redact,
scrub)` group:

- Text assertions (20 cases): the real inventory and map briefs, CP2, CP4 and CP6 wording, exit handling, one case per
  fix from rounds 2 to 6, the closing checklist line, and `SAFE_GIT_LINES` defined once and imported by the map brief.
- Run-based cases (7: five in the nested group `the generated blocks, run in a scratch repo`, plus a real `safe-git --timeout 1`
  and a check of the wired subcommands against `READ_SUBCOMMANDS`): temp git repos with the generated blocks run as
  written. Nothing at the secrets path is "nothing to redact", while a dangling symlink or a directory surfaces redact
  exit 1; redacted evidence lands in a kept file and the documented record form does not evaluate it; a refused scrub
  unstages and the rerun re-adds; a hit behind 60 earlier hits is listed; a `--shared` clone gives a refusal with no
  JSON and unstaged paths.
