# Review 448bbd3b-5f45-4a2d-9bef-89826f18e287 — intake, round 1

- Commit: e51df97
- Angle: one input method at a time
- Result: over tolerance
- 11 findings

## High (2)

- **status/report --run and ACTIVE are not validated: path traversal writes status.md outside the runs dir** — `src/lib/bbs/cli.js:64` (security): resolveRun joins any --run value or ACTIVE contents onto the runs dir and only checks existence; renderStatusFile then overwrites \<that dir\>/status.md. \`status --run ../../..\` overwrote a user's status.md; \`--run ''\` renders the runs dir; a tampered ACTIVE does the same via report. — fix: Validate RUN\_ID for the flag and the ACTIVE value in resolveRun and check the resolved dir stays under runsDir; exit 1 otherwise. Tests for --run '../x', --run '' and a tampered ACTIVE.
- **An existing local path containing whitespace is classified as paste** — `src/lib/bbs/intake.js:34` (correctness): The whitespace→paste check runs before the existence check, so a real directory like '/Users/x/My Tool' becomes type=paste with identity sha256 of the path string, marked fetched, next=inventory. — fix: Check exists(path.resolve(text)) for single-line text before the whitespace heuristic. Add a classifySource test with a directory name containing a space.

## Medium (5)

- **A non-existent path or schemeless URL is silently treated as a one-word paste** — `src/lib/bbs/intake.js:46` (correctness): './missing/dir' or 'github.com/foo/bar' fall through to paste; the run is created with fetched=true and ACTIVE moves to it. The user never gets an error. — fix: Paste positional text only when it contains whitespace or a newline; refuse a single path-like or host-like token that does not exist or has no scheme, with a hint to use --as paste or a full URL.
- **A value flag given with no value silently falls back to the default** — `src/lib/bbs/cli.js:33` (correctness): parseArgs stores true for a bare flag and consumers ignore non-strings: \`status --run\` renders ACTIVE, \`intake src --run\` auto-names, bare --as/--slug/--project are dropped, \`--paste-file\` with no value reads stdin. Unknown flags are accepted. — fix: Declare value flags (run, project, as, slug, paste-file) and fail with usage when one has no string value; reject unknown flags per verb.
- **Manifest identity skips symlinks, so distinct sources collide** — `src/lib/bbs/intake.js:95` (correctness): Dirent.isFile() is false for symlinks, so a directory holding only a symlink and an empty directory both hash to sha256 of '\n'; lookupSource would then report reuse\_from for an unrelated source. — fix: Include symlinks in the manifest as entries (path\t-\>target) and make an empty manifest an error or salt it. Test a directory containing a symlink.
- **--paste-file silently discards a positional source** — `src/lib/bbs/intake.js:31` (correctness): With --paste-file set, classifySource returns paste and the positional URL or path is ignored without an error. — fix: Fail with usage when --paste-file is combined with a positional other than '-'. Add a CLI test.
- **Status shows fetch as done for local/paste even though fetch never ran** — `src/lib/bbs/status.js:16` (correctness): The spec says fetch for local/paste records a zero-egress row; nextStep instead returns inventory right after intake and the table marks fetch done with no egress row. — fix: Have intake record the zero-egress row itself for local/paste so the done state is true, or derive fetch completion from an egress row. Update tests.

## Low (4)

- **Any non-undefined decision counts as decided** — `src/lib/bbs/status.js:22` (correctness): nextStep treats null, '' or 'maybe' as decided while summary counts the same power as undecided. — fix: One shared predicate: decided means one of rebuild|use|buy|skip.
- **--paste-file is decoded as UTF-8 before hashing** — `src/lib/bbs/intake.js:122` (correctness): Invalid UTF-8 bytes become U+FFFD so the identity and paste.txt no longer match the file's real bytes. — fix: Read the paste file as a Buffer; hash and write raw bytes; decode only for the emptiness check.
- **A non-object .claude/bbs.json crashes with an opaque TypeError** — `src/lib/bbs/config.js:44` (other): bbs.json of null, \[\] or a scalar makes deepMerge return that value; every verb dies with 'Cannot read properties of null'. — fix: Require a plain object after JSON.parse and throw \`invalid config in \<file\>: expected an object\`.
- **Run id date is UTC, not the local date** — `src/lib/bbs/intake.js:77` (facts): West of UTC an evening intake gets tomorrow's date, disagreeing with marathon run ids and the user's calendar. — fix: Use the local date, keeping the injected now() for tests.
