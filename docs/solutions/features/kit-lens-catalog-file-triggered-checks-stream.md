# kit stream: lens-catalog-file-triggered-checks (marathon 2026-10-10-bbs-openqodex-2)

**What shipped:** `kit/cli.js lenses` (`src/lib/kit/lenses.js`): review rules kept as markdown files with frontmatter
(file globs and an optional regex on added lines). Four lenses are built in (missing await, secret in a log line,
shell string concatenation, test that asserts nothing) and projects add their own in `.claude/kit/lenses/`. Given a
unified diff, the verb lists the lenses that fire, the files each matched and the rule text, capped at 4 with the
rest listed as `capped`; `--covered <name>` stands a lens down when a deterministic check already ran. Caller: the
/w-review Code Analysis step, which diffs the push-gate range (merge base with upstream, plus uncommitted and
untracked files, `--no-prefix`) into a `mktemp` file and keeps the verb's exit status.

**Rounds:** r1 pass, fixed anyway (step used `git diff HEAD`, empty for committed work; mnemonic prefixes broke
globs; empty input looked like "no lens applies", now exit 1), r2 pass, fixed (renames in one-letter folders lost
the folder, now read from `rename from/to`; fixed shared temp path), r3 pass, fixed (`; rm -f` hid the exit
status), r4 pass, r5 pass on the same commit. Open lows left as recorded: an unindented YAML list item is refused
with an unclear message; a trailing `# comment` on a scalar becomes part of the value.

**Lesson:** a shell step that cleans up after a check must carry the check's exit status out (`RC=$?; ...; (exit $RC)`).
