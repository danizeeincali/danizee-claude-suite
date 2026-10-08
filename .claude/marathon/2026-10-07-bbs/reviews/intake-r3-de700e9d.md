# Review de700e9d-6a0a-4da1-8bf8-f202448d8858 — intake, round 3

- Commit: 4baf845
- Angle: older environments and degraded networks
- Result: over tolerance
- 5 findings

## Medium (4)

- **ACTIVE pointer written non-atomically; a full disk wipes the previous run's pointer** — `src/lib/bbs/store.js:33` (correctness): setActiveRun uses fs.writeFile which truncates first; on ENOSPC the old pointer is gone and the rollback cannot restore it (empty reads as null). Every other store write is atomic; this one is not. — fix: setActiveRun via writeTextAtomic(file, runId+'\n'). Test that a failing write leaves the prior ACTIVE intact.
- **Stdin paste is decoded as UTF-8, which corrupts non-UTF-8 bytes and its identity** — `src/lib/bbs/cli.js:80` (correctness): readStdin decodes to a string so invalid sequences become U+FFFD; different pastes can hash equal and lookupSource reports a false reuse\_from; the same bytes via --paste-file get a different identity. — fix: Return a Buffer from readStdin; hash and write raw bytes as --paste-file does; decode only for the emptiness check. Test equal identities for a non-UTF-8 byte via stdin and via --paste-file.
- **Without a git checkout, the marker walk silently roots the project at ~/.claude** — `src/lib/bbs/cli.js:70` (correctness): Every Claude Code user has ~/.claude, so from any non-git directory under $HOME the walk stops at $HOME with no warning and runs land in ~/.claude/bbs. — fix: Skip os.homedir() when matching the .claude marker (or stop the walk at $HOME, keeping only .git there) so the warn-and-use-cwd fallback applies. Test with HOME set to a temp dir containing .claude.
- **Running cli.js through a symlinked path does nothing and exits 0** — `src/lib/bbs/cli.js:142` (correctness): The main-module guard compares the realpath of import.meta.url with path.resolve(process.argv\[1\]) which keeps the symlink; through a symlinked dir every verb is a silent no-op with exit 0. — fix: Compare fs.realpathSync of both sides inside try/catch. Test running the CLI through a symlinked directory.

## Low (1)

- **Run ids are case-insensitive, so the same --run means one run on macOS and two on Linux** — `src/lib/bbs/intake.js:17` (correctness): RUN\_ID accepts uppercase and explicit ids are stored as given; APFS merges Foo/foo, Linux does not. — fix: Lowercase explicit run ids or reject uppercase by dropping the /i flag.
