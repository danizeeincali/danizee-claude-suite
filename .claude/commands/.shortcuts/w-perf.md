# /w-perf

Performance Audit - Bottlenecks, N+1 queries, memory issues, optimization opportunities.

## Usage
```
/w-perf [target description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past performance optimizations
2. Profile and identify bottlenecks
3. Analyze and prioritize recommendations
4. Compound performance patterns

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip any performance category
- NEVER skip compound phase at the end
- VIOLATION: Incomplete profiling = incomplete audit

---

## Checks Performed
- N+1 query detection
- Memory leak analysis
- CPU bottlenecks
- I/O optimization
- Caching opportunities
- Bundle size analysis

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search
**REQUIRED OUTPUT:**
- List of past optimizations (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] past performance patterns. Proceed to Profiling?"
- Options: ["Continue", "Review past optimizations first", "Show more detail"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Profiling Done
**REQUIRED OUTPUT:**
| Category | Finding | Impact | Location |
|----------|---------|--------|----------|
| N+1 queries | _____ | _____ | _____ |
| Memory | _____ | _____ | _____ |
| CPU | _____ | _____ | _____ |
| I/O | _____ | _____ | _____ |
| Caching | _____ | _____ | _____ |
| Bundle size | _____ | _____ | _____ |

**AUTO-PROCEED:** Continue to Analysis phase.

---

### ⛔ CHECKPOINT 2: Analysis Complete
**REQUIRED OUTPUT:**
- Prioritized recommendations (by impact)
- Estimated improvement metrics
- Implementation suggestions

**AUTO-PROCEED:** Continue to Compound phase.

---

### ⛔ CHECKPOINT 3: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/performance/_____
- Doc path: docs/solutions/performance/_____.md
- All findings documented: yes/no

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 4 phases
- [ ] Checkpoint 0 completed with user confirmation
- [ ] Checkpoints 1-3 completed (auto-proceed)
- [ ] All performance categories checked
- [ ] Recommendations prioritized
- [ ] Compound phase executed
- [ ] Memory key stored: _____
- [ ] Performance doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/performance/[target-area]
Doc: docs/solutions/performance/[audit-name].md
```

## Example
```
/w-perf dashboard loading
```
