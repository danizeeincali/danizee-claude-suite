# Review fb7fc899-d2fa-419a-963a-d254f43f2a8d — sacred-background-preservation, round 4

- Commit: b16ad77
- Angle: security
- Result: pass
- 1 findings

## Medium (1)

- **transition value split is quadratic, so one capped input hangs the blocking judge** — `src/lib/kit/bg-fill.js:491` (performance): transitionProps() splits each transition item with /\s+(?!\[^(\]\*\))/. At every whitespace run the lookahead scans \[^(\]\* to the end of the value when there is no '(', so a long transition value with many spaces is O(n^2). Measured with guard() on '.bg{background:url(a.jpg)} .bg{transition:' + 'a '.repeat(n) + '}': 40 KB takes 0.9 s, 80 KB 2.9 s, 160 KB 11 s. About 2 MB, well under the 8 MiB cap, would run for tens of minutes. A gate that hangs gives no verdict at all, so it neither fails closed nor meets rules.md 'Linear time on capped input'. The timing suite (test/kit-sacred-background-preservation.test.js:276) covers braces, animations/keyframes, url( and quotes, but not transition values, which is why this was missed. No egress, secret exposure or sandbox escape was found: the verb opens no sockets or child processes and writes nothing; --file is read-only, bounded and refuses /dev and /proc; and the output carries no file values. — fix: Tokenise with the existing depth-tracking topTokens() (or a single forward walk) instead of the lookahead regex, and add a 2 MB 'transition: a a a ...' case (also one with transition-property) to the timing suite.
