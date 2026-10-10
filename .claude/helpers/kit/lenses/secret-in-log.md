---
name: secret-in-log
globs:
  - "**/*.{js,mjs,cjs,jsx,ts,tsx,py,rb,go,sh}"
match: (console\.\w+|logger?\.\w+|print|printf|echo|puts|debug|fmt\.Print\w*)\b.*(token|secret|password|passwd|api[_-]?key|authorization|bearer|credential)
---
Look for a secret, token, password or credential that is written to a log, console, error message or CLI output.

Logs outlive the process and travel: CI output, bug reports and pasted transcripts all end up holding them. Check each
changed logging or printing line: does it include a value that could be a secret (the value itself, a whole request
header, a config object, or an error that embeds the request)? Printing only the name of a secret, or a fingerprint
of it, is fine.

If a value must be shown, it should go through the redaction helper first (`node .claude/helpers/kit/cli.js redact`).
Report the file and line and what would leak.
