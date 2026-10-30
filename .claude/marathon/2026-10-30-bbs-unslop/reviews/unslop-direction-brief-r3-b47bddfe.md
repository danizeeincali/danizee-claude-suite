# Review b47bddfe-4a54-495d-b323-137fc44d6ca5 — unslop-direction-brief, round 3

- Commit: 2188045
- Angle: older environments and degraded networks
- Result: pass
- 2 findings

## Medium (1)

- **words() rgb/hsl regex is quadratic: a 400 KB Signature line takes 35 s, 8 MiB effectively hangs** — `.claude/helpers/kit/direction.js:91` (performance): words() runs /\b(?:rgba?|hsla?)\(\[^)\]\*\)/g over the whole signature/world text (onlyFrom, judge lines 115-116). For every 'rgb(' / 'hsl(' with no closing ')' the \[^)\]\* scans to the end of the string before failing, so the cost is O(occurrences x length). Probe: 'Signature: ' + 'rgb('.repeat(100000) (400 KB) took 35 s of CPU in \`direction check --file\`; at the documented 8 MiB cap (about 2M occurrences) the run is about 400x longer, i.e. hours, with no output. The field text is not length-capped before judge (too\_long only reports), so the 8 MiB input guard does not bound the work. On a slow or older machine the threshold for a noticeable stall is much lower. Same code in src/lib/kit/direction.js line 523. — fix: Bound the match: use \[^)\]{0,64} (or \[^()\]\*\) with a length cap), or skip onlyFrom/words when text.length \> MAX\_FIELD (it is already a too\_long problem); add a test that a 1 MiB 'rgb(' signature finishes quickly.

## Low (1)

- **UTF-16 input (Windows PowerShell 5.1 redirect default) is reported as 'looks binary' with no encoding hint** — `.claude/helpers/kit/direction.js:256` (other): readText only strips a UTF-8 BOM and then refuses any NUL. A direction file written with Windows PowerShell 5.1 \`\>\` / Out-File is UTF-16LE with an FF FE BOM, so it is refused as 'input looks binary (contains NUL bytes)'. Exit 1 is safe, but the message sends the user looking for a corrupt file instead of telling them to save as UTF-8. Probe: iconv -t utf-16le of a valid Product/Character block gives exit 1 'input looks binary'. Same code in src/lib/kit/direction.js line 688. — fix: Detect a leading FF FE / FE FF BOM and either decode it (buf.toString('utf16le')) or say 'input is UTF-16; save it as UTF-8'.
