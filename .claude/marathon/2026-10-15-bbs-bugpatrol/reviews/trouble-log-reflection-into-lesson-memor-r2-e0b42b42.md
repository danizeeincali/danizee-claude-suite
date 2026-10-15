# Review e0b42b42-45e8-48d0-ad20-8e7abc9da25a — trouble-log-reflection-into-lesson-memor, round 2

- Commit: 2d24c8f
- Angle: failure conditions and error paths
- Result: over tolerance
- 2 findings

## High (1)

- **Failed-action error text is changed before redaction, so secrets leak through 'failed:' lines** — `src/lib/kit/reflect.js:138` (security): The round-1 fix redacts tool input before it is serialised, but the failure path still changes the error text before redactSecrets runs in troubleLog (line 179). (1) A non-string error goes through textOf (line 63), which uses JSON.stringify, so a quote or backslash in a secret becomes \" or \\ and no longer matches. (2) oneLine collapses any run of whitespace, so a secret containing a tab or two spaces no longer matches. Confirmed: secret 'pa"ss-LONGSECRET' with error {message:'bad password '+secret} gives 'failed: Login - {"message":"bad password pa\"ss-LONGSECRET"}'. Secret 'my\tpass-LONGSECRET' with a string error gives 'failed: Login - bad my pass-LONGSECRET'. Both reach the reviewer model in clear. Error messages often echo the credential that failed, so this is the path most likely to carry a secret. — fix: Redact the error (string values of an error object, using the same safe() walk as the input) before textOf/oneLine, or redact the raw error string before collapsing whitespace. Add tests with a quote/backslash secret in an object error and a tab inside a secret.

## Medium (1)

- **Missing or unrecognised input gives a clean trouble log with exit 0** — `src/lib/kit/reflect.js:433` (correctness): When --in is left out and stdin is not a terminal but is empty (for example /dev/null, as in an agent's Bash tool), io.stdin() returns '' and the verb exits 0 with lines \['stop: unknown'\] and events 0. A JSONL file whose objects match neither shape, such as {type:'message'} or {event:'tool\_call'}, is dropped line by line in normalizeEvents the same way. Confirmed: \`cli.js reflect trouble-log \< /dev/null\` and troubleLog(\[{type:'message'},{event:'tool\_call'}\]) both return a clean log with exit 0. The reviewer model reads that as a session with no trouble, so a wiring mistake in /w-fix or /w-bbs looks like a clean run and no lessons are ever saved. No test covers empty or unrecognised input. — fix: Exit 1 when the input has no non-blank lines, or when non-blank lines exist but none is recognised (or report an 'unrecognised' count and fail if it equals the line count). Add tests for both cases.
