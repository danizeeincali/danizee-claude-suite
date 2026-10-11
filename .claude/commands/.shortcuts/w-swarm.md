# /w-swarm

RuFlo Swarm Build - Spawns parallel agents via ruflo for rapid implementation.

## Prerequisites
RuFlo must be installed. If not available, run:
```bash
npx ruflo@latest init
```

## Usage
```
/w-swarm [task description]
```

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for related implementation patterns
2. Decompose task and assign agents
3. Initialize ruflo swarm and spawn agents
4. Execute parallel work and collect results
5. Integrate, verify, and compound solution

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- NEVER skip checkpoints - each requires user confirmation
- NEVER skip compound phase at the end
- NEVER skip ruflo swarm initialization — agents must actually spawn
- VIOLATION: Starting implementation without search = restart workflow

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Search

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to screenshot the current state before changes
2. `agent-browser open <url>` → `agent-browser screenshot`
3. Note current UI state for comparison after build

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- List of related patterns (0+ items with memory keys)
- Relevance assessment for each

**USER GATE:** Use AskUserQuestion
- Question: "Found [N] related patterns. Proceed to task decomposition?"
- Options: ["Proceed", "Use existing solution", "Show more detail"]

STOP and wait for user response.

---

### 🧠 CHECKPOINT 0.5: Pi Brain — Knowledge Discovery
**Search the Pi Brain network for existing knowledge matching this task:**

The search goes to a public service, and a task description can quote a stack trace, a connection string or a token. Write the task description as plain text to a temp file `$D` outside the repository (in the session scratchpad or at a `mktemp` path) with the Write tool, never into a double-quoted shell argument and never `echo "<text>"` or a heredoc (backticks and `$( )` in an error message would run as commands). Then run the block with `D` bound in the same command (`D=<the path you wrote>; <block>`: shell variables do not persist between Bash calls). When `.claude/kit/secrets` exists the text passes through `redact --keep-lines` first, and curl reads the query from the file with `--data-urlencode "q@$Q"`, so nothing of it is pasted into the command or shell-evaluated:

```bash
D=<the path you wrote>
(
  [ -s "$D" ] || { echo "description file missing or empty: search skipped" >&2; exit 1; }
  T=$(git rev-parse --show-toplevel 2>/dev/null); [ -n "$T" ] || T=.
  K="$T/.claude/helpers/kit/cli.js"; S="$T/.claude/kit/secrets"; M="$(git rev-parse --git-common-dir 2>/dev/null)/../.claude/kit/secrets"
  W=$(mktemp -d 2>/dev/null) && [ -n "$W" ] || { echo "mktemp failed: search skipped" >&2; exit 1; }
  trap 'rm -rf -- "$W"' EXIT INT TERM
  Q="$W/q"
  if [ -e "$S" ] || [ -L "$S" ] || [ -e "$M" ] || [ -L "$M" ]; then
    [ -f "$K" ] || { echo "secrets file present but kit missing: not sent (file kept: $D)" >&2; exit 2; }
    node "$K" redact --keep-lines < "$D" > "$W/j"; RC=$?
    [ $RC -eq 0 ] || { echo "redact failed (exit $RC): search not sent" >&2; exit 1; }
    node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[2],j.text);console.error("replaced="+j.replaced)' "$W/j" "$Q" || { echo "redact output unreadable: search not sent" >&2; exit 1; }
  else
    if [ -f "$K" ]; then echo "no .claude/kit/secrets: nothing to redact, description sent as written"; else echo "kit not installed (.claude/helpers/kit/cli.js missing): redact skipped, advisory: no secrets file, description sent as written"; fi
    cp -- "$D" "$Q" || { echo "copy failed: search skipped" >&2; exit 1; }
  fi
  C=$(curl -sS --connect-timeout 10 --max-time 30 -o "$Q.resp" -w '%{http_code}' -G "https://pi.ruv.io/v1/memories/search" --data-urlencode "q@$Q" --data top_k=3); RC=$?
  [ $RC -eq 0 ] || { echo "search failed (curl exit $RC): Pi Brain not searched" >&2; exit $RC; }
  case "$C" in 2??) cat "$Q.resp";; *) echo "search failed (HTTP $C): Pi Brain not searched" >&2; cat "$Q.resp" >&2; exit 22;; esac
)
```

Every temp file sits in the private directory `$W` from `mktemp -d`, which the block removes on every path. The curl prints the HTTP status, with a 10 s connect timeout and a 30 s limit on the whole call; no flag here needs a recent curl. Exit 0 means a 2xx status and prints the registry's answer. Exit 1 is a missing or empty description file, mktemp failed, a failed copy, or a `redact` that failed or printed something unreadable ("redact failed (exit N): search not sent": an unreadable secrets file, a dangling symlink or a directory at the secrets path is a broken state, never "nothing to redact"): nothing was sent. Exit 2 is the refusal "secrets file present but kit missing: not sent": a secrets file exists but `.claude/helpers/kit/cli.js` does not, so the raw text is never sent and `$D` is kept for a run after the kit is restored. Exit 22 is curl exit 0 with a status that is not 2xx (a 404, a 502 or 503, a proxy or captive-portal page): it prints "search failed (HTTP <code>): Pi Brain not searched" and the body to stderr, and that body is never the answer. Exit 28 is a timeout, 6 or 7 is no connection, and any other non-zero exit is curl's own: "search failed (curl exit N): Pi Brain not searched". On any non-zero exit report it and record the search as not done, never as "no matches". With no kit and no secrets file the block says so in one line and sends the description as written; the kit is advisory and never blocks a workflow that worked before. When you are done with the search, or give up on it, run `rm -f -- <the path you wrote>` with the literal path.

**If matching memories found:** Review steps for applicable patterns. Adapt proven approaches. Note memory IDs for voting later.
**If no matches:** Proceed normally.

**REQUIRED OUTPUT:**
- Pi Brain memories found: _____ (0+ results)
- Applicable patterns: _____

---

### ⛔ CHECKPOINT 1: Task Decomposition & Agent Assignment
**Analyze the task and break it into parallel work units.**

**🔗 CALLERS (file:line targets for symbols that will be changed or removed):**
For every file:line target this step names (from the Search results and the assignments below) for a symbol that will be changed or removed, ask the kit who calls it, as `callers --symbol <file>:<name>` with the path relative to the repository top:
```bash
node .claude/helpers/kit/cli.js callers --symbol src/file.js:name
```
Carry each symbol's callers, `floor`, `reasons` and `sentences` forward to the later phases, printing the `sentences` as they are. Zero callers with `floor: true` is never "unused": the floor means same-name calls, calls through a value, interface dispatch or unread files may hide callers, so check those by hand. Exit 0 printed the entry but can still leave a symbol out: read `missing` (each with its reason), `partial` and `not_read`; a symbol in `missing` was not answered (typo, renamed or unread file), never "no callers", and `partial: true` makes every answer a floor; exit 1 is wrong input or a broken state: report it, never read it as "no callers"; exit 2 is a refusal: stop that step and report it as printed. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.

**REQUIRED OUTPUT:**
- Callers of the symbols to be changed or removed: _____ (or the one-line kit skip)
- Task decomposition table:
| Sub-task | Agent Role | Domain | Description |
|----------|-----------|--------|-------------|
| _____ | coder | core | _____ |
| _____ | tester | support | _____ |
| _____ | reviewer | support | _____ |

- Swarm topology: _____ (hierarchical recommended for most tasks)
- Agent count: _____ (3-5 for simple, 6-15 for complex)
- Coordination strategy: _____ (queen-led, peer-to-peer, pipeline)

**USER GATE:** Use AskUserQuestion
- Question: "Task decomposed into [N] sub-tasks across [M] agents. Proceed to spawn swarm?"
- Options: ["Continue", "Revise assignments", "Add more agents"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 2: RuFlo Swarm Initialization & Execution

**Step 1: Initialize the swarm**
```bash
npx ruflo@latest swarm init --topology [chosen-topology] --agents [count]
```

**Step 2: Spawn agents for each sub-task**
For each row in the decomposition table, spawn an agent:
```bash
npx ruflo@latest agent spawn --domain [domain] --role [role] --task "[description]"
```

Alternatively, use the Agent tool to spawn parallel Claude Code agents:
```
Agent(role="coder", task="[sub-task description]", isolation="worktree")
Agent(role="tester", task="[sub-task description]", isolation="worktree")
Agent(role="reviewer", task="[sub-task description]", isolation="worktree")
```

**Step 3: Monitor progress**
```bash
npx ruflo@latest swarm status
```

**Step 4: Collect results**
Wait for all agents to complete. Aggregate their outputs.

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Use agent-browser to verify the implementation visually
2. `agent-browser open <url>` → `agent-browser snapshot -i` → verify elements
3. Compare against pre-change screenshots from Search phase

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Swarm initialization: success/failure
- Agents spawned: _____ / _____ total
- Per-agent results summary:
| Agent | Status | Files Changed | Key Output |
|-------|--------|--------------|------------|
| _____ | _____ | _____ | _____ |

**AUTO-PROCEED:** Continue to Integration phase.

---

### ⛔ CHECKPOINT 3: Integration & Verification
**Merge all agent outputs into a cohesive result.**

**🌐 BROWSER CHECK (conditional):**
If this task involves UI, frontend, or visual changes:
1. Final visual verification with agent-browser
2. `agent-browser open <url>` → `agent-browser screenshot` → compare before/after
3. Verify responsive layout, dark mode, accessibility

If agent-browser is not available, prompt: `npx playwright install`
Skip this block for non-UI tasks.

**REQUIRED OUTPUT:**
- Completed work summary per agent
- Files created/modified: _____
- Conflicts resolved: _____
- Test results: _____
- Integration verified: yes/no

**AUTO-PROCEED:** Continue to Verification phase.

---

### ✅ VERIFICATION CHECKPOINT — Cross-Method Validation
**Independent verification of deliverables. Do NOT trust self-reported results.**

**Verification Checks:**
1. **Files Exist** — Verify all claimed implementation file paths actually exist on disk
2. **Tests Re-run** — Independent re-run of ALL tests (not trusting earlier output)
3. **Git Diff Matches Plan** — Compare `git diff --stat` against planned files-to-modify list
4. **Build Compiles** — Run build command if applicable, verify zero errors
5. **No Regressions** — Run full test suite to catch regressions beyond new tests

**REQUIRED OUTPUT:**
- Files verified: _____ / _____ exist
- Tests re-run: _____ pass / _____ total
- Git diff matches plan: yes/no
- Build status: pass/fail/n-a
- Regressions: none / [list]
- Lens findings: _____ (or the one-line kit skip)

**🔎 Code Analysis (lenses over the change under review):** Run this over the range printed by `diff-range` (everything since the merge base with the upstream branch, plus uncommitted edits and untracked files; the whole history when there is no upstream; no removal check runs in this workflow (lenses only)). If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before. Each block starts with a guard for that: with no kit it prints "kit not installed" and ends with status 0, without closing your shell.

1. Lenses: which review rules apply to the changed files.
```bash
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else D=$(mktemp 2>/dev/null) && [ -n "$D" ] || { echo "mktemp failed: no temp file for the range" >&2; D=; RC=1; }
if [ -n "$D" ]; then node .claude/helpers/kit/cli.js diff-range > "$D"; RC=$?
case $RC in 0) node .claude/helpers/kit/cli.js lenses --diff "$D"; RC=$?;; 3) echo "no change to review"; RC=0;; *) echo "diff-range failed (exit $RC): the change range was not read" >&2;; esac; fi; [ -z "$D" ] || rm -f "$D"; (exit $RC); fi
```

How to read the results: each entry in `fired` (lenses) has a `name`, the `files` it matched and a `body` to apply as an extra check on those files: add its findings to the review findings above, and mention a non-empty `capped` list.
Exit 3 from `diff-range` means an empty range: report "no change to review", never a failure and never "no lens applies"; the block sets its own status to 0 in that case. Exit 1 is wrong input or a broken state, including a git call that ran past the 60000 ms default (the message names it; rerun with `diff-range --timeout <ms>`): report it, never skip the step. Exit 2 is a refusal (the repository, a range over 32 MiB, or the verb itself): report it as printed and stop that step, never retry it. Exit 0 from `diff-range` can still leave files out: it writes a note to stderr for an untracked file over the size cap (`too_large`, named) and for untracked files over the count cap (`max_untracked`, a count only); name each skipped file in the findings, say it was not analysed, and treat every result as a floor. If `diff-range` itself fails the step prints "diff-range failed" and the verb does not run; if the temp file cannot be made it prints "mktemp failed": report that the change was not analysed, never "nothing found". Any other non-zero exit (for example 127, or a signal) is a failure of that step: report it, never read it as nothing found.

**RETRY LOGIC (max 3 retries):**
- PASS → proceed to next phase
- FAIL + retries remaining → log failure reason, fix the issue, re-verify
- FAIL + max retries exceeded → escalate to user with AskUserQuestion

---

### ⛔ CHECKPOINT 4: Compound (MANDATORY - NEVER SKIP)
**REQUIRED OUTPUT:**
- Memory key: project/implementations/_____
- Doc path: docs/solutions/implementations/_____.md
- Pattern stored: yes/no
- Swarm metrics: agents used, topology, execution time

**RALPH CANDIDATE CHECK (MANDATORY):**
- Dev pattern identified for future Ralph loop: yes/no
- If yes, logged to: .claude/ralph-candidates.md (use format: RC-NNN)

**AUTORESEARCH CANDIDATE CHECK (RC-A):**
Scan the work just completed for measurable optimization targets:
1. **Static scan:** Analyze git diff for measurable patterns (function runtimes, test duration, bundle size, query counts, memory usage, coverage gaps)
2. **Agent reflection:** What about this work could be measured and autonomously optimized?
3. **Impact scoring:** Rate each candidate on 4 dimensions (weighted composite):
   - potential (0.35): estimated improvement magnitude (1-10)
   - blast_radius (0.15): files/systems affected, inverted (1-10)
   - risk (0.15): breaking change likelihood, inverted (1-10)
   - value (0.35): user/business value of improvement (1-10)
   - Composite = (potential * 0.35) + ((10 - blast_radius) * 0.15) + ((10 - risk) * 0.15) + (value * 0.35)
4. If candidates found, append RC-A entries to .claude/ralph-candidates.md:
```
## RC-A[NNN]: [Title]
**KPI:** [metric_name]
**Baseline:** [current value]
**Benchmark:** `[command to measure]`
**Impact Score:** [composite] (potential: N, blast_radius: N, risk: N, value: N)
**Files in scope:** [paths]
**Constraints:** [what must not break]
```
- RC-A candidates found: yes/no
- If yes, logged with impact scores to .claude/ralph-candidates.md

NEVER skip this phase. Workflow is INCOMPLETE without compound.

---

## Completion Checklist

Before marking workflow complete, verify ALL boxes:
- [ ] TodoWrite used at start with all 5 phases
- [ ] Checkpoints 0-1 completed with user confirmation
- [ ] RuFlo swarm initialized (Checkpoint 2)
- [ ] Agents actually spawned and completed work
- [ ] Results collected and integrated (Checkpoint 3)
- [ ] Pi Brain discovery completed (CHECKPOINT 0.5)
- [ ] Callers (Checkpoint 1) and lenses (Verification) run, or one line said the kit is not installed
- [ ] Compound phase executed (Checkpoint 4)
- [ ] Memory key stored: _____
- [ ] Solution doc created: _____
- [ ] Ralph candidate check completed

⚠️ Workflow INCOMPLETE until all boxes checked

## Compounds
```
Memory: project/implementations/[task-name]
Doc: docs/solutions/implementations/[task-name].md
```

## Example
```
/w-swarm REST API for user management with CRUD and tests
```
