# Swarm Initialization

Initialize a multi-agent swarm for parallel task execution using RuFlo.

## Usage
```
npx ruflo@latest swarm init --topology [hierarchical|mesh|ring|star]
```

## Topologies
- **hierarchical**: Queen agent coordinates domain workers (default, recommended)
- **mesh**: All agents communicate with each other (high redundancy)
- **ring**: Agents pass work in a circular pattern (sequential pipelines)
- **star**: Central hub agent distributes work (centralized control)

## Quick Start
```bash
# Initialize with default hierarchical topology
npx ruflo@latest swarm init --topology hierarchical --agents 5

# Check swarm status
npx ruflo@latest swarm status

# Spawn additional agent
npx ruflo@latest agent spawn --domain core --role coder
```

## Domain-Based Agent Hierarchy
| Domain | Agents | Purpose |
|--------|--------|---------|
| queen | 1 | Central coordinator, consensus, planning |
| security | 2-4 | Threat analysis, CVE remediation, security testing |
| core | 5-9 | System design, implementation, memory |
| integration | 10-12 | Agentic flow, CLI features |
| support | 13-15 | TDD testing, performance, deployment |
