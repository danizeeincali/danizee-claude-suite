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
> Use Pure Ralph approach: fresh context each iteration, state through files only.

## Quick Start

\`\`\`bash
# Initialize Ralph in your project
/w-ralph-init

# Create implementation plan from a task
/w-ralph-this "Build feature X with tests"

# Or build plan interactively
/w-ralph-goals "I want to build a CLI tool"

# Run the loop (in terminal)
./.claude/ralph/loop.sh
\`\`\`

## Pure Ralph Principle

Each iteration:
1. Fresh Claude instance reads IMPLEMENTATION_PLAN.md
2. Picks ONE task, completes it fully
3. Runs validation from AGENTS.md
4. Marks task done, commits, exits
5. Bash loop restarts fresh

State passes through files only. No context accumulation.

## Active Candidates

| ID | Priority | Name | Source | Completion Tests | Status |
|----|----------|------|--------|------------------|--------|
| - | - | (none yet) | - | - | - |

---

## Active Diagnostics

> Auto-generated by \`/w-compound\` to verify patterns exist. Run these first in batch.

| ID | Priority | Verifies | File | Triggers | Status |
|----|----------|----------|------|----------|--------|
| - | - | (none yet) | - | - | - |

---

## Active Fixes

> Auto-generated by \`/w-compound\`. Only run if paired diagnostic fails.

| ID | Priority | Restores | File | Triggered By | Status |
|----|----------|----------|------|--------------|--------|
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

## Diagnostic Details

<!--
### RC-D001: [Name] Exists

**Auto-Generated From**: /w-compound on YYYY-MM-DD
**Type**: Diagnostic
**Verifies**: [description of what was built]

**Test Command**:
\`\`\`bash
grep -n "[pattern]" [file]
\`\`\`

**AI-Verifiable Output**:
\`\`\`
DIAGNOSTIC: [NAME]
PATTERN_FOUND: YES|NO
LOCATION: [file:line] or NONE
STATUS: PASS|FAIL
\`\`\`

**Triggers**: RC-F001 if STATUS: FAIL
**Priority**: P2
**Status**: ready

---
-->

---

## Fix Details

<!--
### RC-F001: Restore [Name]

**Auto-Generated From**: /w-compound on YYYY-MM-DD
**Type**: Conditional Fix
**Triggered By**: RC-D001 failure
**Priority**: P1 (critical - restores functionality)

**Pattern to Restore**:
\`\`\`typescript
[actual code that was just written]
\`\`\`

**File**: [path/to/file]

**Completion Tests**:
1. Pattern: \`[pattern]\` exists in \`[file]\`
2. Test: RC-D001 returns STATUS: PASS

**Status**: ready (only runs if RC-D001 fails)

---
-->

---

## Archived Candidates

<!-- Completed candidates are moved here -->

| ID | Name | Completed | Result |
|----|------|-----------|--------|
| - | (none yet) | - | - |

---

## Archived Diagnostics

<!-- Verified diagnostics are moved here -->

| ID | Verified | Date | Result |
|----|----------|------|--------|
| - | (none yet) | - | - |

---

## Candidate Guidelines

### ID Formats
| Format | Purpose | Example |
|--------|---------|---------
| RC-### | General candidates | RC-001 |
| RC-D### | Diagnostic candidates | RC-D001 |
| RC-F### | Fix candidates (paired) | RC-F001 |

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

### Diagnostic → Fix Flow
\`\`\`
1. Run RC-D### diagnostic
2. If STATUS: PASS → Log "VERIFIED" → Skip RC-F###
3. If STATUS: FAIL → Run RC-F### → Re-run RC-D### to verify
4. Report final status
\`\`\`

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
