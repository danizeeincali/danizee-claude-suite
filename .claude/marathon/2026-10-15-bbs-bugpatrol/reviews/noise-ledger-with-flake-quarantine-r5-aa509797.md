# Review aa509797-3b28-4123-98fc-4f9cf0a8206b — noise-ledger-with-flake-quarantine, round 5

- Commit: 325a9ae
- Angle: accessibility
- Result: pass
- 2 findings

## Medium (1)

- **Finding and ledger ids are printed raw in error messages, so control characters can rewrite the terminal and fake a line** — `src/lib/kit/noise-ledger.js:92` (security): Most validation errors put the id in the message without escaping it: \`finding ${id}: ...\` at lines 78, 92, 96, 99 and 102, and \`ledger entry ${e.id}: ...\` at lines 117-119. The duplicate-id messages at lines 90 and 115 already JSON.stringify the id, so the handling is inconsistent. cli.js writes the message to stderr as it is. Finding ids come from checker output, which can be built from content in an untrusted repo. Checked: apply with id "a\u001b\[31mRED\nkit: ok" and severity "bad" wrote an ANSI colour change and a second, forged line \`kit: ok: severity must be ...\` to the terminal. A crafted id can therefore hide or disguise the real error, or clear the screen. Raw control bytes also come through as noise in screen readers and log viewers. The same code is in .claude/helpers/kit/noise-ledger.js. — fix: Format ids the way lines 90 and 115 do (JSON.stringify(id).slice(0, 80)) in every error message that includes a finding or ledger id.

## Low (1)

- **--help usage leaves out --ledger/--now for accept and prune, and --in -** — `src/lib/kit/noise-ledger.js:34` (docs): --help returns only the \`usage\` string. It lists \[--ledger \<path\>\] \[--now \<date\>\] for apply only, and shows accept and prune without them, although both commands take them (header lines 5-6). It also does not say that \`--in -\` reads stdin. Someone who relies on --help, instead of reading the source header, cannot find out how to point accept or prune at a non-default ledger. — fix: Add \[--ledger \<path\>\] \[--now \<date\>\] to accept and prune in the usage string, and note '--in - = stdin'.
