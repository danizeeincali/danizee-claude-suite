# Review e0c0ba34-df71-473f-8045-4c609d7be446 — sarif-junit-and-sticky-pr-comment-render, round 5

- Commit: 3724c50
- Angle: accessibility
- Result: pass
- 1 findings

## Medium (1)

- **POSIX absolute paths are silently turned into a wrong repo-relative SARIF uri** — `src/lib/kit/render.js:106` (correctness): The new leading-segment strip in fileUri runs for every path, not just '//' UNC ones. So a single-slash absolute path, which Linux CI tools often emit (e.g. '/home/runner/work/app/app/src/x.js'), now becomes 'home/runner/work/app/app/src/x.js'. Confirmed: resolved against the checkout root, that gives file:///home/runner/work/app/app/home/runner/work/app/app/src/x.js, a file that does not exist, so the alert is attached to the wrong place. Before this commit '/home/...' was a valid absolute-path reference that resolved correctly. Drive-letter absolutes get file:///C:/... (the r3 fix), so POSIX absolutes are now handled inconsistently and wrongly. The new test pins this behaviour ('/etc/x.js' -\> 'etc/x.js', '///x.js' -\> 'x.js'). The same code is in .claude/helpers/kit/render.js:106. — fix: Strip the leading empty segments only when the path starts with '//' (UNC/network-path). For a single leading '/', emit 'file://' + the encoded path, the way drive-letter paths are handled (e.g. file:///etc/x.js). Update the test to expect file:///etc/x.js and keep the 'never starts with //' assertion for the UNC inputs.
