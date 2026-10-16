# Review 8c887643-811f-4ab8-b1ad-29752d5416bc — exit-code-contract-separating-infrastruc, round 12

- Commit: 2c5818e
- Angle: accessibility
- Result: pass
- 2 findings

## Medium (1)

- **The text promises the unscanned files, but the description never names a file** — `src/lib/kit/exit-codes.js:47` (facts): The regression description that users see at runtime (line 47) says 'Pass --result \<file|-\> ... for the hit count, the unscanned files with reasons and a remedy'. The header (line 14) also says --result describes 'the unscanned files with their reasons'. But describeJudge (lines 118-124) only prints a count and the distinct reasons. It never prints a path. Confirmed: describe 2 --verb scrub --result - with not\_scanned \[{path:'other/leak.txt',...},{path:'big.bin',...}\] returns '2 file(s) were not scanned (object not available locally (partial clone?); larger than 1048576 bytes)' and no file names. A reader who follows the advice to learn which files blocked the gate gets no file names. They have to dig through the raw JSON, which is what the description was supposed to save them from. The same text is in .claude/helpers/kit/exit-codes.js. — fix: Add the first few not\_scanned paths, with a '+N more' count, to the description. Or change the wording at lines 14 and 47 to 'the number of unscanned files and their reasons'.

## Low (1)

- **-h is not taken as help, and 'describe -h' gives a misleading error** — `src/lib/kit/exit-codes.js:297` (accessibility): run() only knows --help. 'exit-codes -h' exits 1 with 'unknown subcommand "-h"'. 'exit-codes describe -h' exits 1 with '\<code\> must be an integer 0..255, got "-h"', which does not tell the user that help exists. Sibling kit verbs (graph.js:1331, impact.js:360, caller-floor.js:216) accept -h, so a user who learned the kit's short help flag gets an error here. — fix: Treat '-h' the same as '--help' in both checks at lines 297-298.
