/**
 * Autoresearch Plugin for Danizee Claude Suite
 * Installs the autoresearch skill, command, and context hook
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'autoresearch');

export async function install(claudeDir, options = {}) {
  const files = [];

  // Install skill
  const skillDir = path.join(claudeDir, 'skills', 'autoresearch');
  await fs.mkdir(skillDir, { recursive: true });
  const skillContent = await fs.readFile(path.join(TEMPLATES_DIR, 'SKILL.md'), 'utf-8');
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
  files.push('skills/autoresearch/SKILL.md');

  // Install command
  const commandsDir = path.join(claudeDir, 'commands');
  await fs.mkdir(commandsDir, { recursive: true });
  const commandContent = await fs.readFile(path.join(TEMPLATES_DIR, 'autoresearch-command.md'), 'utf-8');
  await fs.writeFile(path.join(commandsDir, 'autoresearch.md'), commandContent, 'utf-8');
  files.push('commands/autoresearch.md');

  // Install hook
  const hooksDir = path.join(claudeDir, 'hooks');
  await fs.mkdir(hooksDir, { recursive: true });
  const hookContent = await fs.readFile(path.join(TEMPLATES_DIR, 'autoresearch-context.sh'), 'utf-8');
  await fs.writeFile(path.join(hooksDir, 'autoresearch-context.sh'), hookContent, { mode: 0o755 });
  files.push('hooks/autoresearch-context.sh');

  return {
    plugin: 'autoresearch',
    files,
  };
}

export async function isInstalled(claudeDir) {
  try {
    await fs.access(path.join(claudeDir, 'skills', 'autoresearch', 'SKILL.md'));
    return true;
  } catch {
    return false;
  }
}

export async function uninstall(claudeDir) {
  const paths = [
    path.join(claudeDir, 'skills', 'autoresearch'),
    path.join(claudeDir, 'commands', 'autoresearch.md'),
    path.join(claudeDir, 'hooks', 'autoresearch-context.sh'),
  ];

  for (const p of paths) {
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        await fs.rm(p, { recursive: true });
      } else {
        await fs.unlink(p);
      }
    } catch {
      // doesn't exist
    }
  }
}
