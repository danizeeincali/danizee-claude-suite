# Review c60948da-9b17-4e23-b8ff-dd6ee4995e27 — change-impact-test-plan, round 2

- Commit: 8c6ddcc
- Angle: failure conditions and error paths
- Result: pass
- 3 findings

## Medium (1)

- **planTests ignores input.changed, so the module entry returns an empty, confident plan** — `src/lib/kit/test-plan.js:102` (correctness): validateInput accepts a top-level "changed" key and the header says changed files come from it, but only run() (line 237) reads input.changed. planTests builds its file list from the second argument alone. A code caller using the module entry, as the brief asks, with planTests({targets:\[{id:'a',files:\['x.js'\]}\], changed:\['x.js'\]}) gets plan \[\], changed\_total 0 and low\_confidence false. Nothing is tested and nothing is flagged, which is the silent under-testing the idea rules out. — fix: In planTests, merge input.changed with the changed argument (as run does), or reject a call where input.changed is set and the argument is also given. Add a unit test for planTests(input) with input.changed.

## Low (2)

- **The flows type check runs after the loop, so a non-list flows crashes with a raw TypeError** — `src/lib/kit/test-plan.js:73` (correctness): Line 67 iterates input.flows before line 73 checks that it is a list. With flows:{} the CLI prints 'kit: object is not iterable (cannot read property Symbol(Symbol.iterator))' rather than '"flows" must be a list (see --help)'. With flows:"ab" it reports 'every flow needs a string "id"'. planTests(input, 'x.js'), where changed is a string and not a list, also throws a raw TypeError ('(changed ?? \[\]).map is not a function'). The exit code is still 1, but the message does not tell the user what to fix. — fix: Move the Array.isArray(input.flows) check above the loop, as is done for edges. In planTests, reject a changed value that is not an array, with a KitExit.
- **No change source at all exits 0 with an empty plan and low\_confidence false** — `src/lib/kit/test-plan.js:146` (correctness): If none of input.changed, --changed or --diff is given (for example a CI step that forgot --diff, or an empty diff file from a wrong git range), files is empty. Rule 4 then skips the smoke set and the flag, and the verb exits 0 with only the always items. The header documents this, but a caller cannot tell 'nothing changed' from 'no change input reached the verb', and the job that is meant to fall back to a smoke set reports nothing to test. — fix: In run(), exit 1 when no change source was given at all. Alternatively, add a field such as change\_source:'none' or a low\_confidence\_reason so that an empty change set is visible.
