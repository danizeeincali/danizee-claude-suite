# Review 92d52a73-5e2f-47eb-b2e2-2efb9325fdbd — handoff, round 4

- Commit: 12da973
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 3 findings

## Medium (2)

- **Evidence URLs and dotted tokens are copied unredacted into briefs and memos** — `src/lib/bbs/handoff.js:122` (security): evidenceLocations keeps any http(s) URL verbatim and its path.ext pattern matches JWT-shaped tokens; the text is written into briefs and memos. — fix: Pass URL matches through redactRef (or redactUrlsInText first); keep a bare dotted token only with a '/' or a ':line' suffix and drop long base64-like segments. Test a userinfo URL, an ?api\_key= URL and a JWT-shaped string.
- **Forced-refill cleanup deletes every .md in briefs/ and memos/, not only the files a hand-off created** — `src/lib/bbs/handoff.js:668` (correctness): A user-written briefs/notes.md or a hand-edited brief is deleted silently; a directory named x.md makes fs.rm throw after the marathon run was filled and before handoff.json is written. — fix: Remove only files listed in the previous handoff.json that are not kept now; skip non-regular entries. Test that a foreign .md survives --force.

## Low (1)

- **marathon\_cli path is executed without a containment check** — `src/lib/bbs/handoff.js:485` (security): paths.marathon\_cli '../../elsewhere/cli.js' passes config validation and node runs code outside the project. — fix: Refuse a marathon\_cli that resolves outside the project, with the same error shape as the paths.runs check.
