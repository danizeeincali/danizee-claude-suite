# /bh — alias for /w-bug-hunt

Mobile-friendly shortcut. Invoke the `.shortcuts:w-bug-hunt` skill via the Skill tool, passing the user's arguments verbatim as the `args` field (the time, the scope, and `--report-only`, `--resume` or `--status` when given). Do not pre-execute any of that skill's MANDATORY-FIRST-ACTION steps yourself — let the parent skill run its full protocol from scratch (including the TaskCreate first action).
