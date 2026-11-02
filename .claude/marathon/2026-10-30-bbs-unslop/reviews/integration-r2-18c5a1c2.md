# Review 18c5a1c2-760b-443d-9872-b51eeb296453 — integration, round 2

- Commit: 44dd041
- Angle: failure conditions and error paths
- Result: pass
- 3 findings

## Medium (2)

- **/mt fix rounds never re-run the blocking slop audit, so a stale slop\_\<s\>=true can meet the gate** — `src/plugins/dot-shortcuts.js:5467` (correctness): The slop audit lives in 4.3c, which runs on each loop pass after 4.3b and before 4.4. But 4.7 Fix round ends with 'Back to 4.4' (w-marathon.md:521), skipping 4.3/4.3b/4.3c. A fixer that edits a screen file (for example rewrites copy for a review finding) is never scanned, and 4.8 then reads the latest slop\_\<s\> measure, which is the true recorded on the pass before the fix. The finish line looks enforced but is not on this path. The fidelity step solved the same problem with an explicit sentence ('a fix round (4.7 -\> 4.4) on such a stream scores fidelity again before 4.4', line 5311); the slop step has no such sentence, and no reach test covers a fix round. — fix: Add to the slop audit paragraph (and the 4.7 text): 'a fix round (4.7 -\> 4.4) on a UI stream runs this block again over the changed screen files before 4.4', and add a reach-test assertion that the sentence is there.
- **/pt Build image gate still asks and waits mid-loop when /mt builds through /pt** — `src/plugins/dot-shortcuts.js:1133` (correctness): /mt 4.3 tells the loop to 'build through /pt ... skip straight to its Plan gate', which runs /pt's CHECKPOINT 5 Build. The new /pt image-gate step says 'put it to the user exactly as printed (AskUserQuestion) and wait for the answer' (w-plan-tdd-swarm.md:495), and nothing in /pt says what to do when it runs inside an unattended /w-marathon loop. The r1 fix made /mt 4.3c queue the request and never ask mid-loop, but a /mt stream that generates an image through /pt's Build step hits the /pt wording and stalls on the question. That breaks the /mt row's 'declined means an empty slot, not a stalled loop'. — fix: In the /pt image-gate step add one sentence: when /pt runs as the build of a /w-marathon stream, do not ask: queue the request as /w-marathon 4.3c says (place the slot, add the checklist.md line) and go on.

## Low (1)

- **Every power is recorded with reach: \[\], so delivered.md cannot name the reach test** — `.claude/bbs/runs/2026-10-30-unslop/integration.json:7` (process): All 10 powers were recorded with --verb only. The workflow targets still count as wired (the verb runs in the step), but \`delivered\` writes 'the test that proves it' from the reach rows, and \`wired\` reports test: null for every target. test/bbs-unslop-reach.test.js exists and passes, but the owner's hand-over note will not point to it. — fix: Re-run \`cli.js integrate --power \<name\> --verb \<verb\> --reach workflow:\<file\>@\<heading\>=test/bbs-unslop-reach.test.js::node --test test/bbs-unslop-reach.test.js\` for each wired target (use --force if needed).
