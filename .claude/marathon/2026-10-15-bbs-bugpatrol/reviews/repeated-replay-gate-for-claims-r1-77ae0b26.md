# Review 77ae0b26-7c6f-49ce-8d3e-d3131c55bdb0 — repeated-replay-gate-for-claims, round 1

- Commit: 6a026ae
- Angle: one input method at a time
- Result: pass
- 3 findings

## Medium (1)

- **Library input: non-JSON run values compare as equal, so differing runs block** — `src/lib/kit/replay-gate.js:46` (correctness): Through the library entry gate(), checkRun (line 53) accepts any value in checks/outputs, and canon() treats every non-array object as a plain object by its own keys. A Date, Map or Set has no own keys, so it canonicalises to "{}". Two runs whose outputs are {at: new Date(0)} and {at: new Date(9e12)}, or {m: Map{1=\>2}} and {m: Map{1=\>3}}, come back as \`blocking\` with exit 2 (confirmed with a node one-liner). Flaky runs then fail the gate, which is the one thing the verb exists to prevent. Also \[undefined\] and \[null\] compare equal, and a BigInt makes JSON.stringify throw a bare TypeError rather than KitExit 1. The CLI is safe because JSON.parse only produces plain values. The library path is the documented entry for code callers. — fix: In checkRun, require checks, outputs and steps to be plain JSON: walk the value and fail with KitExit 1 on any object whose prototype is not Object.prototype or null, and on non-finite numbers, bigint, undefined, functions and symbols. Add a library test with Date and Map outputs.

## Low (2)

- **Malformed replay result aborts the whole batch, but a throwing replay only downgrades its own verdict** — `src/lib/kit/replay-gate.js:130` (correctness): When the injected replay throws, that verdict becomes \`untested\` and the rest of the batch is still judged. When it returns a malformed run instead (for example {} or a run with an extra key), checkRun throws KitExit 1 from inside the loop. Every other verdict's result is then discarded, including real \`blocking\` ones, and the exit becomes 1 instead of 2. Bad replay output from one claim hides an agreed failure on another claim. — fix: Wrap the checkRun of the replay result in the same try as the replay call, and classify a bad run as \`untested\` with the validation message as the reason. Keep KitExit 1 for invalid caller input only.
- **--file - is read as a file named '-' rather than stdin, and a repeated --file silently wins** — `src/lib/kit/replay-gate.js:156` (other): Sibling kit verbs (graph.js:1360, lenses.js:366) treat '-' as stdin. Here \`replay-gate --file -\` fails with "cannot read -: ENOENT". Given \`--file a.json --file b.json\`, the verb quietly uses b.json with no error. — fix: Treat '-' as stdin to match the other verbs, or reject it with a clear message. Reject a second --file.
