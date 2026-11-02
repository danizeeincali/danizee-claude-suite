# Review 4ccfbc1f-0442-4731-bca5-b18750a59300 — unslop-visual-direction, round 1

- Commit: 6416a87
- Angle: one input method at a time
- Result: pass
- 5 findings

## Medium (1)

- **One-sentence check rejects abbreviations, times and quoted periods, and prompt then exits 1** — `.claude/helpers/kit/visual-direction.js:82` (correctness): The regex /\[.!?\]\["')\\]\]\*\s+\S/ treats any terminator followed by a space as a second sentence. Valid single sentences such as 'Mr. Lee shapes a clay bowl at a wooden bench in low morning sun.' or 'A kettle at 3 p.m. in sun on a stove.' get not-one-sentence. Probed through stdin: \`sentence\` reports ok:false and \`prompt\` refuses with exit 1 ('sentence fails the check: not-one-sentence'), so a realistic input cannot get a prompt at all. The comment says only abbreviations without a space are allowed, which leaves out the common case. No test covers it. — fix: Count a terminator as a sentence break only when the next word starts with an uppercase letter and the token before it is not a known abbreviation (Mr, Mrs, Dr, St, a.m., p.m., e.g., i.e.) or a single letter. Add tests for 'Mr. Lee ...' and '3 p.m. in ...'.

## Low (4)

- **Usage string says 'advisory, exit 0' for all three subcommands** — `.claude/helpers/kit/visual-direction.js:42` (docs): The usage text printed on every argument error says '(advisory, exit 0)'. Only the problems that \`sentence\` finds are advisory. \`prompt\` exits 1 when the sentence fails, and every subcommand exits 1 on bad input, as the header at lines 30-33 says. — fix: Change it to something like '(JSON on stdin or --file; exit 0 answer, 1 bad input; sentence problems are advisory)'.
- **Style list differs from the power brief, and the banned list includes a style the brief names** — `.claude/helpers/kit/visual-direction.js:49` (facts): The power brief's style list is painted background, cinematic object, soft 3D, product object render, light and optics, engraving. STYLES is photo/illustration/render/collage, and BANNED (line 65) includes 'cinematic', which the brief names as an acceptable style. The brief says 'such as', so the list is not binding, but a reader comparing the two sees a contradiction that neither the header nor the tests explain. — fix: Either line the style list up with the brief's examples, or add a line in the header saying why the set differs and why 'cinematic' is banned in the sentence but not as a style.
- **Exported functions fail badly when a code caller passes a non-object or a missing argument** — `.claude/helpers/kit/visual-direction.js:98` (correctness): decide, checkSentence and buildPrompt are exported as a direct-call API, but only run() checks the input shape. Probed: decide(null) throws a raw TypeError ("Cannot use 'in' operator") instead of a KitExit. checkSentence(undefined) checks the literal string 'undefined' (line 75 String(sentence)) and returns a misleading no-concrete-subject result. — fix: At the top of decide/buildPrompt, \`if (!isObj(ctx)) throw bad('context must be an object')\`. In checkSentence, treat a non-string as empty, or throw bad().
- **Duplicate 'cool' entry in STOP set** — `.claude/helpers/kit/visual-direction.js:67` (other): 'cool' is listed twice in the STOP array. The Set makes the duplicate harmless, but it is a sign the list was not reviewed. — fix: Remove the second 'cool'.
