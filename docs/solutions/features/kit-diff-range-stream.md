---
memory_key: project/marathon/2026-10-10-kit-wiring/diff-range
date: 2026-10-10
run: 2026-10-10-kit-wiring
stream: diff-range
---

# kit stream: diff-range (marathon 2026-10-10-kit-wiring)

## What shipped

`kit/cli.js diff-range [--dir <repo>] [--base <ref>] [--no-untracked] [--base-only] [--json] [--timeout <ms>]
[--max-untracked <n>] [--max-file-bytes <n>]` (`src/lib/kit/diff-range.js`). One verb prints the review range as a single
raw unified diff on stdout, ready for `lenses|graph|impact --diff`.

**The range:** tracked changes from the base to the working tree (committed since the base plus uncommitted edits), plus
every untracked, not-ignored file as an added file. The base is `--base <ref>`, else the merge base of HEAD and its
upstream, else the empty tree (the whole history). `--base` also accepts the empty-tree id, SHA-1 or SHA-256.
`--base-only` prints the resolved base so a caller can pass the same one to two verbs. Paths are bare, relative to the
repository top. `--no-untracked` leaves untracked files out. `--json` prints a summary instead (`empty`, `untracked`,
`skipped`, `skipped_detail`, `untracked_count`).

**Exit codes:** 0 printed. 3 empty (nothing at all, or only a skipped nested repository). 1 bad input, a git failure, a
timeout, a missing partial-clone blob, no merge base with an existing upstream, or a range whose only changes were
skipped by a cap. 2 refused (an `include.path` in the repository's own config, a driver name outside `[A-Za-z0-9._-]`,
a range over graph's 32 MiB limit). With `--json`, exit 0 whenever a summary is printed, empty or not.

**Hardening (the repo under review may not be yours):** every git call runs with no inherited `GIT_*` variables and
safe-git's override list (now `export`ed as `overrideArgs`): hooks, fsmonitor (`core.fsmonitor=` empty), pager, external
diff, submodule recursion, every transport and the credential helper off, plus empty clean/smudge/process, textconv and
merge drivers for each driver name found in the config. Static overrides travel in `GIT_CONFIG_PARAMETERS`, per-driver
pairs on argv (so hundreds of names cannot overflow the environment). `GIT_NO_LAZY_FETCH=1`, `GIT_LFS_SKIP_SMUDGE=1`,
`--no-ext-diff --no-textconv`, and `--ignore-submodules=dirty` so a submodule pointer bump stays visible. The config is
read with `--no-includes --show-scope`, so an include is never followed; includes in the repo's own scopes (local and
`config.worktree`) are refused. Every git child has a timeout (default 60000 ms).

**Untracked files:** one git process for all of them. A temporary copy of the index (`GIT_INDEX_FILE`, the real index is
never touched, `core.splitIndex=false`) takes `add -N --pathspec-from-file=-` (NUL-separated, literal pathspecs; `--sparse`
only on sparse checkouts, retried once without it), then one `git diff --no-renames <base>`. A git older than 2.25 or an
unwritable TMPDIR falls back to one `--no-index` diff per file. Caps: 20000 files and 8 MiB per file; the extras go to
`skipped` with a reason (`nested_repository`, `max_untracked`, `too_large`) and a stderr note. Untracked symlinks are never
followed; their diff is written by hand in git's own shape (mode 120000, C-quoted names). Non-UTF-8 diffs come back as a
Buffer that the cli writes undecoded (new `raw` result path in `cli.js`). `defaultGit` in `push-gate.js` now names the
command on timeout, separates a signal death from a timeout, and names ENOBUFS.

**Wiring:** the three /w-review steps (lenses, graph, impact) in `src/plugins/dot-shortcuts.js` (regenerated into
`.claude/commands/.shortcuts/w-review.md`) each pipe `diff-range` into the verb through a temp file, handle exit 3 as
"no change to review", report any other non-zero exit (2 named as a refusal), and carry the exit status out. The impact
step resolves the base once into `B` and passes it to both `diff-range` and `impact`.

**Tests:** `test/kit-diff-range.test.js` (47), `test/kit-diff-range-packaged.test.js` (3, the packaged helper copy),
`test/w-review-command.test.js` (command text, 5), plus updates to the blast-radius and cached-graph tests that asserted
the old command text. The helper is mirrored in `.claude/helpers/kit/`.

## Review ledger

| Round | Angle | H/M/L | Result | Tokens | Reviewed commit |
|---|---|---|---|---|---|
| 1 | one input method at a time | 1/2/2 | fail | 45k | 7d9bd9a |
| 2 | failure conditions and error paths | 0/3/1 | fail | 45k | 274ecf9 |
| 3 | older environments and degraded networks | 0/2/0 | pass | 45k | d07654f |
| 4 | the three safety probes | 0/1/0 | pass | 45k | 8c2c7e4 |
| 5 | accessibility (checking the security fix) | 0/2/3 | pass | 75k | 7563d5a |
| 6 | facts and content | 1/0/5 | fail | 45k | d1dbdb4 |
| 7 | performance and memory | 0/2/1 | pass | 45k | d507c70 |
| 8 | one input method at a time | 0/3/1 | fail | 45k | 5b3a800 |
| 9 | failure conditions and error paths | 0/1/3 | pass | 45k | 71cef3a |
| 10 | older environments and degraded networks | 0/1/2 | pass | 35k | 7d3b0f0 |
| 11 | the three safety probes | 0/0/2 | pass | 25k | 9fc73ac |

Total: 11 rounds and about 495k review tokens (read from `store/reviews.jsonl`). Each round's fix commit is the next row's reviewed commit.

## Headline findings

- **A symlink to the host's node_modules was committed (r1, high).** The first commit added `node_modules` as a mode-120000
  link to an absolute path; `.gitignore` only ignored `node_modules/`. Fix: `git rm --cached`, ignore the name without the
  slash.
- **`git diff --no-index` exits 1 for differences and for errors (r1, r3, r9).** A nested repo, a directory symlink or a
  CRLF warning made exit 1 look like a diff or like a failure. Fixes: nested repos skipped and reported, symlinks
  written by hand, only non-benign stderr is a failure, and a path git cannot read is a named exit 1, never exit 3.
- **A failed merge base silently became the whole history (r2).** In a shallow clone with an upstream set, the empty-tree
  fallback hid the problem. Now the fallback is only for "no upstream"; otherwise exit 1 with "pass --base".
- **The reviewed repo's own config could run programs (r4, r5, r6).** Textconv, clean filters, fsmonitor and lazy fetch
  were reachable from `.git/config`. Fix in stages: override list on every call; then `include.path` refusal after a FIFO
  include hung the config read; then the same refusal for `config.worktree`, which r6 rated high.
- **Env size is a limit (r5).** 600 driver sections overflowed `GIT_CONFIG_PARAMETERS` (E2BIG). Per-driver pairs moved to argv.
- **`--ignore-submodules=all` hid submodule bumps (r5)**, making a pure pointer change exit 3. Now `=dirty`.
- **One git process per untracked file did not scale (r7).** 2000 files took 8.4 s. Replaced by one process on a temporary
  index, with count and size caps and a named ENOBUFS.
- **The merged diff turned a hand-moved file into a rename (r8),** dropping content. `--no-renames`. Also: a sparse
  checkout made `add -N` refuse files outside the cone, and a range of only capped files exited 3 ("no change to review").
- **Retry detection must match the real error (r9, r10).** An unconditional `--sparse` broke git 2.25-2.33, and the retry
  regex matched git's usage text, so it never fired on a real old git. Fixed by sending `--sparse` only on sparse
  checkouts and reading git's first error line.
- **Signals are not timeouts (r6).** Every signal death was reported as "took longer than N ms".

## Open at close

Two low findings from r11 remain open, both in the TMPDIR fallback:

- The note labels a `copyFile` failure on the real index (EACCES/EIO) as a temporary-directory failure, because
  `copyFile` shares a `try` with `mkdtemp` (`src/lib/kit/diff-range.js`).
- No test makes `mkdtemp` succeed and `copyFile` fail, or checks that the temporary directory is cleaned up
  (`test/kit-diff-range.test.js`).

## Lessons

- Run `git ls-files node_modules | wc -l` before every commit in a worktree. A dependency link created for tests is easy
  to commit, and an ignore rule with a trailing slash does not match a symlink.
- Do not default to the empty tree when a base lookup fails. It silently widens the range; reserve it for "no upstream".
- `git diff --no-index` and `git diff` disagree on exit codes and on symlinks, renames and quoting. Prefer one process on
  a temporary index and keep the per-file path only as a fallback, with tests for both.
- A config you did not write is data. Read it with `--no-includes`, refuse repo-owned includes, and cover every scope
  (local, worktree), not just the one you tested.
- Anything that can be empty needs its own exit code and the caller needs to say what each means. "Empty because capped"
  and "empty because nothing changed" are different answers.
- Match retries on git's first error line, never on text that also appears in usage output; test with the real old git
  message.
- Name every limit when it is hit (timeout, ENOBUFS, caps) and say what flag raises it.
