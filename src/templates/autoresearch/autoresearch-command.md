If $ARGUMENTS is "off":
- Create `.autoresearch-off` sentinel file to pause the loop
- Say "Autoresearch paused. Run /autoresearch to resume."

If `autoresearch.md` exists (resume mode):
- Remove `.autoresearch-off` if it exists
- Read `autoresearch.md` for objective and rules
- Parse `autoresearch.jsonl` to reconstruct state (run count, baseline, best result)
- Check recent git log for context
- Read `autoresearch.ideas.md` if it exists for experiment ideas
- Continue from the next planned experiment

If `autoresearch.md` does NOT exist (fresh start):
- Remove `.autoresearch-off` if it exists
- Invoke the autoresearch skill for initial setup
- Use $ARGUMENTS as the goal description to streamline setup questions

Allowed tools: Read, Write, Edit, Bash, Glob, Grep, Skill
