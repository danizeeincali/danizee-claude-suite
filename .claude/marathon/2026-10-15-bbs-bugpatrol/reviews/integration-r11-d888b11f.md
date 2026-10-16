# Review d888b11f-57c4-44d5-b125-abda814ce44b — integration, round 11

- Commit: d98ef7c
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 2 findings

## Medium (1)

- **Reflection now reads the full Claude transcript, but only .env values are redacted before a lesson is committed** — `src/plugins/dot-shortcuts.js:1783` (security): This diff points the REFLECTION blocks of /pt (line 1081), /w-fix (1783) and /w-bbs (5312) at the whole session transcript (~/.claude/projects/\<project\>/\<session\>.jsonl). That transcript holds every tool input and output, including credentials that are not project secrets: a token from \`gh auth token\`, an Authorization header in a curl command, an env var. \`reflect trouble-log\` and the \`lessons save\` guard (src/lib/kit/reflect.js:427-433) redact only exact values from the project's secrets files. The blocks tell the model that a lesson 'can quote an error message', and the store .claude/kit/lessons.json is not git-ignored and is read back into later prompts. Confirmed in a scratch repo: a failed Bash event whose error holds ghp\_abcdefghijklmnopqrstuvwxyz0123456789 comes out of trouble-log unredacted ('failed: Bash - curl: (22) 401 token ghp\_... bad'). \`lessons save --text-file\` with that token then exits 0 and writes it verbatim into lessons.json. — fix: Before save, and on trouble-log output, also reject or mask credential-shaped strings (ghp\_/github\_pat\_/sk-/AKIA/xox\*/Bearer \<token\>/long high-entropy runs). Or add .claude/kit/lessons.json to .gitignore and tell the blocks never to quote tokens.

## Low (1)

- **Blocking gates hard-code a real-looking shared /tmp path (/tmp/tmp.AbC123)** — `src/plugins/dot-shortcuts.js:1751` (security): The literal-path rewrite replaced $R/$G placeholders with runnable defaults: R=/tmp/tmp.AbC123/route.json in the /w-fix AUTO-FIX GATE and G=/tmp/tmp.AbC123/gate.json in the /w-debug REPLAY GATE (line 1961). The /pt and /mt blocks do the same, with 33 uses in all. The name matches mktemp's own pattern and sits in world-writable /tmp. If the model runs a block verbatim (it is valid shell), it reads whatever is at that fixed path rather than failing on an unset variable. A file planted there by another local user would decide the auto-fix route or the replay gate, and the \`\> "$P/test-map.json"\` redirect would follow a planted symlink. Usually the missing directory makes the block fail closed, so this needs both a model slip and a shared host. — fix: Use a non-runnable placeholder such as P='\<printed dir\>' (or :"${P:?set P to the mktemp -d output}"), so a block run without substitution fails instead of using a fixed shared path.
