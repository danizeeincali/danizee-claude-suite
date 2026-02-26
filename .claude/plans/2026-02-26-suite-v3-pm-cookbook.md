# danizee-claude-suite v3.0 — PM Module + Agent Cookbook Integration

## Interview Summary

**User quotes:**
- "I want you to update the claude-suite repo not what's on your integration"
- "Integrate the cookbook into claude suite so when people get claude suite they get the cookbook. They are still independent."
- "Auto install w/opt out"
- "Let's separate the installation into 2: coding and PM. That way people can just get the light version"
- "Use the PM toggle but you should replace both — just clean out the coding one from all PM-specific stuff"
- "Exclude from package" (re: web dashboard)
- "Exclude instances" (re: instance-aware execution)
- "Include all" (re: domain-specific workflows)
- "Exclude both" (re: Google Docs sync and comments/auth)

## Architecture

### Two Installation Modes

```
danizee-claude-suite init                    # Coding only (light)
danizee-claude-suite init --with-pm          # Coding + PM module
danizee-claude-suite init --without-cookbook  # Skip agent-cookbook
```

**Coding Mode (default):**
- All 19 existing workflow commands (unchanged, except 3 modified ones cleaned of PM refs)
- `/w-idea-tdd-swarm` renamed to `/w-interview-tdd-swarm`
- `/w-background-compound` (new)
- Agent-cookbook client auto-configured
- No database, no TypeScript libs

**PM Mode (--with-pm):**
- Everything in Coding Mode
- 37 new PM workflow commands
- Enhanced w-start, w-end, w-compound (with DB integration)
- SQLite database (data/chief-of-staff.db) with 31 tables
- 10 TypeScript libraries in src/lib/
- `better-sqlite3` dependency

### Agent Cookbook Integration

- `@agent-cookbook/client` added as npm dependency
- On init: creates `~/.agent-cookbook/config.json` with defaults
- Registry URL: `https://agent-cookbook.replit.app`
- Opt-out via `--without-cookbook` flag
- Independent: cookbook works standalone, suite just bundles it

### Plugin Structure

```
src/
├── plugins/
│   ├── dot-shortcuts.js          # MODIFIED: coding workflows (cleaned of PM refs)
│   ├── pm-shortcuts.js           # NEW: PM workflow .md generation
│   ├── agent-cookbook.js          # NEW: cookbook client setup
│   ├── compound-engineering.js   # Existing
│   ├── claude-flow.js            # Existing
│   └── frontend-design.js        # Existing
├── lib/                          # NEW: TypeScript libraries (PM module)
│   ├── db.ts
│   ├── action-items.ts
│   ├── follow-ups.ts
│   ├── follow-up-detector.ts
│   ├── deferred-items.ts
│   ├── context-linker.ts
│   ├── priority-utils.ts
│   ├── insights.ts
│   ├── notes.ts
│   ├── category-detector.ts
│   └── git-utils.ts
```

### Modified Commands (Coding Mode)

**w-start (cleaned):** Load context, git status, menu (no DB, no orphan detection, no pm2)
**w-end (cleaned):** Summary → Compound → Commit (no DB sessions, no deferred items, no auto-merge)
**w-compound (cleaned):** Auto-detect category from git diff (no user gate for category)

### Modified Commands (PM Mode)

**w-start (full):** Context + DB session load + menu (no pm2, no instance detection)
**w-end (full):** Strategic summary → deferred items → DB session → compound → commit
**w-compound (full):** Same as coding (auto-detect category)

## Excluded Features

- Web dashboard (Next.js/pm2)
- Instance-aware execution (CLAUDE_INSTANCE_TYPE)
- Google Docs sync (gdocs_sync table)
- Comments/auth system (users, auth_sessions, comments tables)
- File conflict tracking

## Database Schema (PM Module Only)

31 tables minus excluded ones = ~25 tables:
- Core: contexts, priorities, sessions, meetings, uploads
- Strategic: goals, initiatives, projects, project_sessions
- Knowledge: facts, insights, ideas, ramblings, rambling_versions, knowledge, notes
- Tasks: action_items, follow_ups, deferred_items, opportunities
- Sharing: share_links
- Docs: doc_favorites
- Chronicled: chronicled_facts, chronicled_preferences

## New Workflow Commands (PM Module)

### Action Items
- /w-action, /w-action-done, /w-action-list, /w-action-rebalance, /w-hitlist

### Follow-Ups
- /w-followup, /w-followup-done

### Knowledge Capture
- /w-fact, /w-fact-enrich, /w-fact-search
- /w-insight
- /w-idea, /w-idea-refine, /w-idea-share
- /w-ramble, /w-ramble-refine, /w-ramble-search
- /w-knowledge, /w-knowledge-search

### Strategic Hierarchy
- /w-goal, /w-initiative, /w-project

### Daily Standup
- /w-cos

### Notes & Tools
- /w-notes
- /w-research
- /w-context-switch
- /w-meeting-prep
- /w-doc-review
- /w-ui-references, /w-ui-references-review
- /w-systems-design
- /w-share, /w-share-list, /w-share-revoke

### New Coding Command
- /w-background-compound
