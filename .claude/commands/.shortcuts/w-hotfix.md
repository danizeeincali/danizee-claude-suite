# /w-hotfix

Critical Hotfix - Isolated branch → minimal fix → security-focused review → expedited PR.

## Usage
```
/w-hotfix [issue description]
```

## What Happens
1. **Search** - Find similar incidents
2. **Isolate** - Create hotfix branch
3. **Fix** - Apply minimal targeted change
4. **Security Review** - Focused security analysis
5. **Compound** - Store incident documentation

## Checkpoints
| # | After | You Review |
|---|-------|------------|
| 0 | Search | Similar incidents |
| 1 | Branch created | Isolated hotfix branch |
| 2 | Fix applied | Minimal change for review |
| 3 | Security review | Security analysis complete |
| 4 | Compound | Incident doc to store |

## Compounds
```
Memory: project/incidents/[incident-type]
Doc: docs/solutions/incidents/[incident-name].md
```

## Example
```
/w-hotfix SQL injection vulnerability in search endpoint
```
