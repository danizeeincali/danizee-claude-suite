# Review 57b44b1a-ae63-45d8-b072-c40089a2c49e — keyframe-track-story-engine, round 2

- Commit: 49d130f
- Angle: correctness
- Result: pass
- 4 findings

## Medium (2)

- **check/sample without --file blocks forever on a terminal stdin** — `src/lib/kit/keyframes.js:197` (correctness): readInput always reads stdin when --file is absent and never looks at io.stdinIsTTY (cli.js passes it). Running \`keyframes check\` or \`keyframes sample --at 0\` by hand without --file hangs waiting for EOF and never prints the 'no input' error. Other stdin verbs (exit-codes.js:257, graph.js:1361, guarded-fs.js:327, noise-ledger.js:232) refuse a TTY with exit 1. — fix: In readInput, when flags.file is undefined and io.stdinIsTTY is true, throw bad('no input: pass the keyframes JSON on stdin or with --file'); add a unit test with io.stdinIsTTY: true.
- **Emitted createLoop silently freezes when loop\_ms is missing or invalid** — `src/lib/kit/keyframes.js:103` (correctness): createLoop takes opts.loop\_ms and does no checking. evaluate only wraps time when loop\_ms \> 0, so if loop\_ms is left out (or is 0, NaN or a string), every track plays once, then stays on its last keyframe value forever and nothing reports an error. Confirmed: with a {0:1,1000:5,2000:1} track, createLoop(stories, {now}) gives x=1 at 2500 ms where it should give 3. The emitted module is the one place pages use this, and a missing option turns the seamless loop into a one-shot with no signal. — fix: At the top of createLoop, throw if !(typeof L === 'number' && L \> 0 && isFinite(L)); add a test that calls createLoop without loop\_ms.

## Low (2)

- **A story id or property named \_\_proto\_\_ vanishes from sample output** — `src/lib/kit/keyframes.js:335` (correctness): normalize accepts any non-empty id and any track key, and builds tracks with Object.create(null). sample then writes into plain {} objects (values, vals), and createLoop's out/vals do the same. Assigning to '\_\_proto\_\_' changes the prototype instead of adding a key. Confirmed: a story with id '\_\_proto\_\_' gives values:{}, and a '\_\_proto\_\_' track is dropped from its story's values, with no error. — fix: Build values/vals (and createLoop's out/vals) with Object.create(null), or reject '\_\_proto\_\_' as an id or prop name in normalize.
- **createLoop can never restart after onFrame throws** — `src/lib/kit/keyframes.js:128` (correctness): start() sets running = true and then calls frame() synchronously. If onFrame throws on the first frame, no raf gets scheduled but running stays true, so every later start() returns early and does nothing. The loop stays dead until the caller happens to call stop(). — fix: Set running = false (or schedule raf before calling onFrame) when onFrame throws, e.g. wrap the call in try { ... } catch (e) { running = false; throw e; }.
