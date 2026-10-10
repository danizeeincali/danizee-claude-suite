# Review f275c970-464d-46cf-9307-7218ad46682e — caller-floor-disclosure, round 1

- Commit: 05a9c21
- Angle: one input method at a time
- Result: pass
- 3 findings

## Medium (1)

- **callers --diff drops removed definitions without saying so** — `src/lib/kit/caller-floor.js:288` (correctness): callers --diff takes no --base, so touchedSymbols runs without oldGraph and never reports removals. Reproduced: a diff that deletes \`export function gone()\` from lib.js while main.js still calls it returns entries: \[\], partial: false, and the note 'the diff touched no definition that the graph could read'. Deleting a whole file gives the same result. impact prints 'no --base: removed definitions were not checked' in this case. callers prints nothing like it, so a pure removal reads as 'nothing to check'. That is the zero-means-safe reading this stream exists to prevent, and the brief's /w-review text points reviewers at callers for single symbols. — fix: In callers --diff mode, add a note (and set partial) whenever any change has removed lines or deleted: true, saying removed definitions were not checked and pointing to \`impact --base\`. Or accept --base and pass oldGraph through as impact does.

## Low (2)

- **missing reason claims the file was read when it does not exist** — `src/lib/kit/caller-floor.js:276` (correctness): \`callers --symbol nope.js:f\` for a path that is not in the repository returns the reason 'no definition with that name in the file as read'. No file was read, so the message suggests the file exists and was checked. — fix: When w.file is not among graph.files, say the file was not found in the repository.
- **--symbol swallows -h** — `src/lib/kit/caller-floor.js:214` (other): The --symbol value loop only stops at arguments starting with '--'. So \`callers --symbol lib.js:keep -h\` treats -h as a symbol and fails with '"-h" is not file:name' instead of printing help. -h is accepted everywhere else. — fix: Also stop the loop on '-h' (or on any argument starting with '-').
