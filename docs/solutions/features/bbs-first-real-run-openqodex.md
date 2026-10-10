# First real /w-bbs run: OpenQodex (2026-10-10)

Source: https://github.com/openqodex/openqodex at `git:74b60f1` (Apache-2.0, 4307 files).
Runs: `2026-10-10-openqodex` (refused at fetch, kept as the record), `2026-10-10-openqodex-2` (complete).
Marathon run created: `2026-10-10-bbs-openqodex-2` — start it with `/w-marathon --resume 2026-10-10-bbs-openqodex-2`.

## Result

`found=11 approved=11 skipped=0 buy=0`. Every power defaulted to `rebuild` and the owner approved as shown.
Egress: `requests=1 bytes_in=4319470 bodies_sent=0 hosts=github.com`. Nothing fetched was executed.

| Power | Harness | Probe |
|---|---|---|
| pre-push-review-gate | missing | clean |
| secret-redaction-by-value-and-fingerprint | partial (intake.js redaction) | clean |
| lens-catalog-file-triggered-checks | missing | clean |
| hardened-git-read-on-untrusted-repo | missing (fetch.js `cloneEnv` overlaps, outside the candidates) | clean |
| identity-checked-file-writes | missing | clean |
| change-blast-radius-walk | missing | clean |
| caller-floor-disclosure | missing | clean |
| fact-cached-graph-build-with-budget | missing | clean |
| tracked-file-scrub-gate | missing | clean |
| planted-bug-review-scoring | missing | clean |
| isolated-tool-free-wording-judge | partial | found (headless `claude` CLI call) |

## What the run broke, and the fixes

1. **Fetch refused a 3.4 MiB clone as 22 MB.** `cloneRepo` measured the whole tree (checkout + `.git`) as
   `bytes_in`. The checkout is the same blobs expanded, so it is not egress. Now `bytes_in` is `.git` only and the
   checkout has its own cap, `limits.max_checkout_bytes` (200 MB). RC-D035.
2. **The inventory brief never listed the code.** It listed the first 500 sorted paths; 454 were `benchmark/`
   result files and `packages/` did not appear. Past the cap the listing now round-robins root files and each
   top-level directory (below a shared wrapper such as `repo/`), shallowest first, and prints listed/total per
   directory. RC-D036.

## Deviations from the command text (on purpose)

- **Inventory helpers:** the command says one haiku helper per ≤ 15 files, which is 34 helpers for 500 files.
  The run used 5, one per area (root+docs, cli/core/mcp, graph/scanners, plugins/scripts, benchmark/tests), each
  capped at 2–4 powers, then deduplicated three overlapping powers by hand before `inventory --from`.
- **Probes:** one sonnet probe per three powers (4 probes) instead of one per power (11).
- **The one approval** was asked on the project thread's decision card instead of AskUserQuestion.

## Open for the owner

- RC-D037: the map's lexical candidate picker missed `fetch.js` for the hardened-git power.
- RC-D038: `egress_zero` is written even for a power whose probe was `found`; slugs are cut mid-word at 40 chars.
- Whether the command text should allow grouped helpers (the 15-files rule does not scale to a real repo).
