# RuFlo Swarm Integration — Full Multi-Agent Orchestration

## Origin
The swarm feature in danizee-claude-suite is broken — agents don't actually spawn. The `w-swarm` workflow is a manual role-assignment template that never calls the MCP swarm tools. The MCP config points to stale `claude-flow@v3alpha`. RuFlo (the evolution of claude-flow) is at v3.5.15 with a full swarm system.

## Interview Decisions

| Decision | Answer |
|----------|--------|
| What's broken | Agents don't spawn — /w-swarm is just a template |
| Swarm scope | Full ruflo swarm — topologies, consensus, queen coordinator |
| Package | Switch to `ruflo@latest` (drop claude-flow@v3alpha) |
| Which workflows | ALL /w-* that mention swarm (w-swarm, w-tdd-swarm, w-debug, w-idea-tdd-swarm, w-bg-tdd-swarm, w-bg-debug, w-bg-idea-tdd-swarm) |
| Installation | Auto-install ruflo for users, or tell them to install it |

## User Quotes
- "I am getting the sense that it is broken"
- "it should tell the users to install ruflo or install it for them"

## Requirements

1. **Plugin upgrade**: `src/plugins/claude-flow.js` → update to `ruflo@latest` MCP server config
2. **Settings upgrade**: `.claude/settings.json` → `ruflo@latest` instead of `claude-flow@v3alpha`
3. **Auto-install**: During `danizee-claude-suite` install, check if ruflo is available. If not, `npm install -g ruflo@latest` or prompt user.
4. **w-swarm rewrite**: Replace manual template with actual MCP tool calls — `ruflo swarm init`, agent spawn, task submission, result collection
5. **All swarm workflows**: w-tdd-swarm, w-debug, w-idea-tdd-swarm, w-bg-* variants — add ruflo swarm execution in their parallel/build phases
6. **Coordination commands**: Update `swarm-init.md`, `agent-spawn.md`, `memory-ops.md` to use ruflo CLI
7. **Permissions**: Update `.claude/settings.json` permissions from `Bash(npx claude-flow:*)` to `Bash(npx ruflo:*)`

## Files to Update
- `src/plugins/claude-flow.js` — rename to `src/plugins/ruflo.js`, update all references
- `.claude/settings.json` — ruflo MCP server, permissions
- `.claude/commands/.shortcuts/w-swarm.md` — full rewrite with ruflo MCP calls
- `.claude/commands/.shortcuts/w-tdd-swarm.md` — add ruflo swarm in build phase
- `.claude/commands/.shortcuts/w-debug.md` — add ruflo swarm in investigation phase
- `.claude/commands/.shortcuts/w-idea-tdd-swarm.md` — add ruflo swarm in build phase
- `.claude/commands/.shortcuts/w-bg-tdd-swarm.md` — add ruflo swarm
- `.claude/commands/.shortcuts/w-bg-debug.md` — add ruflo swarm
- `.claude/commands/.shortcuts/w-bg-idea-tdd-swarm.md` — add ruflo swarm
- `.claude/commands/coordination/swarm-init.md` — ruflo CLI
- `package.json` — update keywords, add ruflo dependency info
- `src/installer.js` (or equivalent) — auto-install ruflo check
- `README.md` — update Claude Flow → RuFlo references
