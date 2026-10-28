# Review ee6ba25b-cbbc-4287-ae94-7f4fd85bfd26 — intake-batch-before-design, round 2

- Commit: ee17553
- Angle: r2
- Result: pass
- 3 findings

## Low (3)

- **Regular-file check runs on the path before open, so a swapped-in FIFO can still hang the read** — `src/lib/kit/design-brief.js:215` (correctness): readInput calls fs.stat(file), checks isFile(), and only then calls fs.open(file, 'r') on the same path. If the path is replaced by a FIFO between the two calls (a rename or symlink swap), open(2) blocks until a writer appears and the verb hangs. The window is narrow, so this is low. The same code is in .claude/helpers/kit/design-brief.js. — fix: Open first with O\_RDONLY|O\_NONBLOCK, then run fh.stat() on the handle and refuse when !isFile().
- **The JSON parse error drops the parser's reason and does not say where the input came from** — `src/lib/kit/design-brief.js:240` (other): catch { throw bad('input is not valid JSON') } throws away the SyntaxError message, which gives the position, and does not name the --file path or say stdin. — fix: Include the source (file path or stdin) and e.message in the error.
- **Only one refusal checks that its message names the field** — `test/kit-intake-batch-before-design.test.js:88` (test-quality): The contract says unknown keys and wrong types are refused with a message naming the field. Only answers.audience is checked for that; the unknown top-level key, the unknown answers key, the bad kind and the list-item refusals are checked for exit code 1 only. — fix: Assert the message names the field for each refusal case.
