/**
 * Compound Engineering Plugin for Danizee Claude Suite
 * Handles plan, work, review, and compound workflows
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Get Compound Engineering commands
 */
export function getCommands() {
  return {
    'plan': {
      name: 'plan',
      description: 'Transform feature ideas into implementation plans',
      content: `# Plan Workflow

Transform a feature idea into a detailed implementation plan.

## Usage
\`\`\`
/compound-engineering:workflows:plan [feature description]
\`\`\`

## What It Does
1. **Search** - Checks memory for similar past implementations
2. **Analyze** - Reviews codebase for relevant patterns
3. **Design** - Creates implementation approach
4. **Checkpoint** - Pauses for your review

## Output
- Implementation steps
- Files to modify/create
- Dependencies identified
- Potential risks

## Example
\`\`\`
/compound-engineering:workflows:plan OAuth2 authentication with Google
\`\`\`
`
    },
    'work': {
      name: 'work',
      description: 'Execute plans with isolated git worktrees',
      content: `# Work Workflow

Execute implementation plans in isolated git worktrees.

## Usage
\`\`\`
/compound-engineering:workflows:work [plan reference]
\`\`\`

## What It Does
1. Creates isolated worktree branch
2. Implements changes based on plan
3. Runs tests continuously
4. Checkpoints at key milestones

## Features
- Isolated from main branch
- Automatic test running
- Progress tracking via todos
- Easy rollback if needed

## Example
\`\`\`
git worktree add ../feature-oauth feature/oauth2-google
/compound-engineering:workflows:work
\`\`\`
`
    },
    'review': {
      name: 'review',
      description: 'Multi-agent comprehensive code review',
      content: `# Review Workflow

Run comprehensive multi-agent code review.

## Usage
\`\`\`
/compound-engineering:workflows:review [PR number or branch]
\`\`\`

## Agents Deployed
| Agent | Focus |
|-------|-------|
| code-simplicity-reviewer | Complexity, readability |
| security-sentinel | Vulnerabilities, auth issues |
| performance-oracle | Bottlenecks, optimization |
| architecture-strategist | Design patterns, structure |
| pattern-recognition-specialist | Anti-patterns, best practices |

## Checkpoints
1. Code analysis findings
2. Security scan results
3. Performance recommendations
4. Architecture feedback

## Example
\`\`\`
/compound-engineering:workflows:review PR#47
\`\`\`
`
    },
    'compound': {
      name: 'compound',
      description: 'Store solution patterns in memory',
      content: `# Compound Workflow

Store solution patterns for future knowledge reuse.

## Usage
\`\`\`
/compound-engineering:workflows:compound [category]
\`\`\`

## Categories
- \`feature\` - Feature implementations
- \`bug\` - Bug fixes
- \`security\` - Security improvements
- \`performance\` - Performance optimizations
- \`architecture\` - Architecture decisions

## What Gets Stored
1. **Memory Key** - Searchable pattern reference
2. **Solution Doc** - Markdown documentation
3. **Neural Pattern** - Learned behavior for similar problems

## Example
\`\`\`
/compound-engineering:workflows:compound feature
# Stores to: project/features/[auto-named]
# Creates: docs/solutions/features/[name].md
\`\`\`
`
    }
  };
}

/**
 * Get plugin namespace
 */
export function getNamespace() {
  return 'danizee-compound';
}

/**
 * Install Compound Engineering plugin
 */
export async function install(claudeDir, options = {}) {
  const commandsDir = path.join(claudeDir, 'commands', 'workflows');

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

  // Create docs/solutions directory structure
  const docsDir = path.join(options.targetDir || process.cwd(), 'docs', 'solutions');
  const subdirs = [
    'features',
    'bugs',
    'security',
    'performance',
    'architecture',
    'reviews',
    'incidents',
    'tdd',
    'implementations',
    'debugging',
    'full-tdd-swarm',
    'multi-repo',
    'ideas',
    'ralph'
  ];

  for (const subdir of subdirs) {
    if (!options.dryRun) {
      await fs.mkdir(path.join(docsDir, subdir), { recursive: true });

      // Create .gitkeep to preserve empty directories
      await fs.writeFile(
        path.join(docsDir, subdir, '.gitkeep'),
        '',
        'utf-8'
      );
    }
  }

  // Create .claude/ralph-candidates.md for Ralph candidate tracking
  const ralphCandidatesPath = path.join(claudeDir, 'ralph-candidates.md');
  const ralphCandidatesContent = `# Ralph Candidates

> Dev patterns identified during compound that could become future Ralph Wiggum loops.
> Use \`/w-ralph-pick\` to select and execute a candidate.

## Active Candidates

| ID | Priority | Name | Source | Completion Tests | Status |
|----|----------|------|--------|------------------|--------|
| - | - | (none yet) | - | - | - |

---

## Candidate Details

<!--
### RC-001: [Name]
- **Priority:** P1 (critical) / P2 (important) / P3 (nice-to-have)
- **Source:** /w-[workflow] on YYYY-MM-DD
- **Pattern:** Brief description of the repeating dev pattern

**Completion Tests (AI-Verifiable):**
1. [ ] File exists: \`path/to/expected/file.ts\`
2. [ ] Pattern match: \`export function [name]\` in \`path/to/file.ts\`
3. [ ] Test passes: \`npm test -- --grep "feature name"\`
4. [ ] No lint errors: \`npm run lint\`

**Status:** draft | ready | in-progress | complete
**Completed:** (date if complete)

---
-->

---

## Archived Candidates

<!-- Completed candidates are moved here -->

| ID | Name | Completed | Result |
|----|------|-----------|--------|
| - | (none yet) | - | - |

---

## Candidate Guidelines

### Good Ralph Candidates Have:
- **Repeating pattern**: Feature or bug fix that occurs multiple times
- **Clear completion signal**: Tests pass, build succeeds, lint clean
- **Iterative nature**: Write code -> run tests -> fix -> repeat
- **Template potential**: Similar to work just completed

### Completion Test Types:
| Type | Format | Example |
|------|--------|---------|
| File exists | \`File exists: path\` | \`File exists: src/components/Button.tsx\` |
| Pattern match | \`Pattern: "regex" in file\` | \`Pattern: "export.*Button" in src/components/Button.tsx\` |
| Test passes | \`Test: command\` | \`Test: npm test -- --grep "Button"\` |
| Lint clean | \`Lint: command\` | \`Lint: npm run lint\` |
| Build passes | \`Build: command\` | \`Build: npm run build\` |

### NOT Suitable for Ralph:
- General automation (not dev work)
- One-off tasks with no repetition pattern
- Tasks without clear completion signals
- Non-code tasks
`;

  if (!options.dryRun) {
    await fs.writeFile(ralphCandidatesPath, ralphCandidatesContent, 'utf-8');
  }

  return {
    plugin: 'compound-engineering',
    namespace: getNamespace(),
    commands: Object.keys(commands),
    docsDir
  };
}

/**
 * Uninstall Compound Engineering plugin
 */
export async function uninstall(claudeDir) {
  const commandsDir = path.join(claudeDir, 'commands', 'workflows');

  try {
    await fs.rm(commandsDir, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
}

/**
 * Check if Compound Engineering is installed
 */
export async function isInstalled(claudeDir) {
  const commandsDir = path.join(claudeDir, 'commands', 'workflows');

  try {
    const files = await fs.readdir(commandsDir);
    return files.length > 0;
  } catch {
    return false;
  }
}

export default {
  getCommands,
  getNamespace,
  install,
  uninstall,
  isInstalled
};
