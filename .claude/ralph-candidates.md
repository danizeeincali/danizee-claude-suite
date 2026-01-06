# Ralph Candidates

> Dev patterns identified during compound that could become future Ralph Wiggum loops.
> Use `/w-ralph-pick` to select and execute a candidate.

## Active Candidates

| ID | Priority | Name | Source | Completion Tests | Status |
|----|----------|------|--------|------------------|--------|
| - | - | (none yet) | - | - | - |

---

## Candidate Details

<!--
### RC-001: [Name]
- **Priority:** P1 (critical) / P2 (important) / P3 (nice-to-have)
- **Source:** /w-[workflow] on YYYY-MM-DD
- **Pattern:** Brief description of the repeating dev pattern

**Completion Tests (AI-Verifiable):**
1. [ ] File exists: `path/to/expected/file.ts`
2. [ ] Pattern match: `export function [name]` in `path/to/file.ts`
3. [ ] Test passes: `npm test -- --grep "feature name"`
4. [ ] No lint errors: `npm run lint`

**Status:** draft | ready | in-progress | complete
**Completed:** (date if complete)

---
-->

---

## Archived Candidates

<!-- Completed candidates are moved here -->

| ID | Name | Completed | Result |
|----|------|-----------|--------|
| - | (none yet) | - | - |

---

## Candidate Guidelines

### Good Ralph Candidates Have:
- **Repeating pattern**: Feature or bug fix that occurs multiple times
- **Clear completion signal**: Tests pass, build succeeds, lint clean
- **Iterative nature**: Write code -> run tests -> fix -> repeat
- **Template potential**: Similar to work just completed

### Completion Test Types:
| Type | Format | Example |
|------|--------|---------|
| File exists | `File exists: path` | `File exists: src/components/Button.tsx` |
| Pattern match | `Pattern: "regex" in file` | `Pattern: "export.*Button" in src/components/Button.tsx` |
| Test passes | `Test: command` | `Test: npm test -- --grep "Button"` |
| Lint clean | `Lint: command` | `Lint: npm run lint` |
| Build passes | `Build: command` | `Build: npm run build` |

### NOT Suitable for Ralph:
- General automation (not dev work)
- One-off tasks with no repetition pattern
- Tasks without clear completion signals
- Non-code tasks
