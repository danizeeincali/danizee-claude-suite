# Review 5212b3af-80c8-4423-96b6-b9f906e319c1 — hardened-git-read-on-untrusted-repo, round 7

- Commit: 4afc487
- Angle: performance and memory
- Result: pass
- 1 findings

## Low (1)

- **A symlinked work-tree .gitattributes is skipped 'as git does', but git then reads the index blob, so drivers named there are not listed** — `src/lib/kit/safe-git.js:448` (correctness): workTreeAttributes skips a .gitattributes that lstat finds (readAttributesFile returns '' for a symlink) and \`continue\`s, without falling back to the index. git 2.43 in the CHECKIN direction fails open\_nofollow with ELOOP, then reads the same path from the index (attr.c read\_attr: read\_attr\_from\_file, then read\_attr\_from\_index). Traced: repo with \`\* diff=evil\` committed as a regular .gitattributes, work-tree copy replaced by \`ln -s /dev/null .gitattributes\`. Plain \`git check-attr diff a.txt\` prints \`a.txt: diff: evil\`, and \`git -c diff.evil.textconv=... diff\` runs the textconv. safeGitConfig(repo) lists no diff.evil.\* / filter.evil.\* overrides. Nothing runs through safeGit today, because the shadow config defines no driver. But the header promises an override for every driver in 'a work-tree .gitattributes that git would read', and the inline comment 'a symlink: skipped, as git does' misstates git's behaviour. The previous readCapped had the same gap. — fix: When lstat shows a non-regular file (symlink), take the index branch (\`cat-file -s\` / \`cat-file blob :rel\`) rather than skipping. Fix the comment, and add a test with a regular .gitattributes in the index and a symlink in the work tree.
