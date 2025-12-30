# Agent Spawning

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
```
Task("agent-type", "task description", "role")
```

## Example
```bash
Task("coder", "Implement user authentication with JWT", "coder")
Task("tester", "Write unit tests for auth module", "tester")
```
