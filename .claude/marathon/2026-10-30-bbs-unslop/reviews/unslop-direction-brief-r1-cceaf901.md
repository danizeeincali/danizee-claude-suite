# Review cceaf901-aa90-4363-9eb7-7eab19b6a150 — unslop-direction-brief, round 1

- Commit: 253ca5c
- Angle: one input method at a time
- Result: over tolerance
- 2 findings

## High (1)

- **from-brief on real assume output prefills product from assumed placeholders and marks it done** — `src/lib/kit/direction.js:286` (correctness): The header says from-brief accepts design-brief's assume output ({ kind, brief }). Real assume output always fills every field, using the kind's default text for any answer that is missing, and lists those defaults in \`assumptions\`. fromBrief ignores \`assumptions\`, so offer and audience always look answered. Probe: \`echo '{"kind":"ui","answers":{}}' | cli.js design-brief assume | cli.js direction from-brief\` returns product.text "one clear job for the screen, taken from the request, for a regular user on desktop and phone, so the layout is responsive and moderately dense." with todo: false and prefilled: \["product"\]. The same happens when only the offer was given: the audience becomes the default string. So the skeleton presents generic filler as the user's product line and tells them it needs no answer, which defeats the verb's purpose on a documented input. The unit test 'accepts the assume output shape' uses a made-up { kind, brief: { offer } } that real assume never produces, which is why the bug was missed. — fix: When the input has \`brief\`, treat each field named in \`assumptions\[\].field\` as missing (do not prefill offer or audience from it, set todo: true and add a note). Add a test that pipes real \`assume()\` output (from design-brief.js) through fromBrief, with no answers and with offer only.

## Medium (1)

- **JSON moments array is re-split on 'and' and commas, so two moments count as three** — `src/lib/kit/direction.js:277` (correctness): fromJson joins a moments array with '; ' and judge() then counts items() on the joined string. items() also splits on ',', 'and', '&' and '+', so a moment written as an array element is split again. Probe: moments \["the total and subtotal row", "the print button"\] gives too\_many\_moments (counted as 3) even though the user gave exactly two places. The array form is the one input where the count is known for certain, yet it gets the heuristic's false positives, and with --strict it exits 2. — fix: Keep the array length from fromJson (for example store values.\_\_count.moments = v.length) and use it for the too\_many\_moments check instead of items(); add a test with an array element that contains 'and'.
