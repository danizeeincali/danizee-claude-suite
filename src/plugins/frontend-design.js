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

## What It Creates
- Component specification
- Visual hierarchy
- Interaction patterns
- Accessibility considerations
- Responsive breakpoints

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
