# Review 023de681-188c-4180-b98b-c53c1920b115 — isolated-tool-free-wording-judge, round 1

- Commit: fe8b51c
- Angle: one input method at a time
- Result: pass
- 4 findings

## Medium (2)

- **Docs say the plan is printed before spending, but it is not** — `.claude/commands/.shortcuts/w-marathon.md:178` (facts): The w-marathon copy (and its twin in src/plugins/dot-shortcuts.js:3939, plus the wording-judge.js header line 12) says the judge 'prints the plan (calls) before spending'. judge() calls the probe and every judging call before returning, and cli.js only writes stdout once run() resolves. So the plan shows up after the money is spent. The only way to see it first is wording-judge --dry, and review-score --wording has no dry option. A reader who trusts the copy runs --wording expecting a chance to stop it. — fix: Either emit the plan to stderr before the probe in judge(), or change the copy to say the plan is only shown up front by \`wording-judge --dry\`.
- **--resume keeps stale verdicts after the reviews are re-scored** — `src/lib/kit/wording-judge.js:52` (correctness): Resume skips any case whose saved status is 'judged', keyed only by case name. review-score rewrites scores.json in the same --out folder on every run, so after a new review round, \`review-score ... --wording --wording-resume\` skips cases whose hits or sentences changed. wording.json then reports old verdicts against the new scores, and nothing warns about it. — fix: Store the judged ids and sentences (or a hash of the items) per case, and only skip a case when they match what itemsFor returns now.

## Low (2)

- **A partly parsed case is marked judged, so resume never retries its missing ids** — `src/lib/kit/wording-judge.js:160` (correctness): A case gets status 'judged' as soon as one verdict parses, even when unparsed\_ids is not empty. --resume then skips it forever, so those ids never get a verdict. — fix: Mark the case 'judged' only when unparsed\_ids is empty (use 'partial' otherwise).
- **Header still says nothing is run or sent** — `src/lib/kit/review-score.js:27` (docs): With --wording, review-score now starts an external runner and sends finding text and planted truth to a model. The header line 'nothing is run, fetched or sent' and the w-marathon line 176 claim that review-score 'makes no network call' are now true only without --wording. — fix: Qualify both lines with 'without --wording'.
