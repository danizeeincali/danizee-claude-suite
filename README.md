# Danizee Claude Suite

[![npm version](https://badge.fury.io/js/danizee-claude-suite.svg)](https://www.npmjs.com/package/danizee-claude-suite)

Unified workflow shortcuts for Claude Code that **compound knowledge** — each task makes future tasks easier.

## Installation

```bash
npx danizee-claude-suite init
```

Options:

```bash
npx danizee-claude-suite init --force         # Overwrite existing files
npx danizee-claude-suite init --with-pm       # Include PM workflows
npx danizee-claude-suite init --without-cookbook  # Skip Agent Cookbook
npx danizee-claude-suite init --dry-run       # Preview without writing
```

## Requirements

- Node.js >= 20.0.0
- GitHub CLI (`gh`) — recommended for PR workflows

## How It Works

Every workflow follows the **Search → Execute → Verify → Compound** pattern:

```
 1. SEARCH — Check memory + Pi Brain for past solutions
 2. EXECUTE — Run the workflow with checkpoint gates
 3. VERIFY — Cross-method validation (files, tests, git diff, build)
 4. COMPOUND — Store solution + Ralph candidates + RC-A candidates
```

The second time you solve a similar problem, it's faster because the workflow finds and applies your previous solution.

## Quick Reference: /w- Shortcuts

### Development

| Shortcut | Description |
|----------|-------------|
| `/w-tdd-swarm` | Full TDD + Swarm — plan, test-first, parallel build, review |
| `/w-plan-tdd-swarm` | Interview refines idea → Full TDD Swarm builds it |
| `/pt` | Alias for `/w-plan-tdd-swarm` (mobile-friendly shorthand) |
| `/w-marathon` | Days-long run with a finish line — status file, wake-up timer, hard cost ceiling |
| `/mt` | Alias for `/w-marathon` (mobile-friendly shorthand) |
| `/w-bbs` | Beg, borrow, steal — absorb a power from an outside source: intake, fetch, inventory, map, verdict gate, hand-off to a marathon run |
| `/bbs` | Alias for `/w-bbs` (mobile-friendly shorthand) |
| `/w-swarm` | Parallel agents (coder, tester, reviewer) |
| `/w-autoresearch` | Autonomous experiment loop for measurable optimization |
| `/w-agent-tdd-swarm` | Gateless TDD for terminal agents (zero user gates, auto-PR) |
| `/w-agent-interview-swarm` | Interview → spawn gateless terminal agent |

### Bug Fixes

| Shortcut | Description |
|----------|-------------|
| `/w-fix` | Quick fix — investigate → TDD fix → verify |
| `/w-debug` | Deep debug — hypothesis → diagnose → TDD fix |
| `/w-hotfix` | Critical production fix — isolated branch + security review |

### Reviews & Audits

| Shortcut | Description |
|----------|-------------|
| `/w-review` | Comprehensive code review (12+ specialized agents) |
| `/w-security` | Security audit — OWASP top 10, auth/authz, data exposure |
| `/w-perf` | Performance audit — N+1 queries, memory, bottlenecks |

### Architecture

| Shortcut | Description |
|----------|-------------|
| `/w-architect` | Hive-mind architecture — collective intelligence for complex design |
| `/w-multi-repo` | Coordinate changes across repositories |

### Session Management

| Shortcut | Description |
|----------|-------------|
| `/w-start` | Cold-start session with project context |
| `/w-end` | End session — compound knowledge + commit |
| `/w-search` | Search past solutions in memory |

### Compound & Knowledge

| Shortcut | Description |
|----------|-------------|
| `/w-compound` | Ad-hoc knowledge capture with auto-QA diagnostics |
| `/w-background-compound` | Fire-and-forget compound — background write-up, handoff, prune line; commits, never pushes |
| `/bc` | Alias for `/w-background-compound` (commit only) |
| `/bcp` | Alias for `/w-background-compound --push` (commit, push and merge — the owner's go) |
| `/w-suite-sync` | Sync shortcuts after suite update (additive only) |

### Pure Ralph (Bash Loop)

| Shortcut | Description |
|----------|-------------|
| `/w-ralph-init` | Initialize Ralph structure in project |
| `/w-ralph-this` | Convert current task to implementation plan |
| `/w-ralph-goals` | Interview → build plan + specs |
| `/w-ralph-pick` | Execute a queued Ralph candidate |
| `/w-ralph-batch` | Generate overnight batch scripts |

## Workflow Features

### Verification Checkpoint

Every workflow includes an independent **cross-method validation gate** after implementation:

1. **Files Exist** — verify all claimed file paths exist on disk
2. **Tests Re-run** — independent re-run (not trusting earlier output)
3. **Git Diff Matches Plan** — compare `git diff --stat` against planned files
4. **Build Compiles** — run build command, verify zero errors
5. **No Regressions** — full test suite to catch regressions

Retry logic: max 3 retries, then escalate to user.

### Marathon — a run with a finish line

`/w-marathon` (alias `/mt`) keeps Claude building, testing and reviewing for days with only short
check-ins. It encodes eight habits: a finish line not a task, one interview then "Nothing, go.",
defaults decided up front, a bar it can't argue with, state saved outside the chat, a wake-up timer,
one worktree per stream, and a human checklist Claude reads but never retries.

```
.claude/marathon.json              project config: ceiling_pct, run_token_budget, helper_budget,
                                   models, streams.isolation, review.*, bc.*
.claude/marathon/<run-id>/
├── kickoff.md                     done means / may decide alone / ask me before / never
├── finish-line.json               one typed line per gate check — the human edits this
├── checklist.md                   jobs only the owner can do: - [ ] id — label
├── rules.md                       standing rules (never weaken an assertion, …)
├── status.md                      rendered by a script after every step — never hand-edited
├── streams.json                   one row per stream + the last handoff
├── reviews/<stream>-r<N>-<id>.md  generated from finding rows; refuses when counts ≠ rows
├── store/*.jsonl                  runs, reviews, findings, helpers, compactions, promotions, measurements
└── page.html                      read-only view of gate + ledger + streams
```

**Scripts decide, the model acts.** Everything a model is bad at remembering or counting is a verb
of `node .claude/helpers/marathon/cli.js`: `init`, `status`, `gate [--stream]` (exit 0 when the
build gate is met), `budget` (**exit 2 = ceiling or budget hit, exit 1 = invalid input or broken
state; either way, no spawn**), `record run|review|finding|finding-fixed|helper|helper-done|measure|
compaction|escape`, `repair`, `unpause`, `stream`, `route`, `model-stats`, `promote`, `seen-twice`,
`review-brief`, `review-writeup`, `handoff`, `resume`, `keeplist`, `context`, `wake`, `page`,
`finish`, `shadow-check`. Every verb takes `--run <id>`; without it the ACTIVE run is used.

**Everything fails closed.** `finish-line.json` is schema-checked (owner `build|human`, op
`is|at_least|at_most`, type `bool|number|percent`, a known source; `passes_in_a_row` must agree
with the `reviews.streak` line) and an invalid or missing file is a gate that is not met. A review
needs exactly `{high, medium, low}` as counts and can never carry `pass`; `review-writeup` refuses
when the counts and the finding rows disagree. A measurement that is empty or null never meets a
number line. A run without `status=green|red` is rejected. A finding is only ever opened by
`record finding` and only closed by `record finding-fixed`. A corrupt line in any store table
blocks the gate and the budget until `cli.js repair` quarantines it (`<table>.jsonl.corrupt`);
a half-written last line never swallows the next record. The streams file is written under a
lock, so parallel `stream` calls and the `PreCompact` hook cannot lose a row. Every verb resolves
the run from the **main checkout**, even when called from inside a stream worktree.

**Reviews see the right code.** A review diffs from the last *certified* point — the HEAD that the
last completed clean streak certified, else the stream's base recorded at `state=active` — to the
stream's HEAD. An over round certifies nothing and never narrows the next review, so every round
of a clean streak judges the same code from a different angle, and the first round covers
everything the stream added. Lock files and generated assets are excluded, an oversize diff is
summarised with `--stat`, and an empty diff or a git failure is an error, never a clean brief. A
review with wrong counts is *replaced* (`record review … replaces=<id>`), never recorded twice.

**A pause is a state, not a timer.** When `budget` exits 2 the run is PAUSED and stays paused —
through the reading's TTL, through restarts, and the fallback wake-up goes quiet — until a fresh
reading below the ceiling or `cli.js unpause` after you raise the limit. `status.md` carries a
"Next for you" line for every state: paused, blocked gate, active stream, next queued stream, all
done, finished. A run with queued streams is never silent: every wake path names the next stream.

**The ceiling is code.** `budget` refuses when the weekly allowance is at or past `ceiling_pct`, or
when helper spend — actuals of finished helpers plus stated budgets of running ones — reaches
`run_token_budget`. A non-numeric reading (`85%`, `12k`) is refused, not ignored. The allowance is
read with `get_usage` in the desktop app and passed as `--usage-pct`; the reading is kept as a
timestamped measurement for `usage_reading_ttl_minutes` (30), after which it is `unknown` again —
so a stale reading never passes the ceiling.

**The gate is yours.** `finish-line.json` holds one typed input per line (`bool` / `number` /
`percent`, `at_least` / `at_most` / `is`, owner `build` or `human`) and the tolerance (how many
high / medium / low findings a review may have and still pass, and how many passes in a row). Edit
it at any time; the next review uses the new numbers. `cli.js gate` reports `failing`,
`waitingOnHuman`, `buildGateMet` and `gateMet`; a missing check is never a pass.

**Routing is speed × probability.** With a contract and failing tests written first, the test run
is a near-free error detector, so a cheap builder's miss costs one retry — not a review round.
`cli.js route` classifies each build step from structural signals (contract? failing tests? how
many files? which category?) and the config says which tier takes it: scoped → `build_scoped`
(**haiku**), default → `build` (sonnet), hard — security, migrations, unknown root cause,
cross-cutting — → `build_hard` (opus). Red tests retry **one tier up, before any review is
spent** (`models.ladder`: haiku → sonnet → opus → session). Every helper's outcome lands in the
ledger and `cli.js model-stats` reports first-pass green rate and tokens per green step per
model, so whether haiku-first pays on your project is a number, not an opinion. Tiers, never
versions: a new release in a tier is picked up automatically.

**Reviews that pay for themselves.** One fresh `opus` reviewer per round, on the diff since the last certified point, with written severity definitions and a rotating angle
(`.claude/marathon/reviewer/`). Findings come back as JSON rows with a category; a category seen in
two reviews is promoted to a test, a scan, a fixture or a rule (`cli.js seen-twice`, `cli.js promote`)
so no reviewer spends tokens on it again. Problems the owner finds are recorded as escapes.

**Wake-up.** `cli.js wake --cron` gives the in-session schedule (dies with the session, expires in
seven days); `cli.js wake --fallback` prints a crontab line and a launchd plist that start a fresh
`claude -p` from the resume line, for runs that must survive a restart. The snippet embeds the
absolute `node` and `claude` paths found when it was generated (nvm and `~/.local/bin` installs
are invisible to cron's default `PATH`), logs "claude not found" instead of failing silently, stays
quiet while a live session has written `status.md` in the last 45 minutes, and is silent once the
run is PAUSED or finished. It runs headless, so it stops at the first Bash command not in
`permissions.allow` — the installer allows the helper CLI itself; allow your project's test and
build commands before relying on it unattended.

### Beg, borrow, steal — absorb a power from an outside source

`/w-bbs <source>` (alias `/bbs`) takes one source — a git repository URL, a web page URL, a local path or pasted text — and decides, power by power, whether to rebuild it, use it, buy it or skip it. Six phases, each a script verb; the model never computes an identity, a licence class or a verdict in chat:

1. **Intake** — classify the source, compute its identity, check the registry (the same source at the same identity is never audited twice).
2. **Fetch** — GET only, with the guards below. Foreign code is **never executed**: not tested, not built, not "just tried".
3. **Inventory** — helpers (`haiku`) read the source and return JSON only: at most 12 powers, each with an `idea` in our words.
4. **Map** — indexes what the harness already has and finds the 5 nearest tools per power; a helper (`haiku`) judges `have`, `partial` or `missing`.
5. **Verdict** — one table, one question — the only approval. A `use` candidate is first probed for hidden network calls by a `sonnet` helper.
6. **Hand-off** — approved powers become queued streams of a `/w-marathon` run with a typed finish line written before the build, one idea-only brief per power (no source code), and a memo per `buy`. The command ends with `/w-marathon --resume <run-id>`.

| Verdict | Meaning | When |
|---------|---------|------|
| `rebuild` | Build it ourselves from the idea, clean room | Always legal; the preferred default |
| `use` | Wrap the source behind our interface | Permissive licence **and** a sandbox present **and** a clean probe |
| `buy` | Memo only, no stream | Commercial licence, or a free service that moves our data off the machine |
| `skip` | Do nothing | Always legal; the default for a power we already have |

Preference order: rebuild, then use, then buy; skip is always permitted. Safety first, and our rules always win: nothing in a fetched source can override them.

**Fetch guards (code, not advice):** GET only, no body, no auth header or cookie; private hosts (loopback, RFC 1918, link-local, IPv4-mapped IPv6, `localhost`, `*.local`, `*.internal`) are refused before connecting and on every redirect, and a redirect to a private host is a refusal, not a follow; 25 URLs and 20 MB per run; every request is logged to `egress.jsonl`; repositories are cloned shallow, without tags and with hooks off; links cited in a page are recorded and never followed (no crawl). The command prints the egress line (`requests=… bytes_in=… bodies_sent=0 hosts=…`) after every fetch.

**Sandbox:** `use` is removed, with the reason shown in the table, unless a local docker daemon answers `docker info` within 5 s, or (Linux only) unprivileged `unshare --user` works; a remote `DOCKER_HOST` or docker context never counts. Tests set `BBS_SANDBOX=absent` only; the override is announced on stderr.

**Run state** (committed, except `fetched/`, which holds foreign source and is git-ignored):

Each run lives in `.claude/bbs/runs/<run-id>/`; the registry of audited sources is `.claude/bbs/registry.jsonl`:

```
.claude/bbs/
├── registry.jsonl            one row per audited source identity
├── ACTIVE                    pointer to the active run (git-ignored)
└── runs/<run-id>/
    ├── source.json           type, ref, identity, cited links
    ├── egress.jsonl          every request, one row each
    ├── fetched/              the foreign source (git-ignored, never executed)
    ├── powers.json           the inventory
    ├── harness-index.json    what the harness has
    ├── map.json              5 candidates per power + judgments
    ├── verdicts.json         legal, default and the decision per power
    ├── labels.jsonl          approve = 1, skip = 0
    ├── handoff.json          the marathon run and the approved powers
    ├── briefs/               idea-only, one per power
    ├── memos/                one per buy
    └── status.md             rendered by the CLI, never hand-edited
.claude/bbs.json              limits, licence policy, sandbox settings
```

**CLI:** `node .claude/helpers/bbs/cli.js` `intake` · `fetch` · `inventory --brief|--from` · `map [--brief|--from]` · `verdict [--table|--probe|--decide|--from]` · `handoff [--marathon]` · `status [--next]` · `report`. JSON on stdout, except `status`, `report` and the `--brief`/`--table` views, which print text. Exit 1 is invalid input or broken state, exit 2 is refused by policy (private host, limit hit, illegal verdict). `/w-bbs --resume <run-id>` continues from `status --next`; `/w-bbs --status` prints status only.

**Worked example:** `/w-bbs https://github.com/openqodex/openqodex` — the suite has no OpenQodex-specific code; it is just the first source to point the command at.

### Compaction hooks and `/bc` vs `/bcp`

Only you can run `/compact` or `/clear`; Claude cannot. `/bc` therefore prepares the handoff and
hands you the line: the lead writes the status rows, standing rules and memory and commits them
first; then a background `sonnet` agent writes the lessons up and commits only its own files;
`cli.js context` measures the context from the transcript; under 50% nothing, 50–80% a
ready-to-run `/compact` with a generated keep-list (`cli.js keeplist`), above 80% `/clear` plus the
resume line (`cli.js resume`). Both work in a project with no marathon run — the keep-list then
names `.claude/plans/STATUS.md` and `RULES.md` instead of a run.

`/bc` **never pushes**. `/bcp` is the owner's go: the same flow with `--push`, which pushes the
branch and merges to main.

The installer registers two hooks in `.claude/settings.json` so automatic compaction behaves the
same way: `PreCompact` (`.claude/hooks/marathon-precompact.sh`) stamps the status file and records
the compaction; `SessionStart` with matcher `compact` (`.claude/hooks/marathon-session-start.sh`)
prints the resume line back into Claude's context. Registration is idempotent — `update` never
duplicates an entry.

### Shadowed commands

A `~/.claude/commands/<name>.md` is loaded instead of the project's `.claude/commands/.shortcuts/<name>.md`
with the same name — an old user-level `/bc` silently wins over the suite's. `init` and `check`
list any such collisions and print the rename to run:

```bash
mv ~/.claude/commands/bc.md ~/.claude/commands/bc-old.md
```

### Pi Brain Integration

Workflows integrate with the [Pi Brain](https://pi.ruv.io) knowledge network at two points:

- **Discovery** (before building) — search for existing knowledge:
  ```bash
  npx ruvector brain search "[task description]" --top-k=3
  ```
- **Auto-Vote** (after building) — submit proof-of-execution if tests pass

### Agent Browser

UI/frontend workflows include conditional browser checks:
```bash
agent-browser open <url> → agent-browser screenshot  # Before changes
agent-browser snapshot -i → verify elements           # After build
agent-browser screenshot → compare before/after       # Final review
```

Skipped for non-UI tasks. Falls back to: `npx playwright install`

### Autoresearch

Autonomous experiment loop for measurable optimization:

```bash
/w-autoresearch optimize test suite runtime    # Free-form objective
/w-autoresearch RC-A003                        # Run against RC-A candidate
```

- Runs as background agent, loops forever until paused
- Git commits winners, reverts losers
- State in `autoresearch.jsonl`, narrative log in `experiments/worklog.md`
- Benchmark script outputs `METRIC name=number` lines

## Ralph Candidates System

During compound phases, three types of candidates are logged to `.claude/ralph-candidates.md`:

| Format | Type | Purpose |
|--------|------|---------|
| `RC-###` | General | Standard Ralph candidates (repeatable patterns) |
| `RC-D###` | Diagnostic | Verify patterns/code exists |
| `RC-F###` | Fix | Restore code if diagnostic fails |
| `RC-A###` | Autoresearch | Measurable optimization targets with KPI + impact score |

### RC-A Candidates (Autoresearch)

Discovered automatically in compound phases via static analysis + agent reflection:

```markdown
## RC-A003: Test Suite Runtime Optimization
**KPI:** test_suite_duration_seconds
**Baseline:** 45.2s
**Benchmark:** `time python3 -m pytest tests/ 2>&1 | tail -1`
**Impact Score:** 7.2 (potential: 8, blast_radius: 3, risk: 2, value: 9)
**Files in scope:** tests/, src/
**Constraints:** All tests must still pass
```

Impact score = weighted composite of potential (0.35), blast_radius (0.15), risk (0.15), value (0.35).

## Pure Ralph (Bash Loop)

Fresh context each iteration. State passes through files only.

```bash
/w-ralph-init                          # Create structure
/w-ralph-this "Build authentication"   # Generate plan
./.claude/ralph/loop.sh                # Run the loop
./.claude/ralph/loop.sh build 50       # Max 50 iterations
```

```
while [ tasks_remaining ]; do
  cat PROMPT.md AGENTS.md IMPLEMENTATION_PLAN.md | claude
  # Fresh Claude reads plan → picks ONE task → executes → validates → commits → exits
  # IMPLEMENTATION_PLAN.md updated (state preserved!)
done
```

## PM Module (--with-pm)

Adds 34 additional workflows for project management:

```bash
npx danizee-claude-suite init --with-pm
```

Requires `npm install better-sqlite3` for the SQLite database.

| Category | Workflows |
|----------|-----------|
| Action Items | `/w-action`, `/w-action-done`, `/w-action-list`, `/w-action-rebalance` |
| Standup | `/w-cos` (Chief of Staff daily standup) |
| Follow-ups | `/w-followup`, `/w-followup-done` |
| Goals | `/w-goal` |
| Ideas | `/w-idea`, `/w-idea-refine`, `/w-idea-share` |
| Knowledge | `/w-knowledge`, `/w-knowledge-search` |
| Notes & Facts | `/w-notes`, `/w-fact`, `/w-fact-search`, `/w-fact-enrich` |
| Brainstorm | `/w-ramble`, `/w-ramble-search`, `/w-ramble-refine` |
| Research | `/w-research`, `/w-doc-review` |
| Meetings | `/w-meeting-prep` |
| Projects | `/w-project`, `/w-initiative` |
| Sharing | `/w-share`, `/w-share-list`, `/w-share-revoke` |
| Design | `/w-systems-design`, `/w-ui-references`, `/w-ui-references-review` |

Action items use Fibonacci bucket limits (P1: 1, P2: 2, P3: 3, P5: 5, P8: 8, P13: 13) with auto-promotion on completion.

## Post-Init Hooks

The suite runs `.claude/hooks/post-init.sh` after installation if it exists and is executable. Use this to apply project-specific customizations that should survive suite updates.

```bash
#!/bin/bash
# Example: .claude/hooks/post-init.sh
sed -i '' 's/TodoWrite/TaskCreate/g' .claude/commands/.shortcuts/*.md
```

## CLI Commands

```bash
npx danizee-claude-suite init          # Install suite
npx danizee-claude-suite check         # Verify installation
npx danizee-claude-suite update        # Update workflows (preserves data)
npx danizee-claude-suite uninstall     # Remove suite
```

| Flag | Description |
|------|-------------|
| `--force` | Overwrite existing files |
| `--dry-run` | Preview without writing |
| `--with-pm` | Include PM workflows |
| `--without-cookbook` | Skip Agent Cookbook |
| `--keep-settings` | Preserve settings.json on uninstall |
| `-p, --path <dir>` | Target directory (default: cwd) |

## What Gets Installed

```
.claude/
├── commands/
│   ├── .shortcuts/         24 /w- workflow shortcuts
│   ├── workflows/          plan, work, review, compound
│   ├── coordination/       swarm-init, agent-spawn, memory-ops
│   ├── analysis/           design, component, layout, theme
│   └── autoresearch.md     /autoresearch command
├── skills/
│   └── autoresearch/       Autoresearch skill (SKILL.md)
├── hooks/
│   ├── autoresearch-context.sh
│   ├── marathon-precompact.sh      PreCompact: stamp status, record compaction
│   └── marathon-session-start.sh   SessionStart(compact): print the resume line
├── helpers/
│   ├── quick-start.sh
│   ├── setup-mcp.sh
│   ├── terminal-agents-mcp.js
│   ├── marathon/               cli.js + zero-dep library (gate, budget, store, …)
│   └── bbs/                    cli.js + zero-dep library (intake, fetch, inventory, map, verdict, handoff)
├── marathon.json               Marathon config (ceiling, budgets, models, bc thresholds)
├── marathon/                   Marathon runs (one folder per run-id) + reviewer kit + rules
├── bbs.json                    BBS config (limits, licence policy, sandbox)
├── bbs/                        BBS runs (one folder per run-id) + registry.jsonl
├── ralph/                  Pure Ralph loop structure
├── plans/                  Interview specs
├── ralph-candidates.md     Candidate queue
└── settings.json           Suite configuration

docs/solutions/             Compounded solution docs
specs/                      Ralph specification files
WORKFLOW-SHORTCUTS.md       Generated reference
.mcp.json                   MCP server configuration
```

## Plugins

| Plugin | Purpose |
|--------|---------|
| **RuFlo** | Multi-agent orchestration, memory, swarm topologies |
| **Compound Engineering** | Plan, work, review, compound workflows |
| **Frontend Design** | UI component generation (React/Vue/Svelte) |
| **Dot Shortcuts** | 24 /w- workflow shortcuts |
| **PM Shortcuts** | 34 /w- PM workflows (opt-in) |
| **Agent Cookbook** | Recipe registry integration |
| **Terminal Agents** | MCP server for tmux + worktree agent orchestration |
| **Autoresearch** | Autonomous experiment loop skill + hook |
| **Marathon** | Finish-line runs: helper CLI, JSONL store, gate, budget, compaction hooks, reviewer kit |
| **BBS** | Beg, borrow, steal: intake, GET-only fetch, inventory, harness map, verdict gate, hand-off to a marathon run |

## Checkpoint Gates

| Phase | Gate | Rationale |
|-------|------|-----------|
| Search | AUTO-PROCEED | Find past solutions, continue automatically |
| Pi Brain | AUTO-PROCEED | Knowledge discovery from network |
| Interview | USER GATE | Ensure requirements captured |
| Plan | USER GATE | Validate approach before coding |
| Spec | AUTO-PROCEED | Flows directly to tests |
| Tests | AUTO-PROCEED | Blocking rule: tests must fail first |
| Build | AUTO-PROCEED | Continues after tests pass |
| Review | AUTO-PROCEED | Automatic code review |
| Verification | AUTO-PROCEED | Cross-method validation (3 retries) |
| Compound | AUTO-PROCEED | Mandatory knowledge capture |

## License

MIT
