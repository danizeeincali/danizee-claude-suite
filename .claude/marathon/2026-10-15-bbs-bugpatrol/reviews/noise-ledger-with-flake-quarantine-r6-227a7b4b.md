# Review 227a7b4b-23c2-4be6-80c2-7f2841a39396 — noise-ledger-with-flake-quarantine, round 6

- Commit: 4677f43
- Angle: facts and content
- Result: pass
- 2 findings

## Medium (1)

- **accept/prune change the committed ledger's file mode to 0600** — `src/lib/kit/state-lock.js:254` (correctness): writeJsonAtomic creates its temp file with mode 0o600 and renames it over the target, so after any accept or prune the committed .claude/kit/noise-ledger.json becomes owner-read-only, whatever the umask or the file's previous mode. Before the state-lock adoption (6ffb2c2) the ledger was written with fs.writeFile (umask, 0644 under 022), so this is a regression. Checked: a 0644 ledger became -rw------- after \`cli.js noise-ledger accept --id a --reason r --ledger l.json\`. Git does not record the change, so nobody notices, but on a shared checkout or a bind-mounted repo read by another uid (a CI container, a teammate's account) every later apply/accept/prune fails with 'cannot read ...: EACCES' (exit 1), breaking the advisory step. The header documents nothing about modes. The same code is in .claude/helpers/kit/state-lock.js. — fix: Keep the target's existing mode: stat the file before writing (fall back to 0o666 & ~umask when it does not exist) and chmod the temp file to it before the rename; add a test that a 0644 ledger stays 0644 after accept.

## Low (1)

- **Exit-code doc says 1 means invalid input or broken ledger only** — `src/lib/kit/noise-ledger.js:25` (docs): The header says 'Exit codes: 0 done (findings or not), 1 invalid input or broken ledger' and the usage says '1 for invalid input', but exit 1 is also returned when the ledger is locked by another run past waitMs, when the lock is lost before the rename ('nothing saved'), and when the ledger or its folder cannot be written (EACCES/EROFS). A caller reading the docs would treat a lock timeout as a bad-input problem. — fix: Say '1 invalid input, broken ledger, or the ledger could not be locked or written' in the header and usage.
