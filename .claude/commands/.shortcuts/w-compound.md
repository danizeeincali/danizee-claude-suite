# /w-compound

Compound This - Captures current context as reusable knowledge (ad-hoc).

## Usage
```
/w-compound [category]
```

---

## ⚠️ MANDATORY EXECUTION

This command MUST complete fully. NEVER skip the storage step.

---

## Categories
- `feature` - Feature implementations
- `bug` - Bug fixes
- `security` - Security improvements
- `performance` - Performance optimizations
- `architecture` - Architecture decisions

## What Gets Stored
1. **Memory Key** - Searchable pattern reference
2. **Solution Doc** - Markdown documentation
3. **Neural Pattern** - Learned behavior for similar problems

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Category Selection
**REQUIRED OUTPUT:**
- Category selected: _____
- Context to capture: _____

**USER GATE:** Use AskUserQuestion
- Question: "Storing as [category]. Confirm?"
- Options: ["Continue", "Change category"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 1: Storage Complete (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/[category]/_____
- Doc path: docs/solutions/[category]/_____.md
- Pattern stored: yes/no

NEVER skip this phase. Command is INCOMPLETE without storage.

---

## Completion Checklist

- [ ] Category confirmed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____

⚠️ Command INCOMPLETE until all boxes checked

## Example
```
/w-compound feature
# Stores to: project/features/[auto-named]
# Creates: docs/solutions/features/[name].md
```
