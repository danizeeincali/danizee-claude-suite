# /w-background-compound

Fire-and-Forget Compound. Auto-detects category and dispatches to a background agent. No human interaction at any point.

## Usage
```
/w-background-compound [category]
/w-background-compound feature
```

---

## Model Policy (token/cost)

This flow is mechanical checklist work with hard verification (git status/log) — it does not need
the premium session model. **Dispatch the background agent with `model: sonnet`** (Agent tool
`model` param). Spawn any extra utility probes (file inventories, greps) with `model: haiku`. Only
the thin pre-flight in the main loop runs on the session model. Never dispatch /bc on the session
model by silent inheritance.

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Pre-flight
- **Step 1:** Category detection (argument or auto-detect from git diff HEAD~1)
  - Use weighted pattern matching: security(3), bug(2), performance(2), architecture(2), feature(1)
  - Highest score wins. Default to 'feature' on empty diff.
- **Step 2:** Branch detection (current branch name)
- **Step 3:** Merge decision (auto-resolved based on branch)

**AUTO-PROCEED:** Continue to Background Dispatch.

---

### ⛔ CHECKPOINT 1: Background Dispatch
Launch a background agent via the Task tool — pass `model: sonnet` (see Model Policy) — that runs 4
phases autonomously:

**Phase 1: Inline Compound**
- Storage: memory key + solution doc
- Analyze: parse git diff for functions, interfaces, patterns, tests
- Diagnostics: generate RC-D### for each significant change
- Fixes: generate paired RC-F### for each diagnostic
- Append all to .claude/ralph-candidates.md
- Ralph candidate check

**Phase 1.5: Agent Pi Brain — Knowledge Discovery (read-only)**
- Search for similar memories:
  `curl -s -H "Authorization: Bearer anonymous" "https://pi.ruv.io/v1/memories/search?q=[title]&top_k=3"`
- If matching memories found (score > 0.7): log applicable patterns in summary
- Log result (found/not-found)

**Phase 2: Git Commit**
- Stage specific changed files only (NOT git add -A)
- Commit with descriptive message

**Phase 3: Git Push/Merge**
- Push current branch
- If not main: merge to main and cleanup

**Phase 4: Final Summary Report**
- Log what was compounded, committed, and pushed

**ERROR HANDLING:** Log errors but NEVER abort. Complete as many phases as possible.

---

## Difference from /w-compound

| Aspect | /w-compound | /w-background-compound |
|--------|-------------|----------------------|
| User gates | 0 (auto-detect) | 0 |
| Auto-merge | No | Yes |
| Auto-push | No | Yes |
| Runs in | Foreground | Background agent |
| Error handling | May block | Logs, never aborts |

## Example
```
/w-background-compound
/w-background-compound feature
```
