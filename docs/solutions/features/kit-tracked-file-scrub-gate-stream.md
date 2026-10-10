# kit stream: tracked-file-scrub-gate (marathon 2026-10-10-bbs-openqodex-2)

**What shipped:** `kit/cli.js scrub [--dir] [--worktree | --history <base|->] [--max-file-bytes N] [--timeout ms] [--json]`
(`src/lib/kit/scrub.js`). Private patterns live in `.claude/kit/scrub-patterns.local`, which the installer ignores.
They are decoded like scanned files (UTF-8 or UTF-16 with BOM). The default scan covers the HEAD tree through
safe-git. `--worktree` scans tracked files on disk and opens each by its exact name bytes. `--history` scans every
(blob, path) pair a push would publish, from `diff-tree -m --root` over `rev-list`; with no base that is the commits
no remote has. A hit names the file, line and pattern label, never the pattern or match text. Anything not scanned
(size cap, object missing in a partial clone, total cap) makes the scan incomplete, which is exit 2. A tracked private
pattern file is itself a refusal. Caller: `push-gate check` scans HEAD and the pushed history before it looks at
receipts. Any hit or incomplete scan denies, and the deny names the command that reproduces it. A repo with no pattern
file is untouched (filesystem check only).

**Rounds:** r1 fail (a committed pattern file was skipped; UTF-16 pattern files matched nothing; a 32 MiB buffer per
file; misleading cap message; non-UTF-8 names), r2 pass (unconfigured shared clones were denied; only HEAD was
scanned, so a removed secret still went out in history; big blobs aborted), r3 pass (a new branch's first push scanned
history the remote already had; a `--timeout` flag was advised but did not exist; the deny pointed at the wrong
command; partial-clone objects gave an unclear error). All 12 findings were fixed before merge.

**Lesson:** a push gate must scan what the push publishes, which is the new history and not just the final tree. It
must also stay silent where it was never turned on.
