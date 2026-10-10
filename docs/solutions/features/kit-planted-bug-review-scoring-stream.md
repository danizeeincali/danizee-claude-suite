# kit stream: planted-bug-review-scoring (marathon 2026-10-10-bbs-openqodex-2)

**What shipped:** `kit/cli.js review-score --specs <dir> --reviews <dir> --out <dir>` (`src/lib/kit/review-score.js`).
It grades a code reviewer offline by scoring saved reviews against fixture cases with planted bugs
(`.claude/helpers/kit/review-fixtures/`: two buggy cases and one clean case). Each finding is a hit (file, line within
tolerance, allowed category, keyword at a word start), near miss, duplicate, accepted (a real but unplanted issue),
false positive or missed. Totals give precision and recall as summed ratios. Specs are snapshotted with a sha256
manifest on the first run so a later spec edit never changes an old score. Reviews may be `{case, completed,
findings|rows}` or a bare array that takes its case from the file name. Inputs are capped (file count, 1 MiB per file)
and anything odd is refused with exit 1. Caller: step 4.5a of `/w-marathon` (optional reviewer calibration).

**Rounds:** r1 fail (paths given from the repo root never matched the spec, so a correct reviewer scored zero; text line
numbers; `.JSON` files skipped; a "bare array" test that was not one), r2 pass (fixture sources named their own planted
bugs in comments; linked review files were skipped silently; size cap untested), r3 pass (the fixture leak test was a
no-op on Node 20.0; step 4.5a was labelled offline though its reviewers need the model API). All 9 findings were fixed
before merge.

**Lesson:** a calibration set must not contain its own answers, and a scorer must accept the path forms real reviewers
actually write.
