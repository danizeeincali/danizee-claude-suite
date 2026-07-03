# /w-agent-interview-swarm

Interview then Spawn Autonomous Agent. Interactive interview refines the idea, then spawns a terminal agent (tmux + worktree) to build it with zero gates.

**Philosophy:** Humans are best at requirements. Agents are best at execution. Split the work.

## Usage
```
/w-agent-interview-swarm [description or file path]
/w-agent-interview-swarm I want some kind of notification system
```

---

## Model Policy (fable/sonnet)

Route EVERY subagent this workflow spawns by work type — never let a spawn silently inherit the session model:

- **Thinking** (planning, architecture, root-cause analysis, adversarial review/verification, final judgment): `model: fable` (claude-fable-5).
- **Execution** (everything else — scoped builds, discovery sweeps, doc/compound writing, mechanical work): `model: sonnet` (Sonnet 5).
- **Opus fallback:** if fable is unavailable (access removed, usage exhausted, or the model errors), fall back to `model: opus` (claude-opus-4-8) for that step.
- **Escalation on detectable failure:** sonnet → fable (substitute opus when fable is unavailable). Never retry the same tier twice.

---

## ⚠️ MANDATORY FIRST ACTION

Use TodoWrite NOW to create todos for ALL phases:
1. Search for past solutions
2. Interview to refine idea
3. Save refined spec to .claude/plans/
4. Spawn terminal agent with spec

⚠️ VIOLATION: Any action before TodoWrite = restart workflow

---

## Rules

- Interview phase HAS user gates (needs human input)
- After interview completes, ALL remaining work is autonomous
- The spawned agent runs /w-agent-tdd-swarm (gateless)
- The spawned agent creates the PR automatically

---

## Execution Protocol

### PHASE 0: Context Gathering (AUTO-PROCEED)
**Run /w-start on yourself first** to load project context, memory, follow-ups, and session state.

**AUTO-PROCEED:** Continue to Search.

---

### PHASE 0.5: Search (AUTO-PROCEED)
Search for past solutions. Check memory keys, search codebase.

**AUTO-PROCEED:** Continue to Pi Brain Discovery.

---

### PHASE 0.75: Pi Brain — Knowledge Discovery (AUTO-PROCEED)
**Search the Pi Brain network for existing knowledge matching this idea:**

```bash
# npm client (preferred)
curl -s -H "Authorization: Bearer anonymous" "https://pi.ruv.io/v1/memories/search "[idea description]" --top-k=3

# HTTP fallback
curl -s "https://pi.ruv.io/v1/memories/search?q=[idea description]&top_k=3"
```

**If matching memories found:** Share findings with user during interview. Note recipe IDs for the spawned agent's auto-receipt.
**If no matches:** Proceed normally.

**AUTO-PROCEED:** Continue to Interview.

---

### ⛔ PHASE 1: Interview (USER GATES — MANDATORY)
**Interview Categories:**

**Technical & Architecture**
- Implementation approach, tradeoffs, edge cases
- How this fits with existing systems
- What could break or need migration

**Human & Workflow**
- Who else is affected?
- What's the manual fallback if automation fails?
- How will you know it's working? What does success look like?

**Strategic**
- Why now? What's the cost of waiting?
- What's the simplest version that delivers value?
- What would make you regret building this?

**Interview Rules:**
- Ask ONE question at a time using AskUserQuestion
- Go deep on answers revealing uncertainty or assumptions
- Don't ask obvious questions — push on unthought things
- Capture quotable moments verbatim for the spec
- End with: "What did I forget to ask about?"

**REQUIRED OUTPUT:**
- Interview notes with user quotes
- Refined requirements list

**USER GATE:** Use AskUserQuestion
- Question: "Interview complete. Here's the refined spec. Ready to spawn the agent?"
- Options: ["Spawn agent", "Add more questions", "Revise spec"]

STOP and wait for user response.

---

### PHASE 2: Save Spec (AUTO-PROCEED)
Save the refined spec to: `.claude/plans/YYYY-MM-DD-[name].md`

Include: requirements, acceptance criteria, key decisions, user quotes.

**AUTO-PROCEED:** Continue to Spawn.

---

### PHASE 3: Spawn Terminal Agent (AUTO-PROCEED)
**Use the spawn_terminal_agent MCP tool:**

- `repo_path`: Current repository path
- `task`: The complete refined spec from the interview
- `workflow`: "/w-agent-tdd-swarm"
- `parent_agent_id`: Your own tmux session name (so the child can notify you when done)

To find your own tmux session name, run: `tmux display-message -p '#S'` (if not in tmux, omit parent_agent_id)

**After spawning, report to the user:**
- Agent ID
- Branch name
- The agent will notify you when done via `redirect_terminal_agent`
- The agent will write a report to `.claude/agent-reports/{agent-id}.md`
- The agent will create a PR with `gh pr create --fill`
- To check status manually: `check_terminal_agents` MCP tool
- To read the report: `get_agent_report` MCP tool

**REQUIRED OUTPUT:**
- Agent ID: _____
- Branch: _____
- Parent agent ID: _____ (or "not in tmux")
- Spec file: .claude/plans/YYYY-MM-DD-[name].md

---

## Completion Checklist

- [ ] Interview conducted with multiple questions
- [ ] Spec saved to .claude/plans/
- [ ] Terminal agent spawned via spawn_terminal_agent with parent_agent_id
- [ ] Agent ID reported to user
