/**
 * Marathon shadowing check
 * Finds user-level commands that would shadow the suite's own commands.
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Names for which `<commandsDir>/<name>.md` exists, in input order.
 * A missing directory yields [].
 */
export async function checkShadowing(commandsDir, names) {
  const hits = [];
  for (const name of names) {
    if (name !== path.basename(name)) continue;
    try {
      await fs.access(path.join(commandsDir, `${name}.md`));
      hits.push(name);
    } catch {
      // not present
    }
  }
  return hits;
}
