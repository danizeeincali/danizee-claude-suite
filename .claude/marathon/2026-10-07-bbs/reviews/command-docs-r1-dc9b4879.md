# Review dc9b4879-7ce2-4007-90b5-372373fce637 — command-docs, round 1

- Commit: 2e409ab
- Angle: one input method at a time
- Result: over tolerance
- 9 findings

## Medium (4)

- **The known: true jump to CHECKPOINT 5 fails, and repo/url sources never show known at intake** — `.claude/commands/.shortcuts/w-bbs.md:73` (correctness): intake does not copy powers/verdicts from reuse\_from, so handoff exits 1 on the new empty run; repo/url identity is pending at intake so known only appears in the fetch JSON, which the command never checks. — fix: On known:true print the reused run's report and resume line (report --run \<reuse\_from\>, status --run \<reuse\_from\>) and stop; add the same check after fetch for repo/url; extend e2e test 8 to follow the documented path.
- **--resume \<run-id\> continues with checkpoint commands that act on the ACTIVE run, not \<run-id\>** — `.claude/commands/.shortcuts/w-bbs.md:158` (correctness): Only status gets --run; every checkpoint verb is written without it, so resuming a non-latest run records against the wrong run. — fix: In --resume say to append --run \<run-id\> to every verb from then on.
- **'Change some verdicts' option forces a second question or a guess** — `.claude/commands/.shortcuts/w-bbs.md:122` (process): The single AskUserQuestion offers the option but no way to say which powers/verdicts; the decisions-file shape is never stated. — fix: Make the one question carry the changes (answer Other with \<power\>=\<verdict\> pairs) and state the decisions JSON shape in CHECKPOINT 4.
- **The suite repo ships /w-bbs, but its helpers and fetched/ gitignore rule are missing from the repo** — `.claude/commands/.shortcuts/w-bbs.md:16` (correctness): The repo commits the command markdown and dogfoods marathon via .claude/helpers/marathon/\* but has no .claude/helpers/bbs/, so /w-bbs fails here at its first verb; the repo .gitignore lacks the bbs rules. — fix: Install the bbs helpers into the repo's own .claude (commit them like marathon's) and add the four bbs gitignore rules.

## Low (5)

- **bbs uninstall leaves the marathon library copies it installed (a half-marathon)** — `src/plugins/bbs.js:91` (correctness): install writes helpers/marathon/\*.js without cli.js when absent; uninstall removes only helpers/bbs. — fix: Record which marathon files bbs wrote (a manifest) and remove them on uninstall when marathon's cli.js is absent.
- **No test pins the marathon-library copy: no overwrite of an existing copy, no cli.js, marathon still not installed** — `test/bbs-plugin.test.js:75` (test-quality): The onlyIfAbsent branch and the import graph of a bbs-only install are untested. — fix: A bbs-only install test: pre-seeded gate.js unchanged, no cli.js, marathon.isInstalled false, the installed cli.js runs.
- **DEFAULT\_SETTINGS is eagerly evaluated with an import-time installedAt and used only by a test** — `src/utils/settings.js:70` (other): Dead production surface with a stale stamp. — fix: Drop the export and call getDefaultSettings() in the test (a sanctioned contract edit).
- **check computes plugins.bbs but the CLI never prints it** — `src/installer.js:434` (docs): bin/cli.js prints a line per plugin including Marathon but none for BBS. — fix: Add a BBS helpers line beside the Marathon one in bin/cli.js.
- **README says the bbs CLI prints JSON on stdout; several verbs print text** — `README.md:266` (docs): status, report and the --brief/--table views print text. — fix: Say JSON except status, report and the --brief/--table views.
