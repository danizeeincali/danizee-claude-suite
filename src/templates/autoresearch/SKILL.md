# Autoresearch Skill

Autonomous experiment loop. Runs experiments, measures results, keeps winners, discards losers, loops forever.

Port of [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) as a pure Claude Code skill — no MCP server, just instructions the agent follows with built-in tools.

## Setup Phase

When starting a fresh autoresearch session:

1. **Gather info:** optimization goal, run command, primary metric, files in scope, constraints
2. **Create branch:** `git checkout -b autoresearch/[goal-slug]`
3. **Read source deeply** — understand what you're optimizing before experimenting
4. **Create files:**
   - `autoresearch.md` — session blueprint (objective, metrics, scope, constraints, what's been tried)
   - `autoresearch.sh` — benchmark runner (must output `METRIC name=number` lines)
   - `experiments/worklog.md` — narrative log of experiments and insights

## JSONL State Protocol

State persists in `autoresearch.jsonl`. Two record types:

**Config header** (first line of each session):
```json
{"type": "config", "goal": "...", "primary_metric": "...", "direction": "maximize|minimize", "command": "./autoresearch.sh", "started": "ISO8601"}
```

**Result line** (after each experiment):
```json
{"type": "result", "run": 1, "commit": "abc123", "metric": 0.783, "status": "keep|discard|crash", "timestamp": "ISO8601", "notes": "what changed"}
```

## Experiment Loop

1. **Run:** Execute `./autoresearch.sh` via Bash, capture output
2. **Parse:** Extract `METRIC name=number` lines from output
3. **Evaluate:**
   - **Keep:** primary metric improved → `git commit` with `Result: {...}` trailer
   - **Discard:** metric worse or equal → `git checkout -- .` to revert
   - **Crash:** non-zero exit → log error, revert, try different approach
4. **Log:** Append result to `autoresearch.jsonl`, update dashboard
5. **Loop:** Go to step 1. Never stop unless interrupted.

## Benchmark Script Convention

`autoresearch.sh` must:
- Run quickly (it runs many times)
- Output `METRIC name=number` on stdout (one per line)
- First METRIC line is the primary metric
- Exit 0 on success, non-zero on failure

Example:
```bash
#!/usr/bin/env bash
set -euo pipefail
python3 -c "import py_compile; py_compile.compile('train.py', doraise=True)"
.venv/bin/python train.py
```

## Dashboard

Write `autoresearch-dashboard.md` after each run:
- Current run number and best metric
- Trend chart (text-based)
- Recent experiments with status

## Ideas Backlog

`autoresearch.ideas.md` stores promising but untried optimizations. On resume, use ideas to guide next experiment. Prune completed/duplicate ideas.

## Loop Philosophy

- Loop forever without asking permission
- Primary metric is the only judge. Secondary metrics inform but don't decide.
- Simpler is better — removing code counts as "keep" if metric holds
- When stuck, think deeply. Don't thrash repeating failed approaches.
- Always resume by reading worklog and JSONL for full context
- User messages during the loop are steering input — complete current experiment first, then incorporate feedback
