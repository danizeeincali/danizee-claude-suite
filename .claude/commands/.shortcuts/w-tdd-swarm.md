# /w-tdd-swarm

Full TDD Swarm - Combines planning + test-first + parallel build + comprehensive review.

**Philosophy:** Plan like Full Cycle, test like TDD, build like Swarm.

## Usage
```
/w-tdd-swarm [feature description]
```

## What Happens
1. **Search** - Check features, TDD patterns, implementations
2. **Plan** - Architecture and approach
3. **Spec** - Acceptance criteria and test cases
4. **Test-First** - ALL tests written (must fail initially)
5. **Build** - Swarm implements to pass tests
6. **Review** - Security, performance, architecture
7. **Compound** - Store complete solution

## Strict TDD Rule
Build phase is **BLOCKED** until all tests are written and failing.

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Past solutions, TDD patterns, implementations |
| 1 | Plan | Architecture, files, approach |
| 2 | Spec | Acceptance criteria, test cases |
| 3 | Tests | Test files (must fail - no implementation yet) |
| 4 | Build | Implementation (tests must pass) |
| 5 | Review | Security, performance, patterns, architecture |
| 6 | Compound | Complete solution summary |

## Compounds
```
Memory: project/full-tdd-swarm/[feature-name]
Doc: docs/solutions/full-tdd-swarm/[feature-name].md
```

## Example
```
/w-tdd-swarm user authentication with JWT tokens
```
