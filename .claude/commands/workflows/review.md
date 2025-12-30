# Review Workflow

Run comprehensive multi-agent code review.

## Usage
```
/compound-engineering:workflows:review [PR number or branch]
```

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
```
/compound-engineering:workflows:review PR#47
```
