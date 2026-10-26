# Review 1aee0cf9-b623-4ae0-bd85-78446ae7f3ba — sacred-background-preservation, round 3

- Commit: ed0df14
- Angle: correctness
- Result: over tolerance
- 4 findings

## High (1)

- **A later plain rule that changes a longhand the design did not set passes** — `src/lib/kit/bg-fill.js:449` (correctness): For a later unconditional, unqualified rule, \`changed\` is true only when the design set the same longhand (\`known\`), or when the later rule is a \`background\` shorthand. If the design uses the shorthand, or does not mention the property, a later longhand override is never flagged. Checked with guard(): \`.bg{background:url(a.jpg) center/cover} .bg{background-image:url(b.jpg)}\`, \`.bg{background:url(a.jpg) center/cover} .bg{background-size:200% 200%}\`, \`.bg{background-image:url(a.jpg)} .bg{background-size:10px}\` and the legacy \`.bg{background:url(a.jpg)} .bg{-webkit-background-size:10px}\` (older WebKit needs the separate prefixed sizing) all return pass:true, exit 0. The contract says exit 2 when any rule changes background-image or background-size, so the blocking judge passes an image swap and a resize on normal CSS. — fix: When \`known\` is undefined and a design exists, treat any later BG\_PROPS declaration as changed. Or expand the design's \`background\` shorthand so it covers image, position and size, and compare against that. Add tests for each case above.

## Medium (2)

- **IE hack declarations (\*background, \_background) are dropped, so legacy flat-colour swaps pass** — `src/lib/kit/bg-fill.js:193` (correctness): decl() keeps a property only when it matches /^-?\[a-z\]\[a-z-\]\*$/, so the old-IE star and underscore hacks are silently discarded. \`.bg{background:url(a.jpg)} .bg{\*background:none}\` and \`.bg{background:url(a.jpg)} .bg{\_background:#000}\` both return pass:true, exit 0 (checked). IE6 and IE7 apply these, which strips the photo in exactly the older environments that legacy CSS targets. The contract asks for exit 2 when any rule replaces the image with a flat colour. — fix: Strip a leading \`\*\` or \`\_\` from the property name (as unprefixed() does for vendor prefixes) before the BG\_PROPS and filter lookups, and add a test for each hack.
- **A fallback colour in an earlier rule becomes the design and fails the photo rule** — `src/lib/kit/bg-fill.js:431` (correctness): The design is the first unconditional rule that sets any background property, even when it sets only a flat colour. A common progressive-enhancement pattern for slow networks and old browsers, \`.bg{background:#333}\` followed by \`.bg{background:#333 url(a.jpg) center/cover}\`, returns exit 2 on line 2, 'the background is changed in a later rule for the same selector' (checked). The rule that actually places the photo is reported as the violation, and a designed fallback blocks the gate. — fix: Choose as the design the first unconditional rule whose background carries an image (url, gradient, image-set), and fall back to the current choice only when there is none. Add a test for the fallback-first pattern.

## Low (1)

- **Line numbers ignore CR-only and form-feed line breaks** — `src/lib/kit/bg-fill.js:131` (correctness): lineIndex() counts only '\n'. CSS treats CR, CRLF and form feed as newlines, so a stylesheet saved with old Mac CR-only line endings reports every violation on line 1. \`.bg{background:url(a.jpg)}\r.bg:hover{background:#000}\` reports line 1 for a declaration on line 2 (checked). — fix: Normalise \r\n, \r and \f to \n before masking (this keeps offsets for LF and CR files), or count a lone \r as a line start in lineIndex.
