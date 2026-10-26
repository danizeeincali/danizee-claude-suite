# Review daa3856c-1a1c-4b3a-87e6-a598c7370b7f — reference-frame-fidelity-check, round 3

- Commit: 075b3a5
- Angle: correctness
- Result: pass
- 1 findings

## Medium (1)

- **Same-file check compares Number inodes: precision loss or ino 0 falsely refuses --diff-out and drops the verdict** — `src/lib/kit/fidelity.js:493` (correctness): run() refuses --diff-out as 'the same file as --ref/--actual' when dev and ino match, using fh.stat() (line 395) and fs.stat(diffOut) without {bigint:true}. On Windows, NTFS/ReFS file IDs are 64-bit; once the sequence number in the high bits is 32 or more (common on older, long-used volumes) the ID passes 2^53 and the Number ino loses its low bits, so two different files close together in the MFT, such as ref.png and a diff.png from the previous run in the same folder, can get equal ino. Some network shares and older filesystems report ino 0 for every file, so the check matches any existing diff file. In both cases the refusal is thrown before scoring, so the run exits 1 (usage, non-blocking) instead of 2. A failing frame then gets past the gate on exactly the CI setups that keep a diff file from the last run. The same code is in .claude/helpers/kit/fidelity.js. — fix: Use fh.stat({ bigint: true }) and fs.stat(diffOut, { bigint: true }), and treat a match as the same file only when ino !== 0n. Copy the change to both files.
