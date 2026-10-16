# Review 86cb21b7-04ef-440d-9d60-2b06930ca009 — two-pass-finding-clustering, round 3

- Commit: abee777
- Angle: older environments and degraded networks
- Result: pass
- 1 findings

## Low (1)

- **BOM fix covers only UTF-8: a UTF-16 findings or answers file from Windows PowerShell 5.1 is reported as 'not valid JSON'** — `src/lib/kit/cluster.js:256` (correctness): readJsonFile always decodes as utf-8 and strips only U+FEFF. Windows PowerShell 5.1, still the default shell on Windows 10/11, writes UTF-16LE with a BOM for \`\>\` and \`Out-File\` (for example \`ConvertTo-Json | Out-File findings.json\`). That is the most common way older Windows tooling produces a BOM file. Confirmed: a UTF-16LE file with a BOM holding a valid one-finding list exits 1 with 'findings file "..." is not valid JSON'. The verb fails loudly, so no wrong result is produced, but the message points the user at the JSON content instead of the encoding, and this round's BOM change suggests Windows-written files are handled. The same applies to .claude/helpers/kit/cluster.js:256. — fix: Read the file as a Buffer. If it starts with FF FE (or FE FF), decode it as utf16le (swap the bytes for BE), otherwise decode it as utf-8 and strip the BOM. Or keep utf-8 and, when the raw bytes start with FF FE or FE FF, throw 'is UTF-16; save it as UTF-8'. Add a test with a UTF-16LE file.
