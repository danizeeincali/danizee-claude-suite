# Review 33b2b10b-cf72-4565-82ec-aa01c64216ae — realistic-sample-content-rules, round 3

- Commit: 3f7eafa
- Angle: correctness
- Result: pass
- 2 findings

## Medium (1)

- **UTF-16 input (Windows PowerShell 5.1 output) is decoded as UTF-8 and silently reported clean** — `src/lib/kit/sample-content.js:358` (correctness): run() always decodes with buf.toString('utf-8') and strips only a UTF-8 BOM. Windows PowerShell 5.1, still the default shell on many Windows machines, writes UTF-16LE with a BOM for '\>' and Out-File, so a copy file saved that way is read as NUL-interleaved text. Checked: a UTF-16LE (FF FE) buffer holding 'Lorem ipsum dolor. Acme Corp is revolutionary.' through run(\['lint'\], {stdinBytes}) returns format 'md', findings \[\] and exit 0. The advisory linter tells the user the copy is clean when it has three findings, with no warning. No test covers a non-UTF-8 encoding. — fix: Before decoding, check for a FF FE or FE FF BOM and decode as utf16le (swapping bytes for BE), or refuse with KitExit("input is UTF-16; save it as UTF-8", 1) when the buffer has a UTF-16 BOM or many NUL bytes. Add a unit test with a UTF-16LE buffer.

## Low (1)

- **CR-only line endings put every finding on line 1 and skip markdown headings** — `src/lib/kit/sample-content.js:69` (correctness): Lines are found only by '\n' (lineIndex at line 69 and headings() at line 138). A file with classic Mac CR-only line endings, which some older editors and exports still write, is read as one line. Checked: 'Intro\r\rLorem ipsum here\r# Get Started With Us\r' reports lorem at line 1 and gives no title-case finding, because the '#' is not at the start of a line. CRLF works. — fix: Normalise lone '\r' to '\n' in run() before linting (for example raw.replace(/\r(?!\n)/g, '\n')). Character offsets stay the same, so line numbers hold.
