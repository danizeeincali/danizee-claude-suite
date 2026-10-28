# Review 4999e56c-e27f-45bd-9e10-e416c0922a0f — layer-export-placement-math, round 2

- Commit: 5cfad32
- Angle: r2
- Result: pass
- 2 findings

## Low (2)

- **Fallback warning misstates the reason when there is no image or the overhang is even** — `src/lib/kit/layer-place.js:140` (other): The bounds-rule warning always says 'image does not match render bounds', even when the layer has no image at all. When render\_bounds is given, no flag is set, there is no stroke\_geometry and the overhang is even, it also says 'there is no stroke\_geometry for an uneven overhang', which reads as if the overhang were uneven. Checked by hand: bounds {10,10,10,10}, render\_bounds {8,8,14,14}, no image. The warning says both things, and neither is true. The same text is in .claude/helpers/kit/layer-place.js:140-143. — fix: Build the reason from the actual state: say 'no image' when image is missing, and say 'the overhang is even' or 'uneven overhang but no stroke\_geometry' based on isEven(ov), whether or not stroke\_geometry is present.
- **Validation test promises messages that name the field but checks only the exit code** — `test/kit-layer-export-placement-math.test.js:217` (test-quality): 'rejects wrong types, unknown keys and bad shapes naming the field' uses exit1(), which checks only KitExit code 1, for 15 of its 16 cases. Only the last case checks that the message names the field (bounds.w). The contract requires errors that name the field. If a message regressed to a generic text, every case except the last would still pass. — fix: Add a message regex to each case (for example /input\.frame\.y/, /layers\\[0\\]\.shape/, /unknown key "wat"/), or have exit1 take an expected pattern.
