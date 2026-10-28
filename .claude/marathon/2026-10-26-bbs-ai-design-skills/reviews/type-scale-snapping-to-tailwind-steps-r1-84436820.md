# Review 84436820-5e08-4f10-bdbe-deed99d00a8a — type-scale-snapping-to-tailwind-steps, round 1

- Commit: e5f423b
- Angle: one input method at a time
- Result: pass
- 5 findings

## Medium (2)

- **Inline style font-size in markup is missed or mis-skipped** — `src/lib/kit/type-scale.js:67` (correctness): The header says audit reads a 'CSS/markup file', but the declaration regex only matches font-size after ^, ;, { or whitespace and captures up to ;, } or newline. For \<p style="font-size:15px"\> (font-size directly after the quote) nothing is reported: changes \[\], on\_scale 0, skipped \[\]. For style="color:red;font-size:15px"\> the value captured is '15px"\>', so it lands in skipped as 'not a px or rem size' when it should be a change to sm. Confirmed by running auditCss on both strings. Off-scale inline sizes in HTML/JSX templates are silently passed over. — fix: Add quote characters to the lead-in class (\[;{\s"'\]) and stop the value at quotes too (\[^;}\n"'\]\*); add a unit test with style="font-size:15px" and style='a:b;font-size:15px'.
- **Line numbering is quadratic; audit takes about a minute on a 1 MB file** — `src/lib/kit/type-scale.js:75` (performance): lineAt rescans the text from index 0 for every hit, so the cost is O(hits x size). Measured: 50,000 font-size declarations in a 950 KB file took 64.8 s. The verb accepts files up to 8 MiB, where the same density would run for over an hour, which looks like a hang to the caller. — fix: Hits are already sorted by idx: walk them once and count newlines incrementally from the previous hit's index (or precompute newline offsets and binary-search).

## Low (3)

- **Stdin is read in full before the 8 MiB cap is checked** — `src/lib/kit/type-scale.js:132` (performance): io.stdin() is called without { maxBytes }, so cli.js buffers all of stdin into memory before the Buffer.byteLength check runs. The --file path checks st.size first, but piped input does not, so the cap does not bound memory on the stdin path. — fix: Call io.stdin({ maxBytes: MAX\_BYTES }) so the reader stops once it passes the cap; the existing byteLength check then rejects it.
- **Tailwind text-\[length:15px\] font sizes are dropped silently** — `src/lib/kit/type-scale.js:79` (correctness): In Tailwind, text-\[length:\<value\>\] is the explicit font-size form of an arbitrary text class. The code treats anything that is not a bare px/rem/var/calc/% as a colour class and continues, so text-\[length:15px\] gets no change, no on\_scale count and no skipped entry. The comment wrongly calls these 'not sizes'. — fix: Strip a leading 'length:' prefix from the arbitrary value before the px/rem test, and add a test for it.
- **--file "" silently falls back to stdin** — `src/lib/kit/type-scale.js:121` (correctness): parse accepts an empty string as the value of --file, and the truthiness check \`if (flags.file)\` then reads stdin instead of failing. From a script that passes an empty variable, this audits whatever is on stdin, or gets 'no input' with a misleading message. — fix: Test flags.file !== undefined, and reject an empty --file value in parse with KitExit 1.
