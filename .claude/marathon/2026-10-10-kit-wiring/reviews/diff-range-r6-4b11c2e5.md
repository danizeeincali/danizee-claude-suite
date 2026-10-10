# Review 4b11c2e5-0ba3-41e5-85b0-7d5945eb6b0f — diff-range, round 6

- Commit: d1dbdb4
- Angle: facts and content
- Result: over tolerance
- 6 findings

## High (1)

- **Include refusal reads only --local, so an include in the per-worktree config (config.worktree) is followed and its filter driver runs** — `src/lib/kit/diff-range.js:143` (security): with extensions.worktreeConfig=true git also reads $GIT\_DIR/config.worktree, which --local does not cover; a filter defined in a file included from config.worktree is never found by the --no-includes driver read but the diffs follow the include (reproduced: PWNED created, exit 0); the header claims nothing named in any config git reads is executed — fix: read git config --list -z --no-includes --show-scope once and refuse include.path/includeIf.\*.path in scope local or worktree; add a test with a config.worktree include

## Low (5)

- **Header says nothing from any config git reads is executed, but drivers defined in files the user's global/system config includes are not switched off** — `src/lib/kit/diff-range.js:30` (facts): the driver list comes from --no-includes, the diffs follow global includes; the header contradicts itself — fix: narrow the sentence: drivers defined in files your own global/system config includes are yours and are not switched off
- **Any signal death is reported as a timeout** — `src/lib/kit/push-gate.js:58` (facts): with a timeout set, r.signal && !r.error turns any signal (OOM SIGKILL, SIGPIPE, external kill) into the 'took longer than N ms' message — fix: use the timeout message only for r.error?.code === 'ETIMEDOUT'; report other signals as 'git \<cmd\> was killed by \<signal\>'
- **Partial-clone note asserts 'this is a partial clone' on any matching error and its command is not runnable for paths with spaces** — `src/lib/kit/diff-range.js:112` (facts): the MISSING regex also matches a corrupt full clone's 'bad object'/'unable to read'; the suggested git -C ${dir} is unquoted — fix: say 'if this is a partial clone' (or check remote.\*.promisor / extensions.partialClone) and single-quote the dir
- **/w-review does not name the refused case (exit 2) diff-range can now return** — `src/plugins/dot-shortcuts.js:2125` (docs): exit 2 is reachable (an include in the repo config, a bad driver name) but the text says any other non-zero exit is wrong input or a broken state — fix: append: exit 2 means diff-range refused the repository (e.g. an include in its own config): report the refusal as printed; regenerate w-review.md
- **Include refusal message gives an unclear remedy** — `src/lib/kit/diff-range.js:145` (docs): 'run the read through safe-git' names no command and safe-git does not produce this range — fix: say: remove the include from .git/config (git config --local --unset include.path) and run diff-range again
