# Component Workflow

Generate framework-specific component implementations.

## Usage
```
/frontend-design:component [component] --framework [react|vue|svelte]
```

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
```
/frontend-design:component UserCard --framework react
```
