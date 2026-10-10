# Review 94ed5ae6-4af4-4dc9-97c3-3b18f7290912 — usage, round 3

- Commit: 9482747
- Angle: older environments and degraded networks
- Result: pass
- 4 findings

## Medium (2)

- **One unreadable transcript aborts the whole usage scan** — `src/lib/bbs/usage.js:134` (correctness): A read error on one file rejects the readline loop; the scan exits 1 and prints the path. — fix: try/catch per file, count files\_unreadable, continue; test it.
- **Transcripts from older Claude Code versions undercount model-invoked workflows** — `src/lib/bbs/usage.js:107` (correctness): SlashCommand tool calls (input.command) are not counted. — fix: Accept SlashCommand and add it to the prefilter; fixture row.

## Low (2)

- **Default transcript root ignores CLAUDE\_CONFIG\_DIR** — `src/lib/bbs/config.js:18` (correctness): A moved config dir reads 0 files and the note misleads. — fix: Default to $CLAUDE\_CONFIG\_DIR/projects; name searched roots when 0 files.
- **MAX\_LINE\_CHARS does not limit memory** — `src/lib/bbs/usage.js:136` (performance): readline buffers the whole line first. — fix: Reword the comment.
