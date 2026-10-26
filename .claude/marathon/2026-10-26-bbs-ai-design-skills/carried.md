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

## realistic-sample-content-rules (r1 over and fixed, r2 passed; streak 1 of 2; allowance steps used up)
- Open from r2: quadratic lineOf (medium), vague-error accepts description words as a next step (medium), unclosed
  tag regexes quadratic (low), deep JSON nesting overflows the walker (low). The integration stream fixes these and
  runs the stream's second clean review before wiring the verb.

## type-scale-snapping-to-tailwind-steps (r1 and r2 passed, gate met; r2 findings open)
- One zero or overflowing size aborts the whole audit (medium); unclosed `text-[` openers make the class scan
  quadratic (medium); audit at a TTY waits forever (low).
