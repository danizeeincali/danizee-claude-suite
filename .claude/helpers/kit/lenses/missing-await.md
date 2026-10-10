---
name: missing-await
globs:
  - "**/*.{js,mjs,cjs,jsx,ts,tsx}"
match: \b(async|await|Promise|fetch|\.then|\.catch|fs\.promises|readFile|writeFile|mkdir|rm|spawn|exec)\b
covered_by: [no-floating-promises]
---
Look for a call that returns a promise but is not awaited, returned, or given a `.catch`.

In this repo the usual culprits are `fs.promises.*` / `fs/promises` calls, `fetch`, our own `async` helpers, and
`Promise.all` results that are dropped. A forgotten `await` does not fail loudly: the next line runs on a half-written
file, the process exits before the write lands, or a rejection surfaces much later as an unhandled error.

Check each changed async call: is its result awaited, returned to a caller that awaits it, or deliberately detached
with a comment saying why? Also check `forEach(async ...)`, which never waits for its callbacks. Report each one with
the file and line and say what would go wrong if the promise settles late or rejects.
