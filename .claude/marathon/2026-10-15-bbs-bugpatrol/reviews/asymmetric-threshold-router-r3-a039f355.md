# Review a039f355-50b2-4000-94c2-3dfdb3bae7cf — asymmetric-threshold-router, round 3

- Commit: 038d3cd
- Angle: older environments and degraded networks
- Result: pass
- 1 findings

## Low (1)

- **UTF-16 input from Windows PowerShell 5.1 still fails as 'input is not valid JSON'** — `src/lib/kit/threshold-route.js:173` (correctness): The r2 fix strips only a UTF-8 BOM. Windows PowerShell 5.1, still the default shell on many Windows machines, writes UTF-16LE with an FF FE BOM for Out-File and for the \> redirect (e.g. ConvertTo-Json ... \> in.json). run() reads the file as utf-8, so the text starts with replacement characters and NUL bytes and JSON.parse fails. Confirmed: a UTF-16LE file holding \[{"id":"r","deterministicRegression":true}\] passed with --file to .claude/helpers/kit/cli.js threshold-route gives 'kit: input is not valid JSON' and exit 1, so the regression in it never reports blocks. The failure is loud, not silent, and the message gives no hint that the encoding is the problem. Same code in .claude/helpers/kit/threshold-route.js:173. — fix: Read the file (and stdin via io.stdinBytes) as bytes. If it starts with FF FE or FE FF, decode it as UTF-16 (TextDecoder('utf-16le') / ('utf-16be')); otherwise decode as UTF-8 and strip a leading U+FEFF. Or, at least, detect FF FE / FE FF and throw 'input is UTF-16; save it as UTF-8'. Add a test with a UTF-16LE file.
