# Review 88e8e1ad-36a7-4bcf-b116-79143c7c48a6 — secret-redaction-by-value-and-fingerprin, round 4

- Commit: 0c4bc04
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 2 findings

## Low (2)

- **'all git versions print these relative to cwd' is not true for git \< 2.13** — `src/lib/kit/git-paths.js:5` (docs): Before git 2.13, running rev-parse --git-common-dir and --git-path in a subdirectory printed the path relative to the top of the work tree, not to the cwd. Resolving that against cwd gives \<sub\>/.git. In push-gate the realpath or index copy then fails with a misleading error. In secretsRoots it adds a spurious extra root (\<sub\>). Both fail closed or are harmless, so no secret leaks, but the comment overstates what the code guarantees. The old-git test fake wraps modern git, so it cannot catch this. — fix: Narrow the comment to git \>= 2.13, or resolve the relative common-dir/git-path lines against --show-toplevel when the cwd-resolved path does not exist.
- **storeFile gets an undefined cwd when io.git has no .cwd and io.cwd is unset** — `src/lib/kit/push-gate.js:219` (correctness): run() passes \`git.cwd || io.cwd\` to storeFile. changeId falls back to process.cwd() through its default parameter, but storeFile has no fallback, so gitPaths calls path.resolve(undefined, line) and throws a TypeError instead of a KitExit. This affects only programmatic callers, because the CLI always sets io.cwd. — fix: Use \`git.cwd || io.cwd || process.cwd()\` in run() (or default the cwd parameter in storeFile/gitPaths).
