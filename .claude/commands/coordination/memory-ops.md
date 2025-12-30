# Memory Operations

Store and retrieve solution patterns for knowledge compounding.

## Operations

### Search Memory
```
mcp__claude-flow__memory_search { pattern: "project/features/*" }
```

### Store Pattern
```
mcp__claude-flow__memory_usage { action: "store", key: "project/features/[name]" }
```

### Query Memory
```
mcp__claude-flow__memory_usage { action: "query", key: "project/bugs/*" }
```

### Learn from Outcome
```
mcp__claude-flow__neural_patterns { action: "learn" }
```

## Memory Namespaces
- `project/features/*` - Feature implementations
- `project/bugs/*` - Bug fixes
- `project/security/*` - Security findings
- `project/performance/*` - Performance optimizations
- `project/architecture/*` - Design decisions
- `project/reviews/*` - Review findings
- `project/incidents/*` - Incident responses
