# Review 71f38a12-e4e1-4c0e-9f99-7ead5d6b2c1e — unslop-story-video-authoring, round 7

- Commit: 5823ebd
- Angle: performance and memory
- Result: pass
- 2 findings

## Medium (1)

- **scanPage goes quadratic on script/style open tags inside a title/textarea/xmp** — `src/lib/kit/story-plan.js:412` (performance): closeAt() calls lower.indexOf('\</name', after) directly and memoizes only a missing close (noClose). When a \<script\>/\<style\>/\<iframe\>... open tag sits before an armed fence (inside \<title\>, \<textarea\> or \<xmp\> text) and its close lies past that fence, the close is found but rejected (c \> f), only the open tag is dropped, and the next open tag rescans the same span again. Measured: '\<title\>' + '\<script\>'.repeat(N) + '\</title\>\</script\>' takes 0.9s at N=20k, 3.6s at 40k, 14.4s at 80k (640 KB); the 8 MiB cap allows ~1M tags, about an hour. A less contrived page, a 2 MB page whose \<textarea\> shows 2000 '\<script src=...\>' lines with one real script later, takes 2.3s and grows with tags x page size. The header and the tests (lines 345, 530, 559 of the test file) promise one linear pass, and the finder() memo exists for exactly this, but closeAt bypasses it. — fix: Route closeAt through the existing find() memo (find(\`\</${name}\`, from)), which returns the cached position while from stays below it, and add '\<title\>'+'\<script\>'.repeat(n)+'\</title\>\</script\>' (and the \<style\> form) to the 8 MiB linearity test.

## Low (1)

- **pseudo-element probe regex is quadratic in a long selector run** — `src/lib/kit/story-plan.js:854` (performance): /#story-body\[^{},\]\*::?before/i (and the ::after form) is tested against the scoped page CSS. For every #story-body it scans greedily up to the next { } or , and then backtracks, so a selector made of many body compounds ('body body body ... {}') costs O(n^2): emit took 23ms, 63ms and 219ms for 1k, 2k and 4k compounds (20 KB), so a few hundred KB of that hangs emit. Real stylesheets do not contain selectors this long, so this is minor, but it is one more spot outside the module's linear claim. — fix: Split the scoped CSS into selector runs (text between braces/commas) once and test each run with a non-backtracking check, or anchor the probe to the pseudo-element (/::?before\[^{},\]\*$/ per run after locating #story-body); add a long-selector case to the linearity test.
