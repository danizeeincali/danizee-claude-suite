# Findings carried into the integration stream

A build stream's helper allowance was opened with 40 steps (the lead booked 10 steps per helper), so it ran out of
steps after four helpers even though under a fifth of its cost was spent. Streams whose gate was met close with the
open findings below; the integration stream fixes them before it wires the verb, with its own review.

## landing-page-section-order (review r2, both medium, open)
- Same text gives a different result on stdin than via --file when it opens with an HTML block or a comment
  (src/lib/kit/landing-sections.js:181): decide the type from the text alone on both paths, or add --format.
- Quadratic regex scan on malformed HTML (src/lib/kit/landing-sections.js:115): exclude `<` from the unquoted
  attribute class and bound the label scan; add a timing test.

## intake-batch-before-design (review r2, low, open)
- stat-then-open race on --file; JSON parse error drops its reason; refusal tests assert only the exit code.

## realistic-sample-content-rules (r2 fixed, r2 and r3 passed, gate met; r3 findings open)
- UTF-16 input (PowerShell 5.1 output) is decoded as UTF-8 and reported clean (src/lib/kit/sample-content.js:358):
  decode by BOM or refuse with exit 1 (medium).
- CR-only line endings put every finding on line 1 and skip headings (sample-content.js:69): normalise lone \r (low).

## type-scale-snapping-to-tailwind-steps (r1 and r2 passed, gate met; r2 findings open)
- One zero or overflowing size aborts the whole audit (medium); unclosed `text-[` openers make the class scan
  quadratic (medium); audit at a TTY waits forever (low).

## layer-export-placement-math (r1 fixed, r2 passed, gate met; r2 lows open)
- Bounds-rule fallback warning misstates its reason when there is no image or the overhang is even
  (src/lib/kit/layer-place.js:140): build the reason from the actual state.
- Validation test checks only the exit code for 15 of 16 cases (test/kit-layer-export-placement-math.test.js:217):
  assert each message names the field.

## entrance-choreography-kinds (r1 fixed, r2 passed, gate met; r2 lows open)
- A symlink to /proc/self/fd/0 still reads stdin through --file (src/lib/kit/entrance.js:197): resolve the link chain
  hop by hop, or compare fh.stat dev/ino with fd 0, and refuse.
- An override can end a grow kind at scale 0 (src/lib/kit/entrance.js:68): allow the 0 only in override.from.
- The /dev/stdin test leaks an unclosed FileHandle (test/kit-entrance-choreography-kinds.test.js:268).

## keyframe-track-story-engine (r1 passed and fixed, r2 passed, gate met; r2 findings open)
- check/sample without --file blocks forever on a terminal stdin (src/lib/kit/keyframes.js:197): refuse a TTY, exit 1 (medium).
- Emitted createLoop silently freezes when loop_ms is missing or invalid (keyframes.js:103): throw (medium).
- A story id or property named __proto__ vanishes from sample output (keyframes.js:335): null-prototype objects (low).
- createLoop can never restart after onFrame throws (keyframes.js:128) (low).

## deterministic-frame-capture (r1 failed and fixed, r2 and r3 passed, gate met; r3 findings open)
- A stalled local resource hangs each screenshot 30 s and fails with a raw Playwright error
  (src/lib/kit/frame-capture.js:362): wrap per-frame calls in a one-line KitExit 1 naming the frame (medium).
- Blocked non-local requests are aborted silently (frame-capture.js:219): report blocked origins in the result (low).
- Only `playwright` is resolved; fall back to @playwright/test and playwright-core for strict installs (frame-capture.js:294) (low).

## Allowance raise (2026-10-26, Dani chose "Raise to 200 steps")
The seven helper allowances opened at 40 steps were raised to 200 steps (cost unchanged at 1.5M), keeping what was
spent. Streams blocked or carried for lack of steps resume their own review loop: sample-content, word-reveal,
fidelity, motion-plan. Landing and intake stay closed with findings carried.

## sacred-background-preservation (r1 and r3 failed and fixed, r4 and r5 passed, gate met; r5 findings open)
- Single-colon pseudo-elements (:before, :after, :first-line) are judged as state rules on the background element
  (src/lib/kit/bg-fill.js:310): treat them like `::` as a separate layer (medium).
- Turning off a fixed parallax background under prefers-reduced-motion is blocked (bg-fill.js:596): allow
  background-attachment: scroll there only (low).

## context-split-showcase-or-website (motion-plan; r2 and r3 passed, gate met; r3 low open)
- The redirected-stdin /dev/stdin test spawns cli.js by a cwd-relative path and checks only exit 1, so a missing
  module also passes (test/kit-context-split-showcase-or-website.test.js:715): resolve from import.meta.url and
  assert stderr names /dev or /proc.

## tagline-word-reveal-on-scroll (r3 and r4 passed, gate met; r4 low open)
- The second packaged test never asserts pkg.egress() is empty
  (test/kit-tagline-word-reveal-on-scroll-packaged.test.js:769).

## reference-frame-fidelity-check (r2 and r3 passed, gate met; r3 medium open)
- Same-file check compares Number inodes, so precision loss or ino 0 can wrongly refuse --diff-out and turn a
  blocking exit 2 into exit 1 (src/lib/kit/fidelity.js:493): use bigint stats and ignore ino 0n.

## Integration allowance raise (2026-10-27, Dani chose "Raise to 400 steps")
The integration helper allowance went from 200 to 400 steps (cost unchanged at 1.5M), keeping what was spent.
