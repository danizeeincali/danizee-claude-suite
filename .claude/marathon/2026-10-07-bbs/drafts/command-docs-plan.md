# Stream 7 — command-docs: what it builds (lead's plan, written while verdict r1 fixes run)

Contract files to write when the handoff stream closes (they depend on the final CLI surface):

1. `test/bbs-plugin.test.js` — `src/plugins/bbs.js`:
   - `install(claudeDir, {dryRun, targetDir})` copies every `src/lib/bbs/*.js` verbatim to `.claude/helpers/bbs/`
     (mirror `src/plugins/marathon.js`), writes `.claude/bbs.json` from `DEFAULT_CONFIG` only if absent,
     `.claude/bbs/.gitkeep` only if absent, and appends gitignore rules for machine-local state
     (`.claude/bbs/ACTIVE`, `.claude/bbs/runs/*/map.lock`, `.claude/bbs/runs/*/*.tmp`, `.claude/bbs/runs/*/fetched/`).
     NOTE `fetched/` holds foreign source — never committed.
   - `isInstalled`, `uninstall` (removes helpers only; run data stays), `getNamespace() === 'bbs'`.
   - The installed `cli.js` imports resolve (every `./x.js` sibling present) — run `node .claude/helpers/bbs/cli.js nope` in the temp project → usage, exit 1.
   - `src/installer.js` wires `bbs.install` after marathon; `checkStatus` reports `plugins.bbs`; dryRunReport lists `bbs`.
   - `.claude/settings.json` permissions gain `Bash(node .claude/helpers/bbs/cli.js:*)` idempotently (as marathon's helper allow line).

2. `test/w-bbs-command.test.js` — dot-shortcuts entries `w-bbs` and alias `bbs` (pattern: test/w-marathon-command.test.js):
   - header `# /w-bbs`, description matches /beg|borrow|steal|absorb/i
   - MANDATORY FIRST ACTION uses TaskCreate, never TodoWrite
   - six phases as CHECKPOINTs: Intake, Fetch, Inventory, Map, Verdict, Hand-off, plus Compound
   - names every verb: `cli.js intake`, `cli.js fetch`, `cli.js inventory --brief`, `cli.js inventory --from`, `cli.js map`, `cli.js map --brief`, `cli.js map --from`, `cli.js verdict`, `cli.js verdict --probe`, `cli.js verdict --from`, `cli.js handoff --marathon`, `cli.js status --next`, `cli.js report`
   - rules: never execute fetched code · GET only · JSON only from helpers · one approval (exactly one AskUserQuestion, at the verdict) · never crawl · exit 2 = refused, stop
   - model policy: inventory/map helpers on `haiku`, probes on `sonnet`, no premium name (no /fable/i)
   - `--resume <run-id>` continues from `status --next`; `--status` prints status only
   - prints the egress line verbatim after fetch; prints the verdict table; ends with the resume line `/w-marathon --resume`
   - no `\\\`` artifacts
   - alias `bbs`: invokes `.shortcuts:w-bbs`, passes args verbatim, mentions TaskCreate
   - repo copy regenerated: `.claude/commands/.shortcuts/{w-bbs,bbs}.md` exist and equal `getCommands()` content

3. `test/bbs-docs.test.js` — docs:
   - `src/utils/shortcuts.js` has a `### Beg, borrow, steal` section with Say/Slash/What it does/Enforcement/Example, and a table row `/w-bbs [source]` (alias `/bbs`); `WORKFLOW-SHORTCUTS.md` regenerated and identical to the generator output
   - `README.md`: quick-reference rows for `/w-bbs` and `/bbs`; a section "Beg, borrow, steal — absorb a power from an outside source" with the four verdicts table, the fetch guards, the run dir tree, the CLI verbs, and OpenQodex as the worked example (no OpenQodex-specific code); project tree lines for `helpers/bbs/`, `bbs.json`, `bbs/`; plugin table row **BBS**.
   - `package.json` keywords gain `beg-borrow-steal`; version NOT bumped (ask-before).

4. `test/bbs-e2e.test.js` — the packaged check:
   - temp project with `git init`; `new DaniZeeSuiteInstaller({targetDir, withoutCookbook:true}).install()` (or the plugin install directly + marathon.install so the handoff bridge exists)
   - fixture `test/fixtures/bbs/sample-source/` (LICENSE MIT, README.md, src/a.js, src/b.js — a tiny fake tool, NO executable code run)
   - drive the INSTALLED cli: intake <fixture> → fetch (no-op) → inventory --from fixture `inventory.json` (3 powers) → map → map --from fixture `judgments.json` → verdict (BBS_SANDBOX=absent) → verdict --from fixture `decisions.json` → handoff --marathon → report
   - assert: marathon run dir created, its finish-line.json validates (validateFinishLine → []), status next done, report line, `.claude/bbs/registry.jsonl` has the row, egress.jsonl shows requests=0, no file outside the temp project touched
   - each run of this file = one `record run kind=e2e`; the lead records `measure packaged=true` after a green run through the installed copy.
