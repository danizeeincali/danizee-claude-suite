# kit stream: fact-cached-graph-build-with-budget (marathon 2026-10-10-bbs-openqodex-2)

**What shipped:** `kit/cli.js graph [--dir] [--changed <file>...] [--diff <file|->] [--budget-ms N] [--max-parses N] [--json]`
(`src/lib/kit/graph.js`). It is a hand-written JS/TS fact extractor with no dependency (owner decision). It records
definitions, calls and imports/exports per file, cached by sha256 of extractor version + language + bytes under
`<repo>/.claude/kit/cache/graph/`, with reads and writes going through guarded-fs. A cross-file pass resolves calls as
`certain` or `possible`, and unresolved calls get a reason. The build has a wall-clock budget (monotonic clock), a
parse cap, and per-file size and time guards. Changed files go first. Anything cut is listed in `not_read` and sets
`partial`, including files git lists that are not on disk (sparse checkout). Caller: /w-review Code Analysis builds the
graph for the change range and tells the reviewer never to claim "no other callers" from a partial graph.

**Rounds:** r1 fail (diff reading: `++ ` content lines read as headers, quoted names dropped, b/ prefix guessed from
the file system; now the lens catalog's parser is used, which also gained C-style unquoting); r2 fail (a corrupt cache
index crashed every run, one refused entry switched the cache off, legal POSIX names broke the build); r3 pass (sparse
checkout reported as complete, cache untracked, CR-only line ends, wall clock); r4 pass (medium: a branch could commit
cache entries with empty facts to hide callers; the cache is now off whenever the repository lists anything in the
cache folder). All 14 findings fixed before merge.

**Lesson:** a cache stored inside the work tree under review is input from that work tree. Its entries are untrusted
unless the repository cannot supply them. Separately, `partial: false` must mean that every listed file was actually
read.
