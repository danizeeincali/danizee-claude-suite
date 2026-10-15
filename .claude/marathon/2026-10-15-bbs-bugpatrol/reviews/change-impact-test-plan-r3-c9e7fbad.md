# Review c9e7fbad-5176-43cc-9623-ea8d56749900 — change-impact-test-plan, round 3

- Commit: d25f8d6
- Angle: older environments and degraded networks
- Result: pass
- 2 findings

## Medium (1)

- **An empty --diff or --changed file still gives a confident, empty plan with exit 0** — `src/lib/kit/test-plan.js:238` (correctness): The new guard rejects only a run with no change flag at all. The case named in r2 is still open: an empty diff file from a wrong git range. On a degraded or shallow CI checkout, \`git fetch origin main\` fails, so \`git diff origin/main...HEAD \> d.diff\` leaves an empty file. That file passes the guard, and line 253 lets an empty text through. Confirmed: run(\['--diff','empty.diff'\]) and run(\['--changed','empty.diff'\]) both return plan \[\], changed\_total 0, low\_confidence false, exit 0. The advisory CI job then reports nothing to test, with no smoke set and no flag. A caller cannot tell 'nothing changed' from 'the change input never arrived', which is the silent under-testing the brief rules out. The same applies to .claude/helpers/kit/test-plan.js:238. — fix: When every change source given resolves to zero paths (an empty or whitespace-only --diff or --changed file), set low\_confidence: true with a reason such as 'change source was empty' and add the smoke set, or exit 1 unless an explicit flag like --allow-empty is passed. Keep the explicit input.changed: \[\] case as it is now. Add a test for an empty --diff file.

## Low (1)

- **planTests now throws on blank entries, which the CLI path and the old code filtered out** — `src/lib/kit/test-plan.js:102` (correctness): The new strList check on the changed argument rejects empty or whitespace-only strings. The usual code-caller input is \`execSync('git diff --name-only').toString().split('\n')\`, which always ends in ''. Confirmed: planTests({targets:\[{id:'a',files:\['x.js'\]}\]}, 'x.js\n'.split('\n')) throws 'the changed argument must be a list of non-empty strings (see --help)'. Before this commit the entry was dropped by .filter(Boolean). run() filters blank lines from a --changed file (line 248), so the module entry is now stricter than the CLI for the same data. The '(see --help)' suffix also means nothing to a module caller. The same applies to .claude/helpers/kit/test-plan.js:102. — fix: Check only that changed is an array of strings, and keep dropping blanks with the existing normPath/filter(Boolean). Or document that callers must filter blanks first, and give module callers an error message without the --help suffix.
