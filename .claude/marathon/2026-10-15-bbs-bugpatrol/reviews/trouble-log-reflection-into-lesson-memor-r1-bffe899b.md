# Review bffe899b-44dd-46fc-9911-dcc81f301a44 — trouble-log-reflection-into-lesson-memor, round 1

- Commit: cc02796
- Angle: one input method at a time
- Result: over tolerance
- 6 findings

## High (1)

- **Secret containing a quote or backslash leaks through the 'repeated' line** — `src/lib/kit/reflect.js:153` (security): The repeated-call line embeds stable(s.input), which is JSON.stringify output, so a '"' or '\' inside a secret is escaped (\" / \\) before redactSecrets runs on line 172. The escaped form no longer matches the secret, so it reaches the trouble log in clear. Confirmed: secret 'pa\ss"w0rd-LONGSECRET' passed in secrets, two identical Bash calls with input {command:'login '+secret} give the line 'repeated: Bash 2 times with identical input {"command":"login pa\\ss\"w0rd-LONGSECRET"}'. Generated passwords often contain these characters, and this output is what the reviewer model gets. — fix: Redact the raw input values before serialising them (walk the input and redactSecrets each string), or also redact using the JSON-escaped form of each secret (JSON.stringify(s).slice(1,-1)); add a test with a quote/backslash secret.

## Medium (3)

- **'Same field typed into again' never fires for MCP or computer-use typing tools** — `src/lib/kit/reflect.js:52` (correctness): EDIT\_TOOL is anchored (^...$), so tool names as they appear in Claude Code transcripts, such as mcp\_\_playwright\_\_browser\_type or browser\_fill\_form, never match. The computer tool with action:'type' does not match either. Confirmed: three mcp\_\_playwright\_\_browser\_type calls into element 'Email' / ref 'e12' with different text produce only 'stop: unknown'. The idea lists the typed-into-field signal, and through the transcript input it only works for Edit/Write file edits. — fix: Match the last segment after an mcp\_\_\<server\>\_\_ prefix (e.g. /(^|\_\_)(browser\_)?(type|fill(\_form)?|...)$/i) and treat {name:'computer', input.action:'type'} as a typing call; add a transcript test.
- **Imperative check refuses verbs ending in 'ing' (Bring, Ping)** — `src/lib/kit/reflect.js:218` (correctness): /ing$/i on the first word is meant to catch gerunds but also rejects real imperatives. Confirmed: 'Bring the server up before running e2e tests.' and 'Ping the health endpoint before deploying.' both exit 1 with 'a lesson is imperative: start with a verb, not "Bring"'. The reviewer has to reword a valid lesson. — fix: Allow a small list of -ing verbs (bring, ping, string, sing, ring, swing, cling, fling, sting, wring), or only reject -ing words longer than 5 letters that are not on that list.
- **Hard per-session cap on new lessons applies only when --session is passed** — `src/lib/kit/reflect.js:290` (correctness): The cap check only runs when opts.session is set, and --session is optional with no default. A workflow that calls 'reflect lessons save' without --session can save any number of new lessons, but the idea calls this a hard per-session cap. Nothing warns about it and nothing in the usage marks --session as needed for the cap. — fix: Require --session on save (exit 1 without it), or fall back to an env/session id the caller always has, and test that a save without a session cannot go over the cap.

## Low (2)

- **Abbreviations like 'e.g.' count as a second sentence** — `src/lib/kit/reflect.js:215` (correctness): /\[.!?\]\s+\S/ treats any period followed by a space as a sentence end. Confirmed: 'Use npm ci, e.g. in CI jobs.' is refused with 'a lesson is ONE sentence'. — fix: Ignore common abbreviations (e.g., i.e., etc., vs.) before the sentence test, or only flag a period followed by a space and an upper-case letter.
- **Test name says a fresh lock times out as exit 1, but nothing asserts it** — `test/kit-trouble-log-reflection-into-lesson-memor.test.js:185` (test-quality): 'a stale lock is broken; a fresh lock times out as exit 1' only covers the stale-lock case. The timeout path in withLock (reflect.js:259) is never run, so it could hang or return the wrong code and this test would still pass. — fix: Call withLock on a fresh lock file with a small waitMs (e.g. 100) and assert it rejects with code 1 and leaves the lock in place.
