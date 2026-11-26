/** Files are written whole or not at all: to a temp name in the same folder, then renamed over the target. */
import fs from "node:fs";
import path from "node:path";

/** With `mode` the file is created with it, so it is never readable more widely, even for a moment. `beforeRename` runs after the temp file is written and before it replaces the target; if it throws, the target is untouched and the temp file is removed. */
export function writeAtomic(file, text, { beforeRename, mode } = {}) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    beforeRename?.();
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
