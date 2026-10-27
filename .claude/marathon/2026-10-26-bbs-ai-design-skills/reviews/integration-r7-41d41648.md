# Review 41d41648-515a-4fff-be2f-0924c618574a — integration, round 7

- Commit: 0f6efea
- Angle: correctness
- Result: pass
- 2 findings

## Medium (1)

- **page.html that starts with front matter or an XML prolog is now checked as markdown and every section goes missing** — `src/lib/kit/landing-sections.js:246` (correctness): The type used to come from the extension, so \`check --file page.html\` always parsed HTML. The run() change dropped the extension and sniff() now calls a file HTML only when its first non-comment text is \`\<!doctype\` or \`\<letter...\`. An .html page that starts with anything else is parsed as markdown, finds no headings and reports every section missing with every cta flag false, still exit 0. Common examples are a Jekyll/Hugo/Eleventy page with \`---\` front matter, an XHTML file starting \`\<?xml ...?\>\`, and a template starting with \`{% extends %}\` or \`\<?php\`. Probe on the same fixture: base 5dc3143 gives found \[hero, faq, final-cta\] and cta {hero: true, final: true, mirrors: true}. HEAD gives found \[\], missing \[hero, problem-solution, benefits, how-it-works, social-proof, final-cta\] and cta all false. The same happens with the \`\<?xml\` prolog. Users who relied on the documented \`--file \<page.html\>\` form now get a silently wrong advisory result. This is not the r2 finding (pages that open with \`\<meta\>\` or \`\<title\>\`, which the broadened tag list fixed) or the r3 one (markdown read as HTML, which \`--format md\` fixed). — fix: Use the extension again for --file when --format is absent (.html/.htm means html, .md/.markdown/.txt means md), and sniff only stdin and unknown extensions. Or have sniff skip a leading front-matter block and \`\<?...?\>\`/\`{%...%}\` prologs. Add a unit test for a front-matter .html page and an \`\<?xml\` .html page.

## Low (1)

- **Marathon step 4.3b is inserted before the existing 4.3a** — `src/plugins/dot-shortcuts.js:5017` (docs): The new design-kit loop step (and the fidelity paragraph after it) sits between 4.3 Build and 4.3a Integration stream, so the CHECKPOINT 4 sequence now reads 4.3, 4.3b, 4.3a, 4.4. At base 4.3a followed 4.3 directly. A reader or agent walking the steps in order sees the labels out of sequence, and 4.3a no longer follows the Build step it extends. The existing steps keep their meaning, so this is ordering only. — fix: Move the 4.3b paragraph and its fidelity block below 4.3a (just before 4.4), or renumber them 4.3c so the labels stay in order.
