# Review ea59f81d-f1f2-4d70-bb12-95262990df79 — hardened-git-read-on-untrusted-repo, round 20

- Commit: fc28f76
- Angle: facts and content
- Result: pass
- 5 findings

## Medium (1)

- **name-rev --s / --st (= --stdin) slip past the CLI stdin refusal and return an empty success** — `src/lib/kit/safe-git.js:130` (correctness): STDIN\_OPTIONS counts name-rev's --stdin only from the abbreviation 'std', but git's parse-options takes any unique prefix, and 'stdin' is the only name-rev option beginning with 's'. With git 2.43, \`git name-rev --s\` and \`git name-rev --st\` both run as --stdin (they print the deprecation warning). Reproduced: \`cli.js safe-git --dir \<repo\> -- name-rev --st \</dev/null\` prints {stdout:'', code:0, exit:0}, while \`--std\` is refused. That contradicts the header (line 97), which says the CLI refuses stdin options 'with the abbreviations git accepts there, so an empty answer is never mistaken for a real one'. for-each-ref has the same problem at line 131: from git 2.46, before any other option starting with --st was added, --st uniquely means --stdin. — fix: Make the shortest counted prefix 's' for name-rev's stdin and 'st' for for-each-ref's (no other option of those subcommands starts with them), and add \`name-rev --s\`/\`--st\` to the stdin-refusal test table.

## Low (4)

- **rev-parse --is-bare-repository says true for a non-bare repo's .git dir** — `src/lib/kit/safe-git.js:435` (correctness): shadowConfigText writes \`bare = (top === null)\` and ignores the repository's own core.bare. So when --dir names the .git of an ordinary repository (allowed by checkRepoRoot), \`safe-git --dir repo/.git -- rev-parse --is-bare-repository\` prints 'true'. Plain git run in that folder prints 'false' (reproduced). The header lists what the shadow does not reproduce, but this case is not on that list. — fix: Answer --is-bare-repository the way revParsePosition answers its options (from core.bare/loc), or note this in the header's not-reproduced list.
- **Header allow-list of core keys omits trustctime and checkstat** — `src/lib/kit/safe-git.js:16` (docs): The header lists the core keys the shadow config carries (ignorecase, precomposeunicode, quotepath, filemode, symlinks, autocrlf, eol). The code (CORE\_BOOL/CORE\_ENUM, lines 411-413) also carries core.trustctime and core.checkstat, so the documented allow-list is not the real one. — fix: Add trustctime and checkstat to the header list.
- **-O is labelled --open-files-in-pager, which is grep's meaning, not that of the allowed subcommands** — `src/lib/kit/safe-git.js:82` (docs): None of the allowed subcommands has --open-files-in-pager (it belongs to git grep, which is refused). For log, show and the diff family, -O\<orderfile\> reads an arbitrary file as the diff order file, and that is the real reason /^-O/ is refused. The header pairs the two, which misstates what is being blocked. — fix: Describe it as \`-O\<orderfile\> (reads any file)\` and drop or separately justify open-files-in-pager.
- **Duplicate, stale JSDoc block on isNetworkPath** — `src/lib/kit/safe-git.js:635` (docs): Two consecutive /\*\* \*/ comments describe isNetworkPath. The first (only //host or \\host) is stale: the code also matches mixed separators (/\\host, \\/host). — fix: Delete the first comment line.
