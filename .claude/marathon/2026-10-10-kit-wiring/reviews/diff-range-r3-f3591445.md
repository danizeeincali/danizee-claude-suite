# Review f3591445-3333-485a-95c1-fa9f4206e34f — diff-range, round 3

- Commit: d07654f
- Angle: older environments and degraded networks
- Result: pass
- 2 findings

## Medium (2)

- **Any stderr warning on an untracked-file diff aborts the whole range (core.autocrlf / eol=crlf)** — `src/lib/kit/diff-range.js:118` (correctness): exit 1 with any stderr text is treated as failure; with core.autocrlf=true git prints a benign 'LF will be replaced by CRLF' warning for every LF text file while the diff on stdout is correct (confirmed on git 2.43), so every untracked text file fails the range on those setups — fix: run the --no-index diff with -c core.safecrlf=false, or treat only stderr lines not starting with 'warning:' as failure; add a test with core.autocrlf=true
- **Hand-written symlink diff header does not quote paths as git does; a newline in the name injects diff lines** — `src/lib/kit/diff-range.js:113` (correctness): the symlink block writes the raw name in 'diff --git' and '+++' lines; git C-quotes names with quotes, backslashes, control chars or newlines (and non-ASCII under core.quotePath) and adds a TAB after a name with a space; a symlink named with an embedded newline split the header and parseDiff read a path that does not exist — fix: quote the name as git does (C-style quoting, TAB after ---/+++ names with a space), or skip-and-report an untracked symlink whose name has a newline; add tests with a space, a quote and a newline
