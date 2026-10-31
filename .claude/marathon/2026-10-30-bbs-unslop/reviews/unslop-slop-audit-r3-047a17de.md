# Review 047a17de-0b75-41bc-a2d5-ed6dc38a189e — unslop-slop-audit, round 3

- Commit: 335bf53
- Angle: older environments and degraded networks
- Result: pass
- 2 findings

## Medium (1)

- **JSX scan goes exponential when an attribute expression's brace is never closed (truncated or mid-edit file)** — `src/lib/kit/slop-audit.js:316` (performance): When an attribute value \`{...}\` has no matching \`}\` (a file cut off by a dropped pipe or partial download, or a component in the middle of an edit, which /w-marathon scans on every loop pass), scanCode runs to the end of the text and parseElement returns -1 (lines 303, 316). The caller's scanCode (lines 359-362) then moves on one character and parses every nested element inside that attribute a second time, and each nested level fails the same way. The cost doubles with each level of attribute nesting: T(d) = 2\*T(d-1). Measured: a 361-byte file (\`export default () =\> {\` followed by \`return \<a b={\` 26 times) blocks \`cli.js slop-audit scan --strict --file x.jsx\` for 42 s, and each extra level doubles that. A realistic render-prop page cut off mid-body (\`\<SlotN render={(p) =\> \` nested 8 deep, 2 MB body) takes 5.5 s against about 20 ms when balanced, and 12 levels on 50 KB takes 2.1 s. A slow CI box makes this worse, and there is no timeout: the blocking gate stalls on input that the 8 MiB cap lets through. — fix: Make failure cheap and remembered: when scanCode(k+1, true) reaches n inside an attribute, treat the element as running to the end of the text (return n) and do not return -1. Or keep a Set of '\<' offsets already tried and failed, and skip them in scanCode and in the children loop. Add a test that a truncated, 30-deep \`\<a b={\` input finishes in well under a second.

## Low (1)

- **Deep JSX nesting overflows the stack and exits 1 with a bare 'Maximum call stack size exceeded'** — `src/lib/kit/slop-audit.js:342` (correctness): parseElement and scanCode recurse once per nesting level, with no depth bound. Text sniffed or forced as jsx that holds about 3000 unclosed elements, such as \`\<p\>text\<br\>\` lines in an HTML-ish fragment that contains \`className=\`, throws RangeError at around 60 KB. The CLI catches it as a generic error and prints \`kit: Maximum call stack size exceeded\`, exit 1. That is not one of the documented bad-input messages, and it says nothing about the input. The threshold is lower where the default stack is smaller. — fix: Cap recursion depth in parseElement (for example 500) and treat anything deeper as text. Or catch RangeError around jsxVisible and rethrow it as KitExit('jsx nesting too deep to scan', 1).
