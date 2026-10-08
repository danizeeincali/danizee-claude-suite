# Review d055c38c-137a-4213-8155-3041ffeac971 — handoff, round 1

- Commit: d1c0b20
- Angle: one input method at a time
- Result: over tolerance
- 11 findings

## High (3)

- **handoff proceeds when some powers have no decision; undecided powers silently vanish** — `src/lib/bbs/handoff.js:263` (correctness): Only verdicts.rows being an object is checked; an undecided power is in neither powers nor skipped, handoff.json is written and next=done. No powers\_ts check either. — fix: Refuse unless every power in powers.json has a decided row and powers\_ts matches; name the undecided powers and the --decide command. Test with one decided and one not.
- **marathon slug is only the last dash segment of the run id, so different sources share one marathon run** — `src/lib/bbs/handoff.js:390` (correctness): initSlug uses run.split('-').pop(); '2026-10-07-claude-suite' → bbs-suite; same-day init reuses the run dir and the second handoff overwrites the first source's finish line and adds streams to it. — fix: Slug = the run id minus its date prefix; refuse when init returns a run that already has non-default lines or streams. Test two sources sharing a last segment.
- **queued streams' plan path briefs/\<slug\>.md does not resolve from the marathon run or project root** — `src/lib/bbs/handoff.js:432` (correctness): The brief lives under .claude/bbs/runs/\<run\>/briefs/; the stream row stores a bare relative path and kickoff.md names neither the bbs run nor the brief dir, so a resume session cannot find the brief. — fix: Store a project-relative path; name the bbs run and brief paths in kickoff.md; assert path.join(dir, rows\[0\].plan) exists.

## Medium (6)

- **a failure after marathon init leaves an ACTIVE half-filled run that the error does not name** — `src/lib/bbs/handoff.js:441` (correctness): init succeeds, stream fails: the marathon run dir stays with ACTIVE pointing at it and finish-line/kickoff overwritten; the error does not name it. — fix: Catch after init and name the run and the recovery in the error (re-run --force or remove it); test a runner that succeeds at init and fails on stream.
- **two buy powers that slug alike overwrite each other's memo** — `src/lib/bbs/handoff.js:357` (correctness): The slug collision check covers only rebuild/use; 'X Y' and 'x-y' both write memos/x-y.md. — fix: Check slug collisions across every approved power before writing anything.
- **per-power line filter uses endsWith('\_'+slug), so one power picks up another's checks** — `src/lib/bbs/handoff.js:332` (correctness): Powers 'b' and 'a\_b': tests\_green\_a\_b ends with \_b, so b's brief lists a\_b's checks. — fix: Return lines per power from buildFinishLine or match exact ids base\_slug.
- **evidence stripping keeps code that comes before the first —, newline, backtick, ( or {** — `src/lib/bbs/handoff.js:114` (security): 'return a+b; src/x.js:3' lands in the brief verbatim; the spec says a brief never includes source code; the line is appended unlabelled. — fix: Extract only location tokens (path:line, URL) with a positive pattern; put them under a labelled Provenance bullet. Test code before the location.
- **marathon run dir is hardcoded and the runId returned by init is used without validation** — `src/lib/bbs/handoff.js:400` (correctness): Files go to path.join(projectDir, '.claude/marathon', runId) ignoring init's runDir and the marathon paths.runs; a runner returning ../../evil wrote outside .claude/marathon. — fix: Use initData.runDir resolved under projectDir, validate runId, assert it sits under the marathon runs dir, pass --run \<id\> to stream calls.
- **a corrupt finish-line.example.json silently falls back to the default tolerance** — `src/lib/bbs/handoff.js:313` (other): A bare catch swallows the parse error; a malformed tolerance error does not name the file. — fix: Fall back only when absent; rethrow parse errors; prefix tolerance errors with the file path.

## Low (2)

- **kickoff.md is overwritten wholesale, dropping init's title, Budget and Models sections** — `src/lib/bbs/handoff.js:426` (correctness): The seeded kickoff with Budget and Models is replaced; decide/ask sections left as '- '. — fix: Fill the Done means and Never sections in place and keep the rest.
- **buy memo location differs from the spec, and the memo is thin** — `src/lib/bbs/handoff.js:234` (docs): Spec says briefs/, code uses memos/; Why buy repeats the idea; no provenance beyond data\_needed. — fix: Align the spec with memos/; add source ref, run and network to the memo.
