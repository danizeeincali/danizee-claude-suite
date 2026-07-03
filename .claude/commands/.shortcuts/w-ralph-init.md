# /w-ralph-init

Initialize Pure Ralph structure in the current project. Sets up the bash loop orchestrator and template files.

## What is Pure Ralph?

Pure Ralph is the bash loop approach to AI development:
- **Fresh context each iteration** - No context pollution
- **State through files** - IMPLEMENTATION_PLAN.md is the source of truth
- **External orchestration** - Bash loop controls iteration
- **Backpressure via tests** - Bad work gets rejected automatically

## Usage
```
/w-ralph-init
/w-ralph-init --customize
```

---

## Model Policy (fable/sonnet)

Route EVERY subagent this workflow spawns by work type — never let a spawn silently inherit the session model:

- **Thinking** (planning, architecture, root-cause analysis, adversarial review/verification, final judgment): `model: fable` (claude-fable-5).
- **Execution** (everything else — scoped builds, discovery sweeps, doc/compound writing, mechanical work): `model: sonnet` (Sonnet 5).
- **Opus fallback:** if fable is unavailable (access removed, usage exhausted, or the model errors), fall back to `model: opus` (claude-opus-4-8) for that step.
- **Escalation on detectable failure:** sonnet → fable (substitute opus when fable is unavailable). Never retry the same tier twice.

---

## ⚠️ MANDATORY EXECUTION

This command sets up the Pure Ralph structure. Execute ALL steps.

---

## What Gets Created

```
.claude/ralph/
├── loop.sh              # Bash orchestrator (run this!)
├── PROMPT_plan.md       # Planning mode prompt
├── PROMPT_build.md      # Building mode prompt
├── AGENTS.md            # Validation commands (customize this!)
└── IMPLEMENTATION_PLAN.md  # Task tracking (shared state)

specs/
└── .gitkeep             # Place spec files here
```

---

## Execution Protocol

### ⛔ CHECKPOINT 0: Verify Structure
**Check if Ralph files already exist:**

```bash
ls -la .claude/ralph/
```

**REQUIRED OUTPUT:**
- Ralph directory exists: yes/no
- Files present: _____

**If exists:**
**USER GATE:** Use AskUserQuestion
- Question: "Ralph structure exists. Overwrite?"
- Options: ["Overwrite all", "Keep existing", "Merge (keep customizations)"]

**If not exists:**
**AUTO-PROCEED:** Create structure.

---

### ⛔ CHECKPOINT 1: Create/Update Structure
**Create directories:**
```bash
mkdir -p .claude/ralph specs .claude/plans
```

**Copy template files from installation or create defaults.**

**REQUIRED OUTPUT:**
- Directories created: .claude/ralph/, specs/, .claude/plans/
- Files created: loop.sh, PROMPT_*.md, AGENTS.md, IMPLEMENTATION_PLAN.md
- loop.sh made executable: yes/no

---

### ⛔ CHECKPOINT 2: Customize AGENTS.md
**Detect project type and customize validation commands:**

| Project Type | Detection | Commands |
|--------------|-----------|----------|
| Node.js | package.json | npm test, npm run build |
| Python | pyproject.toml/setup.py | pytest, mypy |
| Go | go.mod | go test, go build |
| Rust | Cargo.toml | cargo test, cargo build |

**USER GATE:** Use AskUserQuestion
- Question: "Detected [project type]. Customize AGENTS.md commands?"
- Options: ["Auto-configure", "Manual edit", "Skip customization"]

STOP and wait for user response.

---

### ⛔ CHECKPOINT 3: Setup Complete
**REQUIRED OUTPUT:**
```
Pure Ralph initialized!

Structure created:
  .claude/ralph/loop.sh (executable)
  .claude/ralph/PROMPT_build.md
  .claude/ralph/PROMPT_plan.md
  .claude/ralph/AGENTS.md
  .claude/ralph/IMPLEMENTATION_PLAN.md
  specs/

To start a Ralph loop:
  1. Add tasks to .claude/ralph/IMPLEMENTATION_PLAN.md
  2. Run: ./.claude/ralph/loop.sh

Modes:
  ./.claude/ralph/loop.sh build    # Build mode (default)
  ./.claude/ralph/loop.sh plan     # Planning mode
  ./.claude/ralph/loop.sh build 50 # Max 50 iterations
```

---

## Completion Checklist

- [ ] Ralph directory created: .claude/ralph/
- [ ] loop.sh created and executable
- [ ] PROMPT_build.md created
- [ ] PROMPT_plan.md created
- [ ] AGENTS.md created (and customized if requested)
- [ ] IMPLEMENTATION_PLAN.md created
- [ ] specs/ directory created
- [ ] User informed of next steps

⚠️ Command INCOMPLETE until all boxes checked

## Example
```
/w-ralph-init
# Creates Pure Ralph structure

# Then start your loop:
./.claude/ralph/loop.sh
```
