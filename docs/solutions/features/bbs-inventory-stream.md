# /w-bbs stream `inventory` — power schema, JSON-only parsing, 12-power cap, helper brief

Memory key: `project/marathon/2026-10-07-bbs/inventory` · Run: `2026-10-07-bbs` · Closed 2026-10-07
Spec: `.claude/plans/2026-10-07-w-bbs.md` ("Power schema", `inventory` rows) · Code: `src/lib/bbs/inventory.js`, `test/bbs-inventory.test.js`
Branch: `marathon/2026-10-07-bbs/inventory`, merged to local `main` (b920b72). Nothing pushed.

## What the stream built

`inventory.js` implements the `inventory` verb in two halves: `inventory --brief` writes a helper brief,
and `inventory --from <file|->` validates the helper's JSON and writes `powers.json`.

- **Schema validation.** Nine required fields (`name`, `what`, `evidence`, `dependencies`, `data_needed`,
  `network`, `size`, `licence`, `idea`); `network` (`none|outbound|inbound|unknown`) and `size`
  (`small|medium|large`) are enums. Every error names the field and the index (`powers[3].name ...`).
  Names: one line, letters/digits/space/dot/underscore/dash (combining marks allowed after the first
  character), no `/ \ |`, no control characters, no leading dot, no `__proto__`/`constructor`/`prototype`,
  max 80; stored NFC with whitespace collapsed; duplicates compared in that form, case-insensitive.
  The `idea` field must be prose: no code fence anywhere, and code-line heuristics only for ideas of 3+ lines.
- **JSON-only parsing.** Input is `{ "powers": [...] }` or a bare array. A fenced block (```json, ```JSON,
  CRLF, trailing space after the tag, bare fence) is unwrapped; the closing fence is taken from the end of
  the text. Any other prose is a refusal naming the input (`--from <path>` or stdin), with control bytes
  escaped in the preview. Empty input says `JSON only — <label> is empty`.
- **12-power cap.** The first 12 are kept; the rest are listed in `not_inventoried: [names]`.
- **Helper brief.** Lists source files (sorted, then capped at 500, the remainder counted), tells the
  helper to return JSON only, and states the schema. Secret-like names (`.env*`, `*.pem`, `*.key`, `id_*`,
  `.npmrc`, `.netrc`, `credentials*`) are omitted with a count, and the helper is told never to copy values
  from config or secret files. The licence is the shallowest `LICENSE*`/`COPYING*` candidate (alphabetical
  tie-break; `LICENSE-MIT` matches). Skipped directories: `.git node_modules .venv venv __pycache__ target
  dist build vendor .next .cache` (directories only; a file named `build` is listed). Non-UTF-8 names are
  read as buffers and reported as EILSEQ errors rather than dropped. A missing or empty source root throws,
  naming the path and telling the owner to re-run fetch/intake.
- **Exclusive `powers.json` claim.** Without `--force`: write tmp (fsync), `link()` to `powers.json`
  (EEXIST means refused). Where hard links are unavailable (EPERM/ENOTSUP/ENOSYS/EXDEV) it falls back to
  `open(..., 'wx')` + write + fsync. On NFS an EEXIST from `link()` whose tmp has `nlink` 2 counts as
  committed. Once committed, a failure in the re-render or `loadState/nextStep` becomes a warning
  (`next: null`, exit 0), not a failed verb.
- **Stale-on-force.** `--force` moves `map.json`, `verdicts.json` and `handoff.json` aside as
  `*.stale-<ts>.json` (unique name via exclusive create) and reports it; a failure partway rolls back
  and lists what moved. Test: inventory, write `map.json`, `inventory --force`, next step is `map`.

## Review ledger

| Round | Commit | Angle | Findings (H/M/L) | Result | Headline findings |
|-------|--------|-------|------------------|--------|-------------------|
| r1 | cc5665c | one input method at a time | 13 (0/9/4) | over | fence variants (CRLF, ```JSON) failed; "in our words" heuristic refused short prose and accepted code; names accepted `\n`, `\|`, `../`, `__proto__`; first-match licence; unreadable root gave an empty brief; check-then-write on `powers.json`; `--force` kept stale `map.json`; brief listed `.env`/keys |
| r2 | 8a726fb | failure conditions and error paths | 6 (0/2/4) | pass | failure after the commit made a retry say "exists"; `link()` EPERM on filesystems without hard links; `--force` partial failure had no rollback; empty root gave a normal brief |
| r3 | 945e873 | older environments, degraded networks | 6 (0/1/5) | pass | non-UTF-8 file names dropped as ENOENT; skip list applied to files; NFS lost-reply `link()`; hard-link path had no fsync; empty-input error unlabelled; combining marks rejected in names |

Fix commits added regression tests: +21 (r1), +10 (r2), +8 (r3). r2 and r3 were clean, so the stream
closed at streak 2/2 (rule: stream close vs run-wide gate). Test-contract commit 11bcd23 preceded the
build; the builder commit cc5665c touched the contract tests in two places (see below).

## Promoted rules (added to `.claude/marathon/2026-10-07-bbs/rules.md`)

- **A test proves the boundary and the switch** (`test-quality`, fetch-r1 + inventory-r1). Seen twice:
  fetch r1 had limits without N/N+1 cases; inventory r1 had no test for symlinks, repo-type sources or
  fenced/CRLF input. Every limit is tested at N and N+1, every flag shows it changes behaviour, every
  input shape the contract names has its own case.
- **Walk only what you will use** (`performance`, inventory-r1 + inventory-r2). Seen twice: r1 found a full
  walk before the 500-file cap and unsorted slicing; r2 found one `lstat` per entry with vendor/build
  trees walked. The rule: skip vendor/build dirs, use the Dirent type before `lstat`, batch per directory,
  stop collecting at the cap while counting the rest, sort then slice.

## Cost and model observation

`cli.js model-stats` (run total at close of this stream; 3 of 7 streams done: intake, fetch, inventory):

| Model | Spawned | Done | Green | Red | Tokens total | Tokens mean |
|-------|---------|------|-------|-----|--------------|-------------|
| sonnet | 10 | 9 | 9 | 0 | 799,346 | 88,816 |
| opus | 18 | 18 | 18 | 0 | 1,831,504 | 101,750 |
| haiku | 2 | 1 | 1 | 0 | 141,036 | 141,036 |

Cumulative spend: 2,771,886 tokens across 30 spawned helpers. Haiku-first observation: the one completed
haiku builder spent 141,036 tokens and 102 tool uses (tool-use count from its task notification; not in
`model-stats`), against a sonnet mean of 88,816 tokens. The builder commit cc5665c edited two contract-test
lines: `test/bbs-inventory.test.js` (an `await` inside a non-async arrow, a genuine syntax error in the
lead-written contract, fixed with `async () =>`) and `test/bbs-cli.test.js` (the usage string now lists
`inventory`). Its first-pass green rate in `model-stats` is 1.

## Pi Brain

Searched `json only helper output schema validation inventory`: not-found (only a generic structured-output
ADR for LLM constrained decoding; not relevant to CLI-side validation of helper output).
