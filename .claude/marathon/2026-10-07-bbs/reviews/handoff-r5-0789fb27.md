# Review 0789fb27-d1ba-4fdd-b946-e63f5ce1e3f3 — handoff, round 5

- Commit: fe069a5
- Angle: accessibility
- Result: pass
- 4 findings

## Medium (1)

- **A forced refill on a later day leaves the previous marathon run's queued streams pointing at deleted briefs, and reports stale\_streams: \[\]** — `src/lib/bbs/handoff.js:675` (correctness): The marathon run id carries today's date, so a later-day forced refill creates a new run; blockStale only walks the new run's rows and prev.marathonRun is used only when approved is empty. — fix: Under force, when prev.marathonRun is a valid id different from the new run, block its rows too (keep = empty set) and add them to stale\_streams qualified by run; name the old run in the note. Test by renaming the run dir to an earlier date.

## Low (3)

- **stale\_streams / removed\_files / skipped\_files are bare lists with no explanation in the JSON, and status.md never shows them** — `src/lib/bbs/handoff.js:724` (accessibility): Nothing says the streams were blocked (not removed), that skipped entries were left on disk, or that the previous run needs closing; status.md shows none of it. — fix: When any list is non-empty, set note to one sentence per list and show the note in status.md's handoff row or under Summary.
- **Several handoff refusals do not give the next command or the file** — `src/lib/bbs/handoff.js:434` (accessibility): 'verdict step must complete first', 'inventory first — powers.json is missing', 'handoff.json exists — pass --force', 'install the suite', and the re-run hints lack the exact command and --run \<bbs run\>. — fix: Add the exact command to each message and include --run \<run\> in every re-run hint; name the marathon close/remove command.
- **Brief 'Never' line for a removed verdict is an incomplete sentence; Done-means lines repeat the power name** — `src/lib/bbs/handoff.js:242` (docs): '- Never execute (no sandbox on this machine)' names no object; labels already start with the slug so Done means prints it twice; kickoff joins five labels on one line without ids. — fix: '- Never run the upstream code (use was removed: \<reason\>)'; drop the duplicate prefix; one bullet per check with its id in kickoff.
