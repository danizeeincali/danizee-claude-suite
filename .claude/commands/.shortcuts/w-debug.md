# /w-debug

Deep Debug → TDD Swarm - Thorough investigation then fix with regression tests.

## Usage
```
/w-debug [issue description]
```

## What Happens

### Phase 1: Debug Investigation
1. **Search** - Find related debugging sessions
2. **Analyze** - Form initial hypotheses
3. **Investigate** - Deep dive with multiple tools
4. **Diagnose** - Confirm root cause

### Phase 2: TDD-Swarm Fix
5. **Plan** - Architecture for the fix based on diagnosis
6. **Spec** - Test cases that would have caught this bug
7. **Test-First** - Write regression tests (must fail with current code)
8. **Build** - Swarm implements the fix to pass tests
9. **Review** - Security, performance, ensure no regressions
10. **Compound** - Store root cause + fix pattern

## Strict TDD Rule
Fix phase is **BLOCKED** until regression tests are written and failing.

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Related debugging sessions |
| 1 | Analysis | Initial findings and hypotheses |
| 2 | Diagnosis | Confirmed root cause |
| 3 | Plan | Fix architecture based on diagnosis |
| 4 | Tests | Regression tests (must fail) |
| 5 | Build | Fix implementation (tests pass) |
| 6 | Review | Security, performance, no regressions |
| 7 | Compound | Root cause + fix pattern to store |

## Compounds
```
Memory: project/debugging/[issue-category]
Doc: docs/solutions/debugging/[issue-name].md
Pattern: root cause + regression tests + fix approach
```

## Example
```
/w-debug intermittent API timeouts in production
```
