# Review 28b992b3-95f2-4dd9-a573-f9df0ea6a4bf — entrance-choreography-kinds, round 1

- Commit: 202cadd
- Angle: r1
- Result: pass
- 3 findings

## Medium (1)

- **--file checks the path with fs.stat, not the open handle, and does not refuse /dev/ or /proc/ paths** — `src/lib/kit/entrance.js:193` (correctness): readFileBounded calls fs.stat(p) (which follows links) and only then fs.open(p, 'r') without O\_NONBLOCK. rules.md (Input reading, added after r2) requires fs.open(p, O\_RDONLY | O\_NONBLOCK), then fh.stat().isFile(), then the bounded read, and refusing any path that resolves under /dev/ or /proc/. Confirmed: \`cli.js entrance --file /dev/stdin \< in.json\` exits 0 and prints a timeline, because /dev/stdin resolves to a regular file when stdin is redirected; the rule says it must be refused. A path swapped for a FIFO between the stat and the open also blocks the open forever. The same code is in .claude/helpers/kit/entrance.js. — fix: Resolve the path (fs.realpath) and refuse it under /dev/ or /proc/; open with O\_RDONLY | O\_NONBLOCK (as store.js and safe-git.js do); run isFile() and the size check on fh.stat(); then do the bounded read. Copy the change verbatim to the installed module.

## Low (2)

- **The /dev/stdin refusal test passes only because the runner pipes stdin** — `test/kit-entrance-choreography-kinds-packaged.test.js:60` (test-quality): The case \['entrance', '--file', '/dev/stdin'\] is fed through a pipe, so /dev/stdin is not a regular file and fs.stat refuses it. Redirect stdin from a regular file and the verb accepts it. rules.md says these tests must not depend on the runner's stdin. Neither suite tests a FIFO, or a /dev/stdin backed by a regular file, so the defect above passes green. — fix: Add a unit test with --file /dev/stdin (or /proc/self/fd/0) that expects exit 1 whatever stdin is, plus a FIFO case (mkfifo) that must exit 1 without hanging.
- **A file that grows after the stat is cut off silently at st.size + 1 bytes** — `src/lib/kit/entrance.js:204` (correctness): The buffer is sized Math.min(st.size, MAX\_BYTES) + 1 and the loop stops once it is full. If the file grows between the stat and the read, the verb parses a truncated prefix. That gives a misleading 'not valid JSON' error, not 'file changed' or the true size error. A /proc file, which reports size 0, would be read as 1 byte. — fix: Always allocate MAX\_BYTES + 1 (or read in chunks up to that cap) and decide the size from the bytes read, not from st.size.
