# /w-bbs stream `harness-map` — harness index, IDF-cosine matching, judgments, owned map.lock

Memory key: `project/marathon/2026-10-07-bbs/harness-map` · Run: `2026-10-07-bbs` · Closed 2026-10-07
Spec: `.claude/plans/2026-10-07-w-bbs.md` ("Harness index") · Code: `src/lib/bbs/harness-map.js` (784 lines), `test/bbs-harness-map.test.js`
Branch: `marathon/2026-10-07-bbs/harness-map`, merged to local `main` (59a9562). Nothing pushed.

## What the stream built

`harness-map.js` implements the `map` verb: it indexes the project's own tooling, matches each power from
`powers.json` against it, writes a 5-candidate brief for a helper, and records the helper's judgments.

- **Index** rows `{id, kind, name, path, text}` from `.claude/commands/**/*.md` (command), `.claude/skills/*/SKILL.md`
  (skill), `.claude/helpers/**/*.js` (helper), `.claude/hooks/*.sh` (hook), `src/lib/**/*.js` + `src/plugins/*.js` (module),
  `scripts/**` and `package.json` scripts (script). `text` = name + first 80 lines, NFC-normalised, lower-cased, split on
  `[^\p{L}\p{M}\p{N}]+`, stop-words removed. Reads are bounded to 64 KiB (`PREFIX_BYTES`), at most 2000 rows per kind
  (`MAX_PER_KIND`, lexicographically first, with `capped[kind] = {kept, total}`).
- **Matching** `matchPower(power, index)`: cosine over IDF weights (`idf = ln((N+1)/(df+1)) + 1`), the power's `name` tokens
  counted 3x, top 5, ties broken by name, scores rounded to 3 decimals. No LLM in `map`.
- **Brief** lists the real candidate count; with zero candidates it says "no candidates — answer missing".
- **Judgments** (`map --from <file|->`): JSON only, shared fence/CRLF parser with inventory. Each judgment is
  `{status: have|partial|missing, tool, why}`; `tool` must be one of the power's candidates (tool evidence). A bare string is
  accepted only for `missing`. A judgment for a tool outside the candidate list is refused.
- **Owned `map.lock`**: `wx` lock holding `<pid> <token>` around the read-modify-write of `map.json` in both `map` and
  `map --from`; mtime refreshed every 20 s, stale after 60 s; a stale lock is renamed aside (never deleted), token re-checked,
  and release removes the file only if the token is still ours; a release failure after commit is a warning.
- `map --force` moves `verdicts.json` / `handoff.json` aside as `*.stale-<ts>.json` and rebuilds a corrupt `map.json`.
  A failure after `map.json` is committed returns a warning and exit 0 (status rendering is wrapped).
- Symlinked index roots (`.claude`, `.claude/hooks`, `scripts`, `src/lib`, `package.json`) are reported as
  `{path, code: 'SYMLINK'}` errors and skipped; file reads use `O_NOFOLLOW`.

## Review ledger

| Round | Commit | Angle | Findings (H/M/L) | Result | Headline findings |
|-------|--------|-------|------------------|--------|-------------------|
| r1 | 72963af | one input method at a time | 11 (1/4/6) | over | name weight 9x not 3x; bare `have`/`partial` accepted with `tool: null`; fenced JSON with trailing newline/CRLF rejected; `--force` left stale `verdicts.json`/`handoff.json`; name-x3 test could not fail; brief said "5" for fewer/none; index globs wider than spec |
| r2 | 13c0586 | failure conditions and error paths | 6 (0/3/3) | over | failure after `map.json` commit failed the verb; corrupt `map.json` not rebuildable with `--force`; `map` vs `map --from` check-then-write gap; double status render; cap did not record dropped count; a power named "judgments" read as the wrapper |
| r3 | 9ea2083 | older environments, degraded networks | 4 (0/1/3) | pass | slow run lost `map.lock` and the first run's `finally` deleted the second run's lock; tokenizer split on combining marks and skipped NFC; `package.json` read whole, BOM dropped scripts; lock-release failure failed the verb |
| r4 | f449196 | the three safety probes: egress, secrets, sandbox escape | 1 (0/1/0) | pass | symlinked index roots and `package.json` followed outside the project with `errors: []` |

Total 22 findings, all fixed. Fix commits added regression tests: +18 (13c0586), +8 (9ea2083), +12 (f449196), +8 (45e70fc) = +46.
r3 and r4 were clean, so the stream closed at streak 2/2. The r4 fix (f449196..45e70fc) is reviewed in verdict r1 via `--base f449196`.

## What the lead's contract got wrong

The one high finding (r1): `matchPower` added `tokenize(name)` three times to the token list **and** passed `boost: 3` for name
tokens, so the name weighed 9x and body occurrences of name tokens were tripled too. The stored top-5 differed from the spec
formula for 4 of 4 sample powers on this repo's harness.

The lead's contract test for "name x3" used `what: 'x'`, `idea: 'y'`: both tokenise to nothing (stop-words), so the ranking was
identical at 1x, 3x or 9x. The test passed with the boost deleted. The reviewer caught it by reading the test, not the code path:
the r1 write-up lists the weak test as its own medium finding (test-quality) beside the high. The fix weights the name once
(single copy, boost 3) and pins a numeric score with a name-only versus body-only candidate pair at a 3:1 ratio. The contract
test at line 214 also enshrined a bare `partial` judgment, which the reviewer flagged as spec-violating (a `have` nobody can check
makes `defaultVerdict` skip); it was changed to the object form.

## Cost and model observation

`cli.js model-stats` at close (4 of 7 streams done: intake, fetch, inventory, harness-map):

| Model | Spawned | Done | Green | Red | Tokens total | Tokens mean |
|-------|---------|------|-------|-----|--------------|-------------|
| sonnet | 14 | 13 | 13 | 0 | 1,205,685 | 92,745 |
| opus | 24 | 23 | 23 | 0 | 2,354,127 | 102,353 |
| haiku | 2 | 2 | 2 | 0 | 254,701 | 127,351 |

Run budget in `cli.js status`: 4,064,513 / 10,000,000 tokens (allowance 94%, ceiling 95%).

Haiku builders: the first (inventory) spent 141,036 tokens; the second (harness-map) spent 113,665 (254,701 − 141,036, about 114k),
about 19% less, and its build was green on the first pass. Both show first-pass green rate 1 in `model-stats`. The 114k is
still above the sonnet mean (92,745). The builder's green first pass did not mean the contract was right: the contract test
accepted the 9x bug, so green only meant "matches the tests". Review r1 found the high anyway.

## Pi Brain

Searched `tf-idf cosine tool matching capability index`: not-found (top hit was an unrelated project-state memory, not
relevant to tf-idf/cosine matching).

## Open items for later streams

- `withMapLockDetailed` lives in `harness-map.js`; `verdict` and `handoff` also read-modify-write run state and need the same
  ownership-token lock (see RC-D019).
