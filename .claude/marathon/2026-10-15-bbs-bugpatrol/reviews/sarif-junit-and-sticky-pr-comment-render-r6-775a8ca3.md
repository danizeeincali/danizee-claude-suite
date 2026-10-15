# Review 775a8ca3-8c8a-439b-9822-ea11aed27311 — sarif-junit-and-sticky-pr-comment-render, round 6

- Commit: 546916f
- Angle: facts and content
- Result: pass
- 2 findings

## Medium (1)

- **A POSIX absolute path with three or more leading slashes becomes a wrong repo-relative SARIF uri** — `src/lib/kit/render.js:107` (correctness): The new POSIX branch only matches a single leading '/'. Any path starting with '///' falls through to the leading-segment strip. POSIX treats more than two leading slashes as one, so '///home/runner/x.js' means '/home/runner/x.js'. Confirmed: '/home/runner/x.js' -\> 'file:///home/runner/x.js', but '///home/runner/x.js' -\> 'home/runner/x.js'. Resolved against the checkout root, that second uri names a file that does not exist, so the alert lands in the wrong place. This is the same bug r5 reported, still present for this input. The new test at test/kit-sarif-junit-and-sticky-pr-comment-render.test.js:291-295 pins the wrong value ('///x.js' -\> 'x.js'). Same code in .claude/helpers/kit/render.js:107. — fix: Treat only exactly two leading slashes ('//' not followed by '/') as a UNC/network path. For three or more, collapse them to a single '/' and use the POSIX file:// branch, so '///x.js' -\> 'file:///x.js'. Update the test expectation to match.

## Low (1)

- **fileUri doc comment still describes only repo-relative URI references** — `src/lib/kit/render.js:98` (docs): The comment says fileUri turns 'a repo path' into 'a URI reference' by converting backslashes and encoding each segment. It now also returns absolute file:/// URIs for drive-letter and POSIX absolute paths, strips leading slashes from UNC/'//' input and returns '.' for an empty result. None of that is mentioned, so a reader who trusts the comment will misread how locations are produced. Same in .claude/helpers/kit/render.js:98. — fix: Reword the comment to list the cases: drive-letter and single-'/' absolute paths -\> file:/// URI; leading '//' or UNC -\> leading slashes stripped, relative; otherwise a relative reference; empty -\> '.'.
