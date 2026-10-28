# Review 5f2f620a-6057-4c1f-8573-4df77e31ad4c — tagline-word-reveal-on-scroll, round 3

- Commit: a93261a
- Angle: correctness
- Result: pass
- 2 findings

## Medium (1)

- **Early IntersectionObserver builds without isIntersecting leave the tagline dimmed for good** — `src/lib/kit/word-reveal.js:111` (correctness): The script feature-detects only typeof IntersectionObserver. After that, the observer callback reveals a block only when entry.isIntersecting is true or passed(entry) is true. The first shipped IntersectionObserver builds (Chrome 51-57, Edge 15) have the observer but not entry.isIntersecting, so the property is undefined. On those builds, a block scrolling in from below is never revealed: passed() is false because its top is below rootBounds.top. The script has already added wr-js, so every word stays at the muted opacity (0.25 by default) forever. I confirmed this with a vm harness: an entry with intersectionRatio 0.5, no isIntersecting and top 300 leaves all words unlit. The 'no IntersectionObserver' fallback exists to cover older environments, but this partial-support case falls between the two paths. The mirror copy at .claude/helpers/kit/word-reveal.js:111 has the same bug. No test fires an entry without isIntersecting. — fix: Treat an entry as visible when es\[j\].isIntersecting || es\[j\].intersectionRatio \> 0 || passed(es\[j\]). Another option is to take the all(root) fallback when !('isIntersecting' in IntersectionObserverEntry.prototype). Add a harness test that fires an entry without isIntersecting.

## Low (1)

- **Printing before the reveal prints the tagline at muted opacity** — `src/lib/kit/word-reveal.js:92` (accessibility): The muted opacity applies under .wr-js on every medium, and the only override is the prefers-reduced-motion query. A page printed or saved as PDF before the block has scrolled past the trigger line (for example, printing straight from the top of a long page) renders the unrevealed words at 0.25 opacity, which is faint and low contrast on paper. Print is a static output with no scroll, so the reveal can never happen there. — fix: Add '@media print{.wr-js .wr-w{opacity:1;transition:none}}' next to the reduced-motion override, and assert it in the markup test.
