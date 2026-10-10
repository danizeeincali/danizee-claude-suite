# Review 17c27d99-a416-4fcf-a840-519ff66f6584 — sweep-commits, round 5

- Commit: db7f626
- Angle: accessibility
- Result: pass
- 3 findings

## Medium (1)

- **w-end re-stage of every \`git diff --name-only\` path pulls the owner's unrelated unstaged edits into the commit** — `src/plugins/dot-shortcuts.js:4837` (correctness): w-end says 'Stage the specific session files (not \`git add -A\`)', but its new check runs a plain \`git diff --quiet\`, which also exits 1 for any tracked file the owner edited and never staged. The text then says to re-stage every path \`git diff --name-only\` lists. Reproduced: staging \`a\` while \`b\` holds an unrelated owner edit gives rc=1, and \`--name-only\` lists \`b\`. Following the text commits \`b\`, which contradicts the checkpoint's own instruction. The autoresearch prompt has the same problem: an unattended background agent would fold the owner's edits into an experiment commit. In w-agent-tdd-swarm this cannot happen, because step 1 already runs \`git add -A\`. — fix: Keep the whole-index check. On exit 1, re-stage only the paths that appear in both \`git diff --name-only\` and \`git diff --cached --name-only\`. For any other listed path, stop and ask the owner in w-end, or leave it unstaged and log it in autoresearch, rather than running \`git add\` on it.

## Low (2)

- **Autoresearch revert never says how to get \`\<the experiment's paths\>\` and \`\<those paths\>\`** — `src/plugins/dot-shortcuts.js:3799` (accessibility): The guarded clean depends on knowing which paths the experiment created, and the text never says how to list them. An agent might reach for \`git ls-files --others\` or \`git status\`, which also list untracked loop state such as autoresearch.jsonl, so the clean could delete the very files the warning protects. — fix: Say how to record the paths: list the experiment's paths with \`git diff --cached --name-only\` right after the scrub step's \`git add\`, and its new paths with \`git diff --cached --name-only --diff-filter=A\`, both before the \`git reset\`.
- **The required \`git diff --quiet\` gate is in prose only, not in the bash block a reader runs** — `src/plugins/dot-shortcuts.js:1209` (accessibility): Each scrub step (w-agent-tdd-swarm, w-end, autoresearch) puts the whole-index check, the one-time re-stage and the 'do not commit' exits in a paragraph. The fenced block that follows runs only the scrub. A reader who copies and runs the block skips the check. — fix: Add the check to the bash block before the scrub, e.g. \`git diff --quiet; D=$?; if \[ $D -ge 2 \]; then echo "git error $D: do not commit"; fi\`, with the exit-1 re-stage written as a step, so the runnable order matches the text.
