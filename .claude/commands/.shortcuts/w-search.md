# /w-search

Search Solutions - Searches memory and solution docs for relevant past work.

## Usage
```
/w-search [query]
```

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search Complete
**REQUIRED OUTPUT:**
- Results count: _____
- Ranked matches with dates:

| # | Memory Key | Date | Relevance |
|---|------------|------|-----------|
| 1 | _____ | _____ | _____ |
| 2 | _____ | _____ | _____ |

**USER GATE:** Use AskUserQuestion (if results found)
- Question: "Found [N] matches. View details for any?"
- Options: ["Show #1", "Show #2", "Show all", "Done"]

STOP and wait for user response.

---

## Memory Namespaces Searched
- `project/features/*`
- `project/bugs/*`
- `project/security/*`
- `project/performance/*`
- `project/architecture/*`
- `project/reviews/*`
- `project/incidents/*`
- `project/implementations/*`
- `project/debugging/*`
- `project/ideas/*`
- `project/ralph-specs/*`

## Example
```
/w-search authentication issues
# Returns:
#   - project/bugs/auth-logout-reset (Dec 2024)
#   - project/features/oauth2-google (Nov 2024)
#   - project/security/auth-module (Oct 2024)
```
