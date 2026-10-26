/**
 * Frontend Design Plugin for Danizee Claude Suite
 * Handles design, component, layout, and theme generation
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Get Frontend Design commands
 */
export function getCommands() {
  return {
    'design': {
      name: 'design',
      description: 'Generate UI component designs',
      content: `# Design Workflow

Generate UI component designs with specifications.

## Usage
\`\`\`
/frontend-design:design [component description]
\`\`\`

**Intake first (one batch).** Before designing, write what is known to \`"$BRIEF"\` (\`{kind: landing|ui|motion, answers: {...}}\`), ask every question \`questions\` prints in one round, and fill the gaps with the stated assumptions \`assume\` prints. Before running a block, put the real path in place of each \`NAME='<...>'\` placeholder at its top (the CSS selector for \`BG_SELECTOR\`, a file:// or localhost URL for \`URL\`); shell variables do not persist between Bash calls, so run the block as one. If \`.claude/helpers/kit/cli.js\` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.

\`\`\`bash
BRIEF='<the brief JSON you wrote>'; [ -f "$BRIEF" ] || echo "BRIEF is still the placeholder or does not exist: put the path of the brief JSON you wrote in place of <the brief JSON you wrote>" >&2
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js design-brief questions --file "$BRIEF"; RC=$?; (exit $RC); fi
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js design-brief assume --file "$BRIEF"; RC=$?; (exit $RC); fi
\`\`\`

Exit 0 printed the answer; exit 1 is wrong input or a broken state: report it and fix the input, never read it as a pass. The step is advisory: whatever it prints, the workflow goes on.

## What It Creates
- Component specification
- Visual hierarchy
- Interaction patterns
- Accessibility considerations
- Responsive breakpoints

**Design kit checks (advisory).** For a landing page, the output follows the fixed numbered section sequence \`landing-sections plan\` prints; typography tokens are snapped to Tailwind steps with paired line heights (\`type-scale audit\` on \`"$CSS"\`); sample content follows the realistic-content checklist (\`sample-content lint\` on \`"$PAGE"\`). Before running a block, put the real path in place of each \`NAME='<...>'\` placeholder at its top (the CSS selector for \`BG_SELECTOR\`, a file:// or localhost URL for \`URL\`); shell variables do not persist between Bash calls, so run the block as one. If \`.claude/helpers/kit/cli.js\` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.

\`\`\`bash
CSS='<the stylesheet>'; [ -f "$CSS" ] || echo "CSS is still the placeholder or does not exist: put the path of the stylesheet in place of <the stylesheet>" >&2
PAGE='<the page or copy file>'; [ -f "$PAGE" ] || echo "PAGE is still the placeholder or does not exist: put the path of the page or copy file in place of <the page or copy file>" >&2
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js landing-sections plan; RC=$?; (exit $RC); fi
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js type-scale audit --file "$CSS"; RC=$?; (exit $RC); fi
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js sample-content lint --file "$PAGE"; RC=$?; (exit $RC); fi
\`\`\`

Exit 0 printed the answer; exit 1 is wrong input or a broken state: report it and fix the input, never read it as a pass. The step is advisory: whatever it prints, the workflow goes on.

## Example
\`\`\`
/frontend-design:design user profile card with avatar, name, and action buttons
\`\`\`
`
    },
    'component': {
      name: 'component',
      description: 'Generate framework-specific components',
      content: `# Component Workflow

Generate framework-specific component implementations.

## Usage
\`\`\`
/frontend-design:component [component] --framework [react|vue|svelte]
\`\`\`

## Frameworks Supported
- **React** - Functional components with hooks
- **Vue** - Composition API components
- **Svelte** - Svelte 5 components

## What It Creates
- Component file
- Props/types definitions
- Basic styling
- Unit test skeleton

## Example
\`\`\`
/frontend-design:component UserCard --framework react
\`\`\`
`
    },
    'layout': {
      name: 'layout',
      description: 'Generate page layouts and grids',
      content: `# Layout Workflow

Generate page layouts and grid systems.

## Usage
\`\`\`
/frontend-design:layout [layout type]
\`\`\`

## Layout Types
- **dashboard** - Admin dashboard with sidebar
- **marketing** - Landing page layout
- **form** - Form-centric layout
- **grid** - Custom grid system
- **responsive** - Mobile-first responsive layout
- **landing** - Landing page in the fixed numbered section order: run \`node .claude/helpers/kit/cli.js landing-sections plan\` and lay out its sections in that order (if \`.claude/helpers/kit/cli.js\` is missing, say so in one line and use the marketing layout; advisory, exit 1 is wrong input)

## What It Creates
- Layout structure
- Grid definitions
- Responsive breakpoints
- Container styles

## Example
\`\`\`
/frontend-design:layout dashboard with sidebar and top navigation
\`\`\`
`
    },
    'theme': {
      name: 'theme',
      description: 'Generate design tokens and themes',
      content: `# Theme Workflow

Generate design tokens and theme configurations.

## Usage
\`\`\`
/frontend-design:theme [theme style]
\`\`\`

## Theme Styles
- **light** - Light mode theme
- **dark** - Dark mode theme
- **system** - System preference detection
- **custom** - Custom color palette

## What It Creates
- Color tokens (CSS variables)
- Typography scale
- Spacing system
- Shadow definitions
- Border radius tokens
- Theme toggle utility

## Example
\`\`\`
/frontend-design:theme dark with purple accent colors
\`\`\`
`
    }
  };
}

/**
 * Get plugin namespace
 */
export function getNamespace() {
  return 'danizee-frontend';
}

/**
 * Install Frontend Design plugin
 */
export async function install(claudeDir, options = {}) {
  const commandsDir = path.join(claudeDir, 'commands', 'analysis');

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
    plugin: 'frontend-design',
    namespace: getNamespace(),
    commands: Object.keys(commands)
  };
}

/**
 * Uninstall Frontend Design plugin
 */
export async function uninstall(claudeDir) {
  const commandsDir = path.join(claudeDir, 'commands', 'analysis');

  try {
    await fs.rm(commandsDir, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
}

/**
 * Check if Frontend Design is installed
 */
export async function isInstalled(claudeDir) {
  const commandsDir = path.join(claudeDir, 'commands', 'analysis');

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
