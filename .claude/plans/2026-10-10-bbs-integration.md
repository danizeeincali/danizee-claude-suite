# /w-bbs: integration is a deliverable, not a side effect

## Why

The first real /w-bbs run (OpenQodex, marathon run `2026-10-10-bbs-openqodex-2`) built 11 kit verbs and met
every gate, yet only /w-review and /w-marathon ended up calling them. `redact` reached no workflow at all and the
push gate stayed advisory. The owner's words: "You can build a car and never tell the user about it or give them
the keys."

Three causes, each checked in the repo:

1. **Nobody asked which workflows the owner uses.** /w-bbs inventories the source and maps it against the
   installed harness, but nothing in intake, map or verdict looks at what the owner actually runs. Where a power
   should land was left to the builder's guess.
2. **The `callers_<p>` gate line counted the wrong things.** `scripts/marathon-measure.js` `countCallers` counts
   any installed file that names `kit/cli.js <verb>` or imports the module, including sibling kit modules
   (`inKit`) and lens notes. `redact` passed with 1 "caller" (`helpers/kit/lenses/secret-in-log.md`);
   `safe-git`, `graph`, `guarded-fs` passed on kit-internal imports. A power could "have a caller" and still be
   unreachable from any workflow the owner runs.
3. **Integration was a line inside each build stream**, not its own deliverable with its own review. The build
   stream's reviewer looked at the module, not at the workflow it was supposed to change, and nothing told the
   owner what they got or how to use it.

## What changes

A new step between map and verdict, a gated integration stream after the builds, and a hand-over note.

### Stream 1 — `usage`: discover the workflows the owner actually runs

New verb `node .claude/helpers/bbs/cli.js usage [--run <id>] [--days 90] [--root <dir>]... [--workflows a,b]`.

- Reads local Claude Code session transcripts (default root `~/.claude/projects/`, every `*.jsonl` under it,
  modified within `--days`). Counts two signals per line: a slash command the owner typed
  (`<command-name>/x</command-name>`) and a `Skill` tool call (`"name":"Skill"` with `input.skill`).
- Resolves aliases from the installed `.claude/commands/.shortcuts/*.md` files ("alias for /w-x", e.g. /mt →
  w-marathon, /bc → w-background-compound) and drops the `.shortcuts:` prefix. Only commands installed in the
  harness are ranked; others are counted under `other` by name only.
- Writes `usage.json` in the run dir: `{ evidence: "transcripts"|"owner"|"none", window_days, files_read,
  workflows: [{ name, count, sessions, last_used }] }`, ranked by count. Never stores message text, arguments or
  paths of transcripts beyond a count; reads only, no network.
- `--workflows a,b` records the owner's own list (`evidence: "owner"`), used when there are no transcripts
  (a fresh machine, a cloud session) or the owner wants to override.
- `evidence: "none"` is legal but loud: the verdict step must then ask the owner to name the workflows inside the
  one question (see stream 2).
- `status` gains the `usage` step between `map` and `verdict`; `status --next` names it.

### Stream 2 — `targets`: every approved power names where it lands, before the build

New verb `cli.js targets --brief|--from <file> [--run <id>]`.

- `--brief` prints a helper brief: the powers, the ranked used workflows from `usage.json`, and for each used
  workflow its checkpoint headings (read from the installed command file), asking for JSON only:
  `{ "<power>": [{ "workflow": "w-background-compound", "step": "Phase 3 — before push", "how": "<one line>",
  "mode": "advisory"|"blocking" }] }`.
- `--from` validates: the workflow is installed; the step heading exists in that command file; `mode` is one of
  the two; a workflow with zero usage is refused unless the row carries `"unused_reason"`. A power with
  `rebuild` or `use` as its default and no target is flagged `no_target`.
- The verdict table (`verdict --table`) gains a **Lands in** column (workflow · step · mode per target). The one
  AskUserQuestion approves the verdicts and the targets together. Its typed override grammar gains
  `<power>@<workflow>[,<workflow>]` to change a power's targets; an unparsable answer still stops with the resume
  line (no second question). When `usage.json` says `evidence: "none"`, the question names that and asks for the
  workflows in the same answer (`workflows=a,b`).
- `verdict --from` refuses to record a `rebuild`/`use` decision for a power whose final target list is empty
  (exit 2, refused), so nothing is approved without a destination.

### Stream 3 — `integration-gate`: integration is its own stream with its own lines

- `handoff --marathon` writes each power's targets into its brief (a new "## Lands in" section) and creates one
  extra queued stream, `integration`, ordered after every build stream. Its plan lists every (power, workflow,
  step, mode) row.
- Finish-line lines change:
  - `callers_<p>` is replaced by `wired_<p>` (`measure:wired_<p>`, number, at_least = the number of approved
    targets, `stream: integration`).
  - New run line `delivered` (`measure:delivered`, bool is true, `stream: integration`): the hand-over note
    exists and lists every approved power.
- `scripts/marathon-measure.js` counts **wired targets**, not callers: a target counts only when its command file
  (or a hook/helper the command runs) has a step under the approved heading that runs `kit/cli.js <verb>` in a
  fenced or inline command; kit siblings, lens notes, run dirs (`.claude/marathon/`, `.claude/bbs/`), reviews
  and docs never count. `--targets <file>` gives it the list; without targets it reports `wired: null` (not a
  pass). The old `callers` number is still printed for information.
- New verb `cli.js delivered [--run <id>]` writes `.claude/bbs/runs/<id>/delivered.md`: per power, what it
  does in one line, which workflows now use it and at which step, and the direct command to run it by hand.
  It is the "keys". The integration stream ends by printing it to the owner.
- Replay check: run the new measure against the current tree for the OpenQodex run's 11 powers with the
  targets the owner named in that run's follow-up (/pt, /bc, /bcp, /w-marathon, /bbs). It must report `redact`
  as not wired on current main. Recorded as `measure:replay_catches_openqodex`.

### Docs (in each stream)

- `w-bbs.md`: new CHECKPOINT 3a "Usage" and 3b "Targets", the Lands-in column and the extended override grammar
  in CHECKPOINT 4, the integration stream and `delivered` in CHECKPOINT 5, a rule "Never assume which workflows
  the owner uses: usage.json or the owner's own list decides", and the completion checklist.
- `w-marathon.md`: an `integration` stream's review brief covers the target command files, not the kit module.
- Regenerate `.claude/commands/.shortcuts/` and `.claude/helpers/bbs/` copies the way the installer does.

## Not in scope

- Wiring the 11 OpenQodex verbs into workflows: the "How OpenQodex powers fit workflows" thread owns that
  (run `2026-10-10-kit-wiring`). This run changes the /w-bbs process only.
- Changing any kit verb's behaviour.
