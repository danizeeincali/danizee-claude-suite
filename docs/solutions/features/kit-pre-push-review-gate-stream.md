# kit stream: pre-push-review-gate (marathon 2026-10-10-bbs-openqodex-2)

**What shipped:** `node .claude/helpers/kit/cli.js push-gate receipt|check` (`src/lib/kit/push-gate.js`). `/w-review`
ends by writing a receipt for the reviewed change; `push-gate check` before a push abstains, asks or denies — never allows.
Change id = sha256(base, tree): the receipt hashes the working state as reviewed (temp index, user's index untouched),
the check hashes HEAD's tree, so "review, commit unchanged, push" matches. Receipts live outside the repo
(`$KIT_RECEIPTS_DIR` or `~/.claude/kit/receipts/`), one file per repository keyed by the git common dir, behind a lock.

**Rounds:** r1 over (3 medium: `--incomplete` overrode a fail verdict; dirty-tree marker made pushes never match;
the documented receipt step never set `--threshold`), r2 pass, r3 pass. 448k tokens (3 sonnet, 3 opus).

**Left open (recorded, not fixed after the certifying streak):** `git rev-parse --path-format=absolute` needs git ≥ 2.31;
the stale-lock test compares the local clock with a possibly remote mtime.

**Promoted:** two standing rules (copy-pasteable command steps; repo paths from git, not cwd).
