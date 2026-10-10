# kit stream: caller-floor-disclosure (marathon 2026-10-10-bbs-openqodex-2)

**What shipped:** `kit/cli.js callers --symbol <file:name>... | --diff <file|->` (`src/lib/kit/caller-floor.js`). For
each symbol it lists the resolved callers and says whether that list is a floor, with one sentence per reason:
ambiguous name, dynamic or computed call, interface dispatch, unread files, or budget and row cuts. Zero callers never
reads as "unused". Callers: `impact.js` annotates every touched, impacted and removed symbol with `floor`, `reasons`
and `sentences`. A removed method keeps its class's interface floor. The /w-review blast-radius step prints those
sentences and asks for a hand check. `callers --diff` says when lines were removed (removed definitions are
`impact --base`'s job) and names a missing file as missing.

**Rounds:** r1 pass (removals were silent; unclear missing-file reason; `-h` after `--symbol`), r2 pass (a removed
method lost its interface floor; the capped unread count did not add up). All 5 findings were fixed before merge. The
build also fixed a flaky packaged test: `spawnSync`'s 1 MiB default output buffer killed `graph --json` of an installed
suite with SIGTERM. The runner now allows 64 MiB and reports the signal.

**Lesson:** a status of `null` from `spawnSync` means the child was killed by a signal, often the maxBuffer limit. Any
test helper that captures a verb's output should set maxBuffer and report the signal.
