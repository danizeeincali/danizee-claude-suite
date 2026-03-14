/**
 * RuFlo Plugin for Danizee Claude Suite
 * Handles MCP server registration and multi-agent swarm orchestration
 * Evolved from claude-flow — uses ruflo@latest for full swarm support
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Get RuFlo MCP server configuration
 */
export function getMcpConfig() {
  return {
    'ruflo': {
      command: 'npx',
      args: ['ruflo@latest', 'mcp', 'start'],
      description: 'RuFlo multi-agent orchestration — swarm, memory, consensus, and topology support'
    }
  };
}

/**
 * Get RuFlo commands
 */
export function getCommands() {
  return {
    'swarm-init': {
      name: 'swarm-init',
      description: 'Initialize a ruflo swarm with specified topology',
      content: `# Swarm Initialization

Initialize a multi-agent swarm for parallel task execution using RuFlo.

## Usage
\`\`\`
npx ruflo@latest swarm init --topology [hierarchical|mesh|ring|star]
\`\`\`

## Topologies
- **hierarchical**: Queen agent coordinates domain workers (default, recommended)
- **mesh**: All agents communicate with each other (high redundancy)
- **ring**: Agents pass work in a circular pattern (sequential pipelines)
- **star**: Central hub agent distributes work (centralized control)

## Quick Start
\`\`\`bash
# Initialize with default hierarchical topology
npx ruflo@latest swarm init --topology hierarchical --agents 5

# Check swarm status
npx ruflo@latest swarm status

# Spawn additional agent
npx ruflo@latest agent spawn --domain core --role coder
\`\`\`

## Domain-Based Agent Hierarchy
| Domain | Agents | Purpose |
|--------|--------|---------|
| queen | 1 | Central coordinator, consensus, planning |
| security | 2-4 | Threat analysis, CVE remediation, security testing |
| core | 5-9 | System design, implementation, memory |
| integration | 10-12 | Agentic flow, CLI features |
| support | 13-15 | TDD testing, performance, deployment |
`
    },
    'agent-spawn': {
      name: 'agent-spawn',
      description: 'Spawn a specialized ruflo agent',
      content: `# Agent Spawning

Spawn specialized agents for specific tasks using RuFlo swarm.

## Available Agents
| Agent | Domain | Purpose |
|-------|--------|---------|
| coder | core | Code implementation |
| tester | support | Test creation and execution |
| reviewer | support | Code review and quality checks |
| security-sentinel | security | Security vulnerability scanning |
| performance-oracle | support | Performance analysis and optimization |
| architecture-strategist | core | Architecture design and review |
| analyst | core | Deep analysis and investigation |
| git-history-analyzer | integration | Git history and blame analysis |

## Usage
\`\`\`bash
# Spawn via ruflo CLI
npx ruflo@latest agent spawn --domain core --role coder --task "Implement user auth"

# Spawn via MCP tool
mcp__ruflo__agent_spawn { domain: "core", role: "coder", task: "Implement user auth" }
\`\`\`

## Parallel Spawning
\`\`\`bash
# Spawn a full build team
npx ruflo@latest agent spawn --domain core --role coder --task "Implement feature"
npx ruflo@latest agent spawn --domain support --role tester --task "Write tests"
npx ruflo@latest agent spawn --domain support --role reviewer --task "Review code"
\`\`\`
`
    },
    'memory-ops': {
      name: 'memory-ops',
      description: 'Memory operations for knowledge compounding',
      content: `# Memory Operations

Store and retrieve solution patterns for knowledge compounding via RuFlo.

## Operations

### Search Memory
\`\`\`
mcp__ruflo__memory_search { pattern: "project/features/*" }
\`\`\`

### Store Pattern
\`\`\`
mcp__ruflo__memory_usage { action: "store", key: "project/features/[name]" }
\`\`\`

### Query Memory
\`\`\`
mcp__ruflo__memory_usage { action: "query", key: "project/bugs/*" }
\`\`\`

### Learn from Outcome
\`\`\`
mcp__ruflo__neural_patterns { action: "learn" }
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
 * Check if ruflo is available on the system
 */
export async function checkRufloAvailable() {
  const { execSync } = await import('child_process');
  try {
    execSync('npx ruflo@latest --version', { stdio: 'pipe', timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install RuFlo plugin
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
    plugin: 'ruflo',
    commands: Object.keys(commands),
    mcp: getMcpConfig()
  };
}

/**
 * Uninstall RuFlo plugin
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
 * Check if RuFlo is installed
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
  isInstalled,
  checkRufloAvailable
};
