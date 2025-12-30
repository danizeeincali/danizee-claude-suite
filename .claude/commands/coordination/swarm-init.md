# Swarm Initialization

Initialize a multi-agent swarm for parallel task execution.

## Usage
```
npx claude-flow@alpha swarm init --topology [hierarchical|mesh|ring|star]
```

## Topologies
- **hierarchical**: Leader agent coordinates worker agents (default)
- **mesh**: All agents communicate with each other
- **ring**: Agents pass work in a circular pattern
- **star**: Central hub agent distributes work

## Example
```bash
npx claude-flow@alpha swarm init --topology hierarchical
```
