# Review 53b90ef0-3c57-48ba-89b2-34e5c3eef2e6 — layer-export-placement-math, round 1

- Commit: 227cf7d
- Angle: r1
- Result: pass
- 3 findings

## Medium (1)

- **effects\_even with an uneven overhang skips overhang-offset, against the contract** — `src/lib/kit/layer-place.js:129` (correctness): The contract's decision table reads 'clipped\_by\_parent or effects\_even -\> overhang-offset'. The code adds an extra condition, effects\_even && isEven(ov), so a layer that sets effects\_even and has an uneven render\_bounds overhang falls through to the later rules. Checked by hand: bounds {10,10,40,20}, render\_bounds {6,8,50,26}, effects\_even true, no stroke\_geometry. The contract gives overhang-offset at 6,8 50x26. The code returns rule 'bounds' at 10,10 40x20 and adds a warning saying 'no clipping or even effects', which is false because effects\_even was set. The same change is in .claude/helpers/kit/layer-place.js:129 and the header comment, and the test at test/kit-layer-export-placement-math.test.js:83 locks the deviation in. — fix: Use the contract's condition (rb && (clipped\_by\_parent || effects\_even)) or get the contract changed on purpose. Either way, make the fallback warning say which flag was set and why the rule did not apply.

## Low (2)

- **Exact-cap test name says it fails as JSON, but it asserts 'no input'** — `test/kit-layer-export-placement-math.test.js:242` (test-quality): The test 'accepts input of exactly the cap in bytes (then fails as JSON, not as size)' sends 8 MiB of spaces, so it checks the empty-input branch (/no input/), not the JSON-parse branch its name describes. It still shows the size check passed, but the name misleads the reader. — fix: Pad a valid JSON body with whitespace up to exactly MAX\_INPUT\_BYTES and assert it succeeds, or rename the test to match what it asserts.
- **--file temp dir is created at describe time and removed only by the last test** — `test/kit-layer-export-placement-math.test.js:257` (test-quality): mkdtempSync runs when the describe block loads, and rmSync is the last line of the final it(). If an earlier assertion in that test fails, or the tests are filtered by name, the temp dir is never removed. That breaks the convention of a fresh temp dir per run, removed afterwards. — fix: Create the dir in before() and remove it in after() inside the --file describe block.
