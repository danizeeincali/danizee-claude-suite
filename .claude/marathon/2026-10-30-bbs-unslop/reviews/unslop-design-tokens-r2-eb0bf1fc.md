# Review eb0bf1fc-89dd-4af2-8790-3008d626cd2c — unslop-design-tokens, round 2

- Commit: ea9b5d8
- Angle: failure conditions and error paths
- Result: pass
- 2 findings

## Medium (1)

- **TOO\_MANY\_SHADOWS fires on a stylesheet that only uses the sheet's own two shadow tokens** — `src/lib/kit/design-tokens.js:339` (correctness): The counter adds one for every box-shadow declaration that is not none/inherit/initial/unset, so three rules that each say box-shadow: var(--shadow-sm) or var(--shadow-md) count as three shadows. Probed: '.a{box-shadow:var(--shadow-sm)} .b{box-shadow:var(--shadow-md)} .c{box-shadow:var(--shadow-sm)}' gives TOO\_MANY\_SHADOWS at line 3, ok:false, and check --strict exits 2, with a fix text that tells the user to use --shadow-sm and --shadow-md, which they already do. Any real app that follows the emitted sheet (cards, menus, modals) puts more than two box-shadow declarations in its CSS, so the lint fails on exactly the input it is meant to approve, and in a --strict gate that is a false failure. The 'checks the emitted sheet clean' test only lints the sheet itself, never CSS that uses it. The header's 'reported at the third' declaration and the fix text's 'at most two quiet shadows' disagree on what is counted. — fix: Count distinct shadow values, not declarations: normalise the value (lowercase, collapse spaces, strip !important) into a Set, skip pure var(--...) references (or count each distinct var name once), report when the Set reaches 3; update the header to say 'more than 2 distinct box-shadow values', and add a test with three rules using var(--shadow-sm)/var(--shadow-md) that stays ok.

## Low (1)

- **box-shadow: none !important is counted as a shadow** — `src/lib/kit/design-tokens.js:339` (correctness): The exemption test /^(none|inherit|initial|unset)$/i runs on the raw value, so 'box-shadow: none !important' and 'box-shadow:none!important' (the common reset utility) count toward TOO\_MANY\_SHADOWS (probed: two such resets plus one real shadow give TOO\_MANY\_SHADOWS). This is the same !important gap r1 fixed for spacing; spacing and font-weight now strip it, box-shadow does not. — fix: Strip a trailing \s\*!important from value before the none/inherit/initial/unset test, and add a case with 'box-shadow:none!important' to the shadow test.
