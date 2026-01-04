# /w-ralph-this

Ralph Wiggum Loop - Iteratively feed a prompt to Claude until a completion signal is detected.

## What is Ralph Wiggum?

An iterative AI development methodology - a "simple while loop that repeatedly feeds an AI agent a prompt until completion."

## Usage
```
/w-ralph-this [prompt or file path]
/w-ralph-this "Build a REST API with full test coverage"
/w-ralph-this .claude/plans/api-spec.md
```

## What Happens
1. **Detect Input** - File path vs inline prompt
2. **Load Prompt** - Read file or use inline text
3. **Configure** - Set max iterations (default: 10), completion promise
4. **Execute Loop** - Repeatedly feed prompt until completion signal or max iterations
5. **Compound** - Store the successful pattern

## Key Parameters
- **Max Iterations**: Safety limit (default: 10)
- **Completion Promise**: String that signals done (e.g., "DONE", "<promise>COMPLETE</promise>")

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Load | Prompt content and config |
| 1 | Each iteration | Progress and state |
| 2 | Completion | Final result |
| 3 | Compound | Pattern to store |

## Best For
- Greenfield projects with clear success criteria
- Test-driven development cycles
- Tasks executable overnight/unattended
- Feature implementation with measurable completion

## Example
```
/w-ralph-this "Build a CLI tool that converts markdown to HTML. Output <promise>COMPLETE</promise> when all tests pass."
```
