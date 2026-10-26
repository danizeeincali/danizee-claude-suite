# Review d1468671-7360-4ef2-ac9e-40e0ad3765e7 — type-scale-snapping-to-tailwind-steps, round 2

- Commit: 9295885
- Angle: r2
- Result: pass
- 3 findings

## Medium (2)

- **One zero or overflowing size aborts the whole audit** — `src/lib/kit/type-scale.js:82` (correctness): auditCss sends every px/rem match to snap(), and parseSize throws KitExit 1 for a value that is not positive and finite. So a single \`font-size: 0px\` (a common inline-block whitespace trick), \`text-\[0px\]\`, or a size whose digits overflow to Infinity makes the whole audit exit 1 with 'size must be a positive finite number'. No line number is given and none of the other findings are reported. Confirmed: auditCss('.a{font-size:0px}\n.b{font-size:15px}') throws instead of reporting line 2. The verb is advisory, and one odd declaration should not hide the rest of the file. — fix: In auditCss, check the parsed value before calling snap (or catch the KitExit) and push a skipped entry such as { line, value, reason: 'not a positive size' }. Add a unit test with 0px next to an off-scale size.
- **Unclosed text-\[ openers make the class scan quadratic** — `src/lib/kit/type-scale.js:68` (performance): The regex /(?\<!\[\w-\])text-\\[(\[^\\]\s\]\*)\\]/g scans forward from each \`text-\[\` until it reaches whitespace or \`\]\`. When neither comes, every opener rescans to the end of the run. Measured: 'text-\['.repeat(50000), which is 300 KB, takes 19.8 s, so near the 8 MiB cap it would take hours. rules.md 'Linear time on capped input' forbids a regex that rescans to the end of the input for each unclosed opener, and it requires a timing test of about 2 MB of adversarial input that finishes in under 2 s. The only timing test here ('counts lines in linear time') uses well-formed declarations, about 700 KB, with a 3 s limit. — fix: Find each \`text-\[\` with indexOf, look for the closer with indexOf('\]', start) bounded by the next whitespace, and stop at the first miss. Add a timing test with about 2 MB of repeated 'text-\[' (and of ' font-size') that must finish in under 2 s.

## Low (1)

- **audit with no --file at a terminal waits forever** — `src/lib/kit/type-scale.js:145` (correctness): run() reads stdin whenever --file is absent and never checks io.stdinIsTTY. Running \`type-scale audit\` without piping input or passing --file therefore blocks with no message. Other kit verbs (graph, lenses, guarded-fs, reflect, exit-codes) refuse a TTY stdin with exit 1 and a hint. — fix: Before reading stdin, add: if (io.stdinIsTTY) throw bad(\`audit reads CSS from --file or piped stdin, not a terminal\n${usage}\`). Add a unit test with stdinIsTTY: true.
