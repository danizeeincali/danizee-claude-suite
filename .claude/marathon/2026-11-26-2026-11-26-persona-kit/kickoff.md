# Kickoff — 2026-11-26-2026-11-26-persona-kit

## Done means
- Any project can run persona testing from the suite: `init` installs `.claude/helpers/persona/` and the `/w-persona-test` command, with no code about Ezi HQ in it.
- The tester connector (guide, next_walk, get_brief, start_walk, submit_report, ask/answers, notes/post_note/clear_notes, publish_round, list_reports/get_report/export_round, open_questions/answer, check_again_minutes) runs from the suite, locally (Node) and as a Cloudflare Worker with D1, with a tester key and a coding key.
- One project file (`persona-testing/project.json`) holds the product, personas, doors, jobs, ground rules, the known list and the areas being fixed; rounds, side rounds, briefs and the guide come from it.
- An end-to-end test walks the whole loop: plan a round, publish it, a scripted tester walks it over MCP (one rejected report, then accepted), fetch, read, deliver, and the deck passes `decision-deck check`.
- `npm test` green in the suite 3 runs in a row per stream, the end-to-end green 3 in a row, two clean reviews in a row per stream.
- bos is not changed: its tester and its tests stay exactly as they are.

## You may decide on your own
- The hosting shape, file layout, names, config format, caps and defaults.
- Dropping Ezi HQ-only parts (hand-off links, day-one reset, sittings named for the morning brief) in favour of general ones.
- Dani is away: the interview was held on defaults (coordinator: decide yourself).

## Ask me before
- Deploying anything (a Worker, a D1 database), or changing the live Ezi HQ tester.
- Merging to main in either repository.

## Never
- Touch bos code or the live ezihq.com tester.
- Push to main; push only claude/project-thread-i5jkp4.
- Weaken a test. Put a secret or a sign-in link in a file.

## Budget
- Run token budget: 14,000,000
- Usage ceiling: 100% of the weekly allowance, checked before every fan-out
- Helper budget: 150,000 (max 200,000)

## Models
- Lead: the session model · scoped builds: haiku · builds: sonnet · hard builds: opus · review: opus · routine: haiku
- Ladder: haiku → sonnet → opus → session. A failed job retries one tier up, never on the same tier.
