# Review 2b40afe2-1d59-414f-a236-5b0e034ba7f9 — unslop-design-tokens, round 1

- Commit: bd1acbc
- Angle: one input method at a time
- Result: pass
- 6 findings

## Medium (1)

- **--accent #000000 (light) or #ffffff (dark) gives a hover equal to the base** — `src/lib/kit/design-tokens.js:191` (correctness): hover is oklchToRgb(clamp01(ao.L +/- 0.06), ...). For a black accent in light mode L is already 0, and for a white accent in dark mode L is already 1, so the clamp leaves L unchanged and --color-accent-hover is the same colour as --color-accent (probed: emit --accent '#000000' gives base #000000, hover #000000; emit --accent '#ffffff' --mode dark gives base #ffffff, hover #ffffff). Black and white are real brand accents for monochrome brands, and the sheet then has no visible hover state. Tests only use #e11d48. — fix: When the shifted L hits the clamp (or the result equals the base), move L the other way instead, and add a test with --accent #000000 and --accent #ffffff --mode dark asserting hover !== base.

## Low (5)

- **A grey --accent sets the ramp hue from rounding noise** — `src/lib/kit/design-tokens.js:246` (correctness): With only --accent given, the ramp hue is rgbToOklch(accent).h. For an achromatic accent (#ffffff, #808080) C is about 0 and h comes from atan2 of float noise: both probe to hue 89.9, so a monochrome brand gets a yellow-tinted ramp it never asked for; #000000 gives 0 (reddish). The header promises 'the hue of --accent', which a grey does not have. — fix: If the accent's OKLCH chroma is below a small threshold (e.g. 0.02), fall back to DEFAULT\_HUE for the ramp, and note it in notes.
- **--hue 359.95 to 359.99 is accepted and reported as hue 360** — `src/lib/kit/design-tokens.js:247` (correctness): The --hue check accepts any value below 360, then emit rounds to one decimal, so --hue 359.99 prints "hue": 360 and a 'hue 360' css header, outside the documented 0-359 range. — fix: Take the rounded value modulo 360 (h = (Math.round(h \* 10) / 10) % 360).
- **OFF\_GRID\_SPACING misses px values glued to !important** — `src/lib/kit/design-tokens.js:312` (correctness): Spacing tokens are split on whitespace and matched with /^(-?\d\*\.?\d+)px$/, so 'margin:5px!important' (the minified form) is never flagged, while 'padding:6px !important' is (probed). font-weight strips !important first, so the two rules disagree on the same input. — fix: Strip a trailing \s\*!important from value before splitting, as the font-weight branch already does.
- **The 8 MiB cap is tested on stdin only, not on --file** — `test/kit-unslop-design-tokens.test.js:251` (test-quality): openRegular has its own read loop and its own 'larger than 8 MiB' check (design-tokens.js lines 381-388), but no unit or packaged test passes an oversize file with --file; both oversize tests go through stdin. The unit io helper also never supplies stdinBytes, so the byte path the real CLI uses runs only in the packaged test. — fix: In 'reads --file and matches stdin', write a MAX\_BYTES + 1 file and assert exit 1, plus one exactly MAX\_BYTES file that is accepted.
- **An empty --file gets the stdin hint** — `src/lib/kit/design-tokens.js:445` (docs): check --file e.css on an empty or whitespace-only file fails with 'no input: pass CSS on stdin or --file', which reads as if --file was not given at all, and does not name the file. — fix: When f.file is set, say '\<path\> is empty' instead.
