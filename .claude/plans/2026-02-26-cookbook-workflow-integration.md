# Cookbook Workflow Integration Spec

## Context
Bake Agent Cookbook auto-receipts, auto-recipes, and recipe discovery into the coding workflow commands.

## Interview Summary
- **Integration model**: Both receipts + recipes
- **Discovery**: Auto-discover at workflow START
- **Runtime**: npm client (`@agent-cookbook/client`) with raw HTTP fallback to `https://agent-cookbook.replit.app`
- **Confirmation**: Honor user config (`~/.agent-cookbook/config.json`)

## Target Workflows

### Discovery (at START)
- `w-tdd-swarm` — Search for recipes matching the feature description
- `w-interview-tdd-swarm` — Search for recipes matching the idea description
- `w-debug` — Search for recipes matching the bug/issue description

### Auto-Receipt (at END, after tests pass)
- `w-tdd-swarm` — Submit receipt with grade (correctness from tests, coverage if available)
- `w-interview-tdd-swarm` — Same as w-tdd-swarm
- `w-debug` — Submit receipt with grade (correctness from fix verification)

### Auto-Recipe (at END, during compound)
- `w-compound` — Detect if work is recipe-worthy, extract and submit
- `w-background-compound` — Same but fully headless (auto-submit if config allows)

## Integration Pattern
Each workflow gets new instructions (not code) in the .md content:
1. **Discovery checkpoint** — query registry API, show matching recipes
2. **Receipt checkpoint** — calculate grade, submit if config.auto_receipts.enabled
3. **Recipe checkpoint** — detect pattern, extract recipe, submit if config.auto_recipes.enabled

## API Calls
```
# Discovery
GET https://agent-cookbook.replit.app/discover?q={description}&top_k=3

# Receipt submission
POST https://agent-cookbook.replit.app/receipts
{ target_id, target_type, grade, grade_components, agent_signature, agent_public_key, timestamp }

# Recipe submission
POST https://agent-cookbook.replit.app/recipes
{ title, description, tags, version, steps[] }
```

## Config Honor Rules
- `auto_receipts.enabled: false` → skip receipt submission
- `auto_receipts.require_tests: true` → only submit if tests passed
- `auto_receipts.min_grade: 0.8` → only submit if grade >= threshold
- `auto_recipes.enabled: false` → skip recipe detection
- `auto_recipes.min_steps: 3` → only extract if workflow had 3+ steps
- `auto_recipes.confirm: true` → ask user before submitting recipe (except background)
