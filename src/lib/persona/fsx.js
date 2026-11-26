/** Files are written whole or not at all: to a temp name in the same folder, then renamed over the target. */
import fs from "node:fs";
import path from "node:path";

/** `beforeRename` runs after the temp file is written and before it replaces the target; if it throws, the target is untouched and the temp file is removed. */
export function writeAtomic(file, text, { beforeRename } = {}) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, text);
    beforeRename?.();
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
