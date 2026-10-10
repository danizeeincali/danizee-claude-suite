# kit stream: hardened-git-read-on-untrusted-repo (marathon 2026-10-10-bbs-openqodex-2)

**What shipped:** `kit/cli.js safe-git --dir <repo> -- <git args>` (`src/lib/kit/safe-git.js`): read a repository you
did not write without letting it run code or reach the network. git never reads the repo's config: each call builds a
private 0700 shadow git dir with a config written from an allow-list, copies HEAD, refs, packed-refs, the index and a
few info files under size and entry caps, and points git at the real objects and work tree. git runs by absolute path,
with cwd in the scratch folder, an empty HOME, no inherited GIT_* variables and `-c` switches for every driver the
repo names. Subcommands come from a read-only allow-list; options that re-enable code, write files or read stdin
(abbreviations included) are refused. Index paths, object alternates, symlinks under objects/ and refs/, network
paths in gitdir/commondir and in nested `.git` files, and unlistable folders are refused (exit 2). Exit codes: 0 ok,
1 bad input, 2 refused, 3 git failed or timed out. Caller: `bbs/fetch.js` reads HEAD of a fetched repo through it.

**Rounds:** 20 review rounds; 10 high, 22 medium and 39 low findings, all fixed. Highs: config.worktree filters,
abbreviated options (`--textc`), gpg.program behind format.pretty, submodule filters, unbounded sparse-file copies,
symlinked refs/, the repo's own git binary on PATH/cwd, `../` index entries, memory exhaustion from thousands of
sparse .gitattributes (discovery removed), an unlistable objects folder hiding a symlink, and nested `sub/.git` files
naming a network share (UNC credential leak on Windows). Rounds 19 and 20 passed; their lows and medium were fixed
before merge.

**Lesson:** for untrusted config, allow-list what git may see instead of deny-listing what it may run; every deny-list
round found another key. Second lesson: any folder walk on hostile input fails closed on errors and carries a cap.
