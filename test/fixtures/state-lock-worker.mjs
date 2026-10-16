// Child process for test/kit-state-lock.test.js: does <iterations> locked read-modify-write increments of a counter file.
// argv: <counterFile> <iterations> <optsJson>; optsJson = withStateLock opts plus holdMs (pause inside the lock after the read).
// Prints "HOLD" once it is inside the lock for the first time. Exits 1 with the message on stderr on failure.
import { withStateLock, readJsonState, writeJsonAtomic } from '../../src/lib/kit/state-lock.js';

const [file, iterations, optsJson] = process.argv.slice(2);
const { holdMs = 0, ...opts } = JSON.parse(optsJson || '{}');
try {
  for (let i = 0; i < Number(iterations); i++) {
    await withStateLock(file, async () => {
      const state = await readJsonState(file, { fallback: { count: 0 } });
      if (i === 0) process.stdout.write('HOLD\n');
      if (holdMs) await new Promise(r => setTimeout(r, holdMs));
      await writeJsonAtomic(file, { count: state.count + 1 });
    }, opts);
  }
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
}
