# Review 56036e2a-bd6b-47b1-a1b4-277a7abc338a — usage, round 1

- Commit: 4fbc40e
- Angle: one input method at a time
- Result: over tolerance
- 6 findings

## Medium (3)

- **Typed-command regex is anchored to the start of the turn and misses the command-message-first transcript form** — `src/lib/bbs/usage.js:101` (correctness): invocations() only counts a typed command when the text starts with command-name; the command-message-first form is skipped. — fix: Accept command-name after leading command-message/command-args tags; add a fixture.
- **Subagent transcripts are counted as owner sessions and uses** — `src/lib/bbs/usage.js:82` (correctness): listTranscripts walks subagents/agent-\*.jsonl, so subagent Skill calls count as owner uses. — fix: Skip subagents/ dirs and isSidechain rows; test it.
- **Usage step can be bypassed silently on new runs** — `src/lib/bbs/status.js:28` (process): verdict --decide after map skips usage; nothing in verdict.js checks usage.json. — fix: recordDecisions refuses rebuild/use without usage.json; test the refusal.

## Low (3)

- **An invocation without a timestamp turns every later use in the session into a hop** — `src/lib/bbs/usage.js:144` (correctness): s.prev null makes all later invocations hops. — fix: Only t === null forces a hop.
- **MAX\_LINE\_BYTES claims lines are skipped unread** — `src/lib/bbs/usage.js:26` (docs): readline reads the whole line; length counts code units. — fix: Reword the comment and name.
- **Workflows nested more than one directory deep can never be resolved** — `src/lib/bbs/usage.js:28` (correctness): NAME allows one ':' segment. — fix: Allow any number of ':' segments.
