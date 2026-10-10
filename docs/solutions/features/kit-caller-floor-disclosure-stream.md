# kit stream: caller-floor-disclosure (marathon 2026-10-10-bbs-openqodex-2)

**What shipped:** `kit/cli.js callers [--dir] (--symbol <file:name>... | --diff <file|->)` (`src/lib/kit/caller-floor.js`),
built on the graph's exports. `callerIndex(graph)` gives each symbol its resolved callers plus a `floor` flag and
`reasons` (`ambiguous_name`, `dynamic_call`, `interface_dispatch`, `unread_files`, `budget_cut_importers`), each with a
count and a plain sentence. Counters come from the graph's `unresolved` rows, its possible edges and its `not_read`
list; no source is re-scanned. `renderFloor` turns an entry into sentences and, for zero callers with a floor, says
"Zero callers found, but this is a floor: check call sites by hand." Zero callers without a floor says only "in the
files that were read". `impact` annotates every touched, impacted and removed symbol with `floor`, `reasons` and
`sentences`, so a removed symbol with no callers but a floor does not read as safe to remove. Caller: `impact.js`
imports the module, and the /w-review blast-radius step tells the reviewer to print the sentences.

**Limits kept in the output:** name matching is by the last name of a call, so a count means "may apply"; a computed
member call is counted for every method and for symbols in its own file; unresolved calls dropped at the graph's row
cap count as budget cuts; at most 50 callers are listed per symbol with `callers_omitted`; a requested symbol in an
unread file is `missing` with that reason, not "no such symbol".
