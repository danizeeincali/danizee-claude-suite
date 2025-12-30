/**
 * Claude Flow Plugin for Danizee Claude Suite
 * Handles MCP server registration and multi-agent orchestration
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Get Claude Flow MCP server configuration
 */
export function getMcpConfig() {
  return {
    'claude-flow': {
      command: 'npx',
      args: ['claude-flow@alpha', 'mcp', 'start'],
      description: 'Claude Flow multi-agent orchestration with memory and swarm support'
    }
  };
}

/**
 * Get Claude Flow commands
 */
export function getCommands() {
  return {
    'swarm-init': {
      name: 'swarm-init',
      description: 'Initialize a swarm with specified topology',
      content: `# Swarm Initialization

Initialize a multi-agent swarm for parallel task execution.

## Usage
\`\`\`
npx claude-flow@alpha swarm init --topology [hierarchical|mesh|ring|star]
\`\`\`

## Topologies
- **hierarchical**: Leader agent coordinates worker agents (default)
- **mesh**: All agents communicate with each other
- **ring**: Agents pass work in a circular pattern
- **star**: Central hub agent distributes work

## Example
\`\`\`bash
npx claude-flow@alpha swarm init --topology hierarchical
\`\`\`
`
    },
    'agent-spawn': {
      name: 'agent-spawn',
      description: 'Spawn a specialized agent',
      content: `# Agent Spawning

Spawn specialized agents for specific tasks.

## Available Agents
| Agent | Purpose |
|-------|---------|
| coder | Code implementation |
| tester | Test creation and execution |
| reviewer | Code review and quality checks |
| security-sentinel | Security vulnerability scanning |
| performance-oracle | Performance analysis and optimization |
| architecture-strategist | Architecture design and review |
| analyst | Deep analysis and investigation |
| git-history-analyzer | Git history and blame analysis |

## Usage
\`\`\`
Task("agent-type", "task description", "role")
\`\`\`

## Example
\`\`\`bash
Task("coder", "Implement user authentication with JWT", "coder")
Task("tester", "Write unit tests for auth module", "tester")
\`\`\`
`
    },
    'memory-ops': {
      name: 'memory-ops',
      description: 'Memory operations for knowledge compounding',
      content: `# Memory Operations

Store and retrieve solution patterns for knowledge compounding.

## Operations

### Search Memory
\`\`\`
mcp__claude-flow__memory_search { pattern: "project/features/*" }
\`\`\`

### Store Pattern
\`\`\`
mcp__claude-flow__memory_usage { action: "store", key: "project/features/[name]" }
\`\`\`

### Query Memory
\`\`\`
mcp__claude-flow__memory_usage { action: "query", key: "project/bugs/*" }
\`\`\`

### Learn from Outcome
\`\`\`
mcp__claude-flow__neural_patterns { action: "learn" }
\`\`\`

## Memory Namespaces
- \`project/features/*\` - Feature implementations
- \`project/bugs/*\` - Bug fixes
- \`project/security/*\` - Security findings
- \`project/performance/*\` - Performance optimizations
- \`project/architecture/*\` - Design decisions
- \`project/reviews/*\` - Review findings
- \`project/incidents/*\` - Incident responses
`
    }
  };
}

/**
 * Install Claude Flow plugin
 */
export async function install(claudeDir, options = {}) {
  const commandsDir = path.join(claudeDir, 'commands', 'coordination');

  // Ensure directory exists
  await fs.mkdir(commandsDir, { recursive: true });

  // Write command files
  const commands = getCommands();
  for (const [name, command] of Object.entries(commands)) {
    const filePath = path.join(commandsDir, `${name}.md`);

    if (!options.dryRun) {
      await fs.writeFile(filePath, command.content, 'utf-8');
    }
  }

  return {
    plugin: 'claude-flow',
    commands: Object.keys(commands),
    mcp: getMcpConfig()
  };
}

/**
 * Uninstall Claude Flow plugin
 */
export async function uninstall(claudeDir) {
  const commandsDir = path.join(claudeDir, 'commands', 'coordination');

  try {
    await fs.rm(commandsDir, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
}

/**
 * Check if Claude Flow is installed
 */
export async function isInstalled(claudeDir) {
  const commandsDir = path.join(claudeDir, 'commands', 'coordination');

  try {
    const files = await fs.readdir(commandsDir);
    return files.length > 0;
  } catch {
    return false;
  }
}

export default {
  getMcpConfig,
  getCommands,
  install,
  uninstall,
  isInstalled
};
