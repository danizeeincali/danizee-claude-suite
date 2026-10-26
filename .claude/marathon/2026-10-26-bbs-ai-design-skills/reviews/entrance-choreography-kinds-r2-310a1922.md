# Review 310a1922-53e1-43e2-8b0c-03953f7f9d75 — entrance-choreography-kinds, round 2

- Commit: c9faeed
- Angle: correctness
- Result: pass
- 3 findings

## Low (3)

- **A symlink to /proc/self/fd/0 still reads stdin through --file** — `src/lib/kit/entrance.js:197` (correctness): readFileBounded checks only the path as given and its final realpath. A link whose target is /proc/self/fd/0 resolves, through the /proc magic link, to whatever file stdin is redirected from, so neither check fires. Confirmed: \`ln -s /proc/self/fd/0 link.json; cli.js entrance --file link.json \< in.json\` exits 0 and prints a timeline. rules.md says to refuse any path that resolves under /dev/ or /proc/, so that --file never reads stdin. The bytes come from a file the user supplied, so nothing leaks, but the refusal can be bypassed. The same code is in .claude/helpers/kit/entrance.js. — fix: Before realpath, resolve the link chain one hop at a time (fs.readlink in a bounded loop) and refuse if any hop lands under /dev/ or /proc/. Or compare fh.stat() dev/ino with fstat of fd 0 and refuse a match. Add a unit test that uses such a symlink.
- **An override can end a grow kind at scale 0 and leave it invisible** — `src/lib/kit/entrance.js:68` (correctness): checkState applies the grow-axis exemption to override.to as well as override.from. So {kind:'bar', override:{to:{scaleX:0}}} or {kind:'chart', override:{to:{scaleY:0}}} is accepted, and the element ends collapsed for good (fill-mode both). The contract allows a zero scale only as a 1-D grow (0 to 1). An end state of 0 is not a grow, so this input should be refused with exit 1 rather than produce CSS that hides the element. — fix: Allow the grow axis at 0 only in override.from: pass a flag from normalize into checkState and require v \> 0 for every scale key in override.to.
- **The /dev/stdin test leaks an unclosed FileHandle** — `test/kit-entrance-choreography-kinds.test.js:268` (test-quality): \`const fd = (await fs.open(inp, 'r')).fd;\` keeps only the fd and never closes the FileHandle. It is closed when garbage collected, which Node deprecates (DEP0137) and plans to make an error, so the test can start warning or failing for reasons unrelated to the verb. — fix: Keep the handle (const fh = await fs.open(inp, 'r')), pass fh.fd to spawnSync, and await fh.close() in the finally block.
