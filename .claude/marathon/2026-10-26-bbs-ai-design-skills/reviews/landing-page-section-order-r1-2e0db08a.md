# Review 2e0db08a-5bde-411d-845a-f94c524bb68d — landing-page-section-order, round 1

- Commit: 8f4fc06
- Angle: one input method at a time
- Result: pass
- 4 findings

## Medium (2)

- **stdin sniff treats a markdown spec as HTML when it has any section/div with an id** — `src/lib/kit/landing-sections.js:181` (correctness): The second regex in sniff() matches \`\<section|div|header|main|body|html ... id=|data-section=\` anywhere in the text, including inside fenced code blocks and inline HTML. A markdown spec that shows example markup is checked as HTML, so its headings are ignored. Confirmed: a spec with '## Hero', '## Benefits', '## Final CTA' and a fenced \`\<section id="faq"\>\` gives found \[hero, benefits, final-cta\] via --file spec.md but found \[faq\], missing \[hero, ...\], cta all false on stdin. The same document gets a wrong result depending only on how it was passed in. Files with an unknown extension (.mdx, none) go through the same sniff. — fix: Sniff HTML only from a leading tag (the first regex), or strip fenced code before the attribute test; add a stdin test with markdown that contains a fenced HTML snippet.
- **8 MiB stdin cap is not enforced: reads all of stdin, then counts UTF-16 chars instead of bytes** — `src/lib/kit/landing-sections.js:215` (correctness): The contract caps input at 8 MiB. The --file path checks st.size in bytes, but the stdin path calls io.stdin() with no { maxBytes }, so cli.js reads the whole stream into memory before any check. It then compares text.length (UTF-16 code units) to MAX\_BYTES. Confirmed: 10 MiB of 'é' (5.2M chars) is accepted on stdin, while the same file through --file is rejected. The unit test only uses ASCII 'x', so it cannot catch this. — fix: Use \`await io.stdinBytes({ maxBytes: MAX\_BYTES })\` (as other kit verbs do), reject when buf.length \> MAX\_BYTES, then decode; add a multibyte over-cap stdin test.

## Low (2)

- **Repeated --file silently keeps the last one** — `src/lib/kit/landing-sections.js:197` (correctness): \`check --file a.md --file b.md\` overwrites \`file\`, so a.md is never checked and nothing reports it. The caller believes two inputs were checked, or does not know which one was. — fix: Throw bad('--file given more than once') when file is already set.
- **Stdin size-cap test uses only single-byte input** — `test/kit-landing-page-section-order.test.js:171` (test-quality): The over-cap test feeds 8 MiB + 1 of ASCII 'x', where chars and bytes are the same count, so the test passes even though the stdin cap counts characters, not bytes. A stub io.stdin that ignores maxBytes also passes, so it never checks that the read is bounded. — fix: Add a multibyte case (e.g. 'é'.repeat(4.5 MiB) chars) and have the stub stdin assert it is called with maxBytes.
