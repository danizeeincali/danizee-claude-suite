# /w-compound

Compound This - Captures current context as reusable knowledge AND auto-generates diagnostic/fix Ralph candidates for overnight verification.

## Usage
```
/w-compound [category]
/w-compound feature
/w-compound bug
```

---

## ⚠️ MANDATORY EXECUTION

This command MUST complete ALL phases including auto-QA generation.

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
3. **Diagnostic Candidates** - RC-D### to verify patterns exist
4. **Fix Candidates** - RC-F### to restore patterns if diagnostics fail

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Category Detection
**REQUIRED OUTPUT:**
- Category selected: _____
- Context to capture: _____

**AUTO-DETECT:** If argument provided, use it. Otherwise, auto-detect from git diff:
```bash
git diff HEAD~1
```
Use weighted pattern matching:
- security (weight 3): injection, vulnerability, sanitize, xss, csrf, auth
- bug (weight 2): fix, bug, patch, hotfix, error handling, fallback
- performance (weight 2): cache, optimize, batch, lazy, memoize, throttle
- architecture (weight 2): refactor, redesign, restructure, migration, rename
- feature (weight 1): export function, new file mode, CREATE TABLE, add/create/implement

Highest score wins. Default to 'feature' on empty diff.

**AUTO-PROCEED:** Continue to Storage phase.

---

### ⛔ CHECKPOINT 1: Storage Complete (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/[category]/_____
- Doc path: docs/solutions/[category]/_____.md
- Pattern stored: yes/no

**🔒 Redact before the solution doc is written:** the solution doc quotes the session's code and diff, which can carry a secret. When `.claude/kit/secrets` exists, no text goes into the doc before it has passed through `redact --keep-lines` (stdin to JSON `{ text, replaced }`; the verb looks for the secrets file at the top of the worktree, then in the main checkout, because the file is git-ignored and a linked worktree usually has no copy of its own). Write the draft of the doc body to a temp file `$E` outside the repository (in the session scratchpad or at a `mktemp` path) with the Write tool, never `echo "<text>"` or a heredoc in the shell, then run the block with `E` bound in the same command (`E=<the path you wrote>; <block>`: shell variables do not persist between Bash calls). One line when the kit is not installed, and one line when there is no secrets file:
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): redact skipped, advisory: use the text from file=$E"; elif S=.claude/kit/secrets; M="$(git rev-parse --git-common-dir 2>/dev/null)/../.claude/kit/secrets"; [ ! -e "$S" ] && [ ! -L "$S" ] && [ ! -e "$M" ] && [ ! -L "$M" ]; then echo "no .claude/kit/secrets: text used as is, nothing to redact: use the text from file=$E"; else ( J=; R=; J=$(mktemp 2>/dev/null) && R=$(mktemp 2>/dev/null) && [ -n "$J" ] && [ -n "$R" ] || { echo "mktemp failed: text not redacted" >&2; rm -f "$J" "$R"; exit 1; }; KEEP=; trap 'rm -f "$J"; [ -n "$KEEP" ] || rm -f "$R"' EXIT INT TERM; node .claude/helpers/kit/cli.js redact --keep-lines < "$E" > "$J"; RC=$?; if [ $RC -eq 0 ]; then node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[2],j.text);console.error("replaced="+j.replaced);console.log("file="+process.argv[2])' "$J" "$R"; RC=$?; [ $RC -eq 0 ] && KEEP=1; else echo "redact failed (exit $RC)" >&2; fi; exit $RC ); fi
```
The pre-check sends anything present at either secrets path to `redact` (`-e` or `-L`: a dangling symlink or a directory there is a broken state, not "absent"), so only a path with nothing at it prints "no .claude/kit/secrets"; say that in one line and continue with the text as is. Exit 0: redacted; the redacted `text` is in the file the block prints as `file=<path>` (call it `$R`), which the block leaves behind, and stderr shows `replaced=<n>`. Exit 1 is bad input or a broken state (an unreadable secrets file, a dangling symlink or a directory at the secrets path, bad flag, mktemp failed, git missing or not a git repository): no file is named; report it, never read it as "nothing to redact", and do **not** write the unredacted text into the solution doc (write the doc without the quoted code or diff text, or stop that step and say so). Any other non-zero exit (for example 127, or a signal) is a failure of that step: the same. If `.claude/helpers/kit/cli.js` is missing the block says so in one line and continues; the kit is advisory and never blocks a workflow that worked before.
Write the solution doc from the file named by `file=` (`cat -- <path>`), never from the unredacted draft, then run `rm -f -- <that path> "$E"` with the literal paths so no unredacted draft stays on disk.

**AUTO-PROCEED:** Continue to Analyze Changes phase.

---

### ⛔ CHECKPOINT 2: Analyze Changes (AUTO-PROCEED)
**Parse git diff to identify what was built:**

Run: `git diff --name-only HEAD~1` and `git diff HEAD~1`

**Categorize changes:**
| Change Type | Detection Method |
|-------------|------------------|
| New function | `+ export function` or `+ function` |
| New interface | `+ export interface` or `+ interface` |
| Pattern change | Significant line changes in existing files |
| Test added | Changes in `*.test.*` or `*.spec.*` files |
| Config change | Changes in config/settings files |

**REQUIRED OUTPUT:**
- Files changed: _____
- Functions added: _____
- Interfaces added: _____
- Patterns modified: _____
- Tests added: _____

**AUTO-PROCEED:** Continue to Generate Diagnostics phase.

---

### ⛔ CHECKPOINT 3: Generate Diagnostics (AUTO-PROCEED)
**For each significant change, create RC-D### diagnostic:**

**Diagnostic Template:**
| Change Type | Diagnostic Command | Pass Criteria |
|-------------|-------------------|---------------|
| Function added | `grep -n "export function NAME" FILE` | Match found |
| Interface added | `grep -n "export interface NAME" FILE` | Match found |
| Pattern exists | `grep -rn "PATTERN" PATH` | N matches found |
| Test passes | `npm test -- --grep "NAME"` | Exit code 0 |
| Pattern removed | `grep -rn "OLD_PATTERN" PATH` | 0 matches |

**For each diagnostic, generate:**
```markdown
### RC-D###: [Name] Exists

**Auto-Generated From**: /w-compound on [DATE]
**Type**: Diagnostic
**Verifies**: [description]

**Test Command**:
```bash
grep -n "[pattern]" [file]
```

**AI-Verifiable Output**:
DIAGNOSTIC: [NAME]
PATTERN_FOUND: YES|NO
LOCATION: [file:line] or NONE
STATUS: PASS|FAIL

**Triggers**: RC-F### if STATUS: FAIL
**Priority**: P2
**Status**: ready
```

**REQUIRED OUTPUT:**
- Diagnostics generated: _____ (list RC-D### IDs)

**AUTO-PROCEED:** Continue to Generate Fix Candidates phase.

---

### ⛔ CHECKPOINT 4: Generate Fix Candidates (AUTO-PROCEED)
**For each diagnostic, create paired RC-F### fix candidate:**

**For each fix, generate:**
```markdown
### RC-F###: Restore [Name]

**Auto-Generated From**: /w-compound on [DATE]
**Type**: Conditional Fix
**Triggered By**: RC-D### failure
**Priority**: P1 (critical - restores functionality)

**Pattern to Restore**:
```[language]
[actual code that was just written]
```

**File**: [path/to/file]

**Completion Tests**:
1. Pattern: `[pattern]` exists in `[file]`
2. Test: RC-D### returns STATUS: PASS

**Status**: ready (only runs if RC-D### fails)
```

**REQUIRED OUTPUT:**
- Fix candidates generated: _____ (list RC-F### IDs)
- Diagnostic → Fix pairs: RC-D001→RC-F001, etc.

**AUTO-PROCEED:** Continue to Append phase.

---

### ⛔ CHECKPOINT 5: Append to Ralph Candidates (AUTO-PROCEED)
**Add all generated candidates to .claude/ralph-candidates.md:**

1. Read current file to find highest RC-D### and RC-F### IDs
2. Assign sequential IDs to new candidates
3. Append to Active Diagnostics table
4. Append to Active Fixes table
5. Append full details to Diagnostic Details and Fix Details sections

**REQUIRED OUTPUT:**
- Candidates appended: _____
- New highest RC-D ID: RC-D___
- New highest RC-F ID: RC-F___
- File updated: .claude/ralph-candidates.md

**AUTO-PROCEED:** Continue to Ralph Candidate Check phase.

---

### ⛔ CHECKPOINT 6: Ralph Candidate Check (MANDATORY)
**Evaluate if this pattern could become a GENERAL Ralph loop (RC-###):**
- Is this a repeating dev pattern beyond just this session?
- Could it be templated for future similar work?

**If YES - Create General Ralph Candidate (RC-###):**
1. Read .claude/ralph-candidates.md for next available RC-### ID
2. Assign priority: P1/P2/P3
3. Define completion tests
4. Add to Active Candidates table

**REQUIRED OUTPUT:**
- General Ralph candidate identified: yes/no
- If yes: ID, priority, tests, status

NEVER skip this phase. Command is INCOMPLETE without all checks.

---

### 🧠 CHECKPOINT 7: Agent Pi Brain — Auto-Recipe Extraction (fork-aware)
**Detect if this work is knowledge-worthy and submit to the registry.**

Check config: read ~/.ruvector/config.json → auto_share section.
Skip if auto_share.enabled is false.

**Recipe-worthy criteria:**
- Workflow had >= auto_recipes.min_steps steps (default: 3)
- Has tests that pass (if auto_recipes.require_tests = true)
- Is a repeatable pattern (not a one-off fix)

**If knowledge-worthy:**
1. Extract recipe: title, description, tags, ordered steps with inputs/outputs
2. **Fork check — discover similar recipes before submitting:**

```bash
# Check for similar existing recipes
curl -s -G "https://pi.ruv.io/v1/memories/search" --data-urlencode "q=[recipe title]" --data top_k=3
```

3. **If similar memory found (score > 0.7):** Submit as a fork to inherit grade
4. **If no match:** Submit as a new recipe
5. If auto_share.confirm = true: ask user before submitting

**🔒 Redact before the POST:** the recipe body can quote the session's code, which can carry a secret. When `.claude/kit/secrets` exists, no recipe text is sent before it has passed through `redact --keep-lines`. Write the JSON body (`title`, `description`, `tags`, `version`, `steps`, and `forked_from` for a fork) to a temp file `$E` outside the repository with the Write tool, never into a double-quoted shell argument and never `echo "<body>"` or a heredoc (backticks and `$( )` in recipe text would run as commands), then run the block with `E` bound in the same command (`E=<the path you wrote>; <block>`). One line when the kit is not installed, and one line when there is no secrets file:
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): redact skipped, advisory: use the text from file=$E"; elif S=.claude/kit/secrets; M="$(git rev-parse --git-common-dir 2>/dev/null)/../.claude/kit/secrets"; [ ! -e "$S" ] && [ ! -L "$S" ] && [ ! -e "$M" ] && [ ! -L "$M" ]; then echo "no .claude/kit/secrets: text used as is, nothing to redact: use the text from file=$E"; else ( J=; R=; J=$(mktemp 2>/dev/null) && R=$(mktemp 2>/dev/null) && [ -n "$J" ] && [ -n "$R" ] || { echo "mktemp failed: text not redacted" >&2; rm -f "$J" "$R"; exit 1; }; KEEP=; trap 'rm -f "$J"; [ -n "$KEEP" ] || rm -f "$R"' EXIT INT TERM; node .claude/helpers/kit/cli.js redact --keep-lines < "$E" > "$J"; RC=$?; if [ $RC -eq 0 ]; then node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[2],j.text);console.error("replaced="+j.replaced);console.log("file="+process.argv[2])' "$J" "$R"; RC=$?; [ $RC -eq 0 ] && KEEP=1; else echo "redact failed (exit $RC)" >&2; fi; exit $RC ); fi
```
The pre-check sends anything present at either secrets path to `redact` (`-e` or `-L`: a dangling symlink or a directory there is a broken state, not "absent"), so only a path with nothing at it prints "no .claude/kit/secrets"; say that in one line and continue with the text as is. Exit 0: redacted; the redacted `text` is in the file the block prints as `file=<path>` (call it `$R`), which the block leaves behind, and stderr shows `replaced=<n>`. Exit 1 is bad input or a broken state (an unreadable secrets file, a dangling symlink or a directory at the secrets path, bad flag, mktemp failed, git missing or not a git repository): no file is named; report it, never read it as "nothing to redact", and do **not** POST the unredacted body (submitted as: skipped, reason: redact failed, exit N). Any other non-zero exit (for example 127, or a signal) is a failure of that step: the same. If `.claude/helpers/kit/cli.js` is missing the block says so in one line and continues; the kit is advisory and never blocks a workflow that worked before.
With no kit or no secrets file the block names `file=$E` and the body is sent as it is: read it once first. Send the body from the file, never by pasting it into the command. Shell variables do not persist between Bash calls, so bind the printed path in the same command, or an unset `$R` posts an empty body:

```bash
R=<printed path>; [ -s "$R" ] || { echo "body file missing or empty" >&2; exit 1; }
# Submit as a fork (when similar memory found; the body file carries "forked_from":"[matched_recipe_id]")
curl -X POST https://pi.ruv.io/v1/memories \
  -H "Content-Type: application/json" \
  --data-binary @"$R" && rm -f -- "$R" "$E"

# Submit as new (when no match; the body file has no forked_from)
curl -X POST https://pi.ruv.io/v1/memories \
  -H "Content-Type: application/json" \
  --data-binary @"$R" && rm -f -- "$R" "$E"
```

Write the literal printed path for `R=` and the path you wrote for `E=`. `$E` holds the unredacted body, so it is removed on every path, sent or abandoned: after a redact exit 1, a failed POST, or a body you decide not to send, run `rm -f -- "$E" "$R"` with the literal paths (`$R` only when a `file=` path was printed). The `&&` leaves the files in place when the POST fails, so a retry needs no rebuild.

**REQUIRED OUTPUT:**
- Recipe-worthy: yes/no
- Similar recipe found: yes/no (if yes: recipe ID and score)
- Submitted as: fork/new/skipped
- Recipe ID: _____ (if submitted)
- Reason if skipped: _____

---

## Completion Checklist

- [ ] Category confirmed
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Doc text and Pi Brain body redacted when .claude/kit/secrets exists (or one line said why not)
- [ ] Changes analyzed
- [ ] Diagnostics generated: RC-D___ to RC-D___
- [ ] Fixes generated: RC-F___ to RC-F___
- [ ] Candidates appended to .claude/ralph-candidates.md
- [ ] General Ralph candidate check completed

⚠️ Command INCOMPLETE until all boxes checked

## Output Summary
At completion, report:
```
Compounded: [category] - [name]
Memory: project/[category]/[name]
Doc: docs/solutions/[category]/[name].md
Auto-generated: N diagnostic/fix pairs for overnight Ralph
  - RC-D001 → RC-F001: [description]
  - RC-D002 → RC-F002: [description]
Run /w-ralph-batch to process overnight.
```

## Example
```
/w-compound feature
# Stores to: project/features/[auto-named]
# Creates: docs/solutions/features/[name].md
# Generates: RC-D001→RC-F001, RC-D002→RC-F002 (auto QA pairs)
```
