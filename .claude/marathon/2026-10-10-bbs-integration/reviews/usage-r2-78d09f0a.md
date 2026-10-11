# Review 78d09f0a-9b27-41b5-b6d1-be7eb6c369c0 — usage, round 2

- Commit: 85d4551
- Angle: failure conditions and error paths
- Result: over tolerance
- 3 findings

## Medium (3)

- **An evidence:none usage.json satisfies the rebuild/use gate** — `src/lib/bbs/verdict.js:827` (correctness): The gate only checks usage.json exists; evidence none with no workflows still lets rebuild/use through. — fix: Refuse rebuild/use when evidence is none; test it.
- **A corrupt usage.json cannot be repaired with --force** — `src/lib/bbs/usage.js:209` (correctness): recordUsage reads the prior file before checking force; corrupt JSON throws. — fix: With force skip the prior read; name --force in the error.
- **usage.roots and usage.days from .claude/bbs.json are never validated** — `src/lib/bbs/usage.js:213` (correctness): A string root iterates characters; a non-number days gives NaN and a silent none. — fix: Validate usage.roots and usage.days in loadConfig.
