/**
 * Marathon shadowing check
 * Finds user-level commands that would shadow the suite's own commands.
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Carried by the commands `danizee-claude-suite install-user` writes to ~/.claude/commands/.
 * Such a file is the suite's own single copy, not a stale command shadowing it.
 */
export const SUITE_COPY_MARKER = 'danizee-claude-suite: user-level copy';

/**
 * Names for which `<commandsDir>/<name>.md` exists and is not the suite's own user-level copy,
 * in input order. A missing directory yields [].
 */
export async function checkShadowing(commandsDir, names) {
  const hits = [];
  for (const name of names) {
    if (name !== path.basename(name)) continue;
    let content;
    try {
      content = await fs.readFile(path.join(commandsDir, `${name}.md`), 'utf-8');
    } catch {
      continue; // not present
    }
    if (!content.includes(SUITE_COPY_MARKER)) hits.push(name);
  }
  return hits;
}
