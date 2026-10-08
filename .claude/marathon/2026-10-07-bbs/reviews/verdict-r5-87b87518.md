# Review 87b87518-e053-4557-bd3a-bd67e084d8ea — verdict, round 5

- Commit: 4d9da8c
- Angle: accessibility
- Result: pass
- 2 findings

## Medium (1)

- **The verdict table does not show needs\_probe: an unprobed power lists use as legal and gives no reason** — `src/lib/bbs/verdict.js:406` (accessibility): verdictTable has no probe column and Why holds only removed reasons; an unprobed permissive power with a sandbox shows use as legal with no caveat, and the owner's pick is then refused with exit 2. needs\_probe appears only in the JSON. — fix: When needs\_probe is true, mark the Legal cell 'use (probe first)' and add 'use needs a clean network probe (cli.js verdict --probe \<power\>=…)' to Why; show the probe result when present. Add a verdictTable test with a needs\_probe row.

## Low (1)

- **PolicyRefused messages leave out the cause and the next command** — `src/lib/bbs/verdict.js:822` (accessibility): '\<v\> is not legal for \<p\>: legal verdicts are …' omits the removed reason and gives no next command; the needs\_probe refusal names the command but not the legal set. — fix: Append the matching removed reason and 'choose one of them with cli.js verdict --decide \<power\>=\<verdict\>'; add the legal set to the needs\_probe refusal.
