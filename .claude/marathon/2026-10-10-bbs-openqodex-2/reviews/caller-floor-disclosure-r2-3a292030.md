# Review 3a292030-f7a8-4898-a5cb-3212985a8609 — caller-floor-disclosure, round 2

- Commit: 20039d1
- Angle: failure conditions and error paths
- Result: pass
- 2 findings

## Medium (1)

- **Removed methods lose the interface\_dispatch floor, so they read as safe to remove** — `src/lib/kit/caller-floor.js:159` (correctness): index.forName always calls reasonsFor with interfaceCount 0, and the removed rows built in impact.js touchedSymbols (impact.js:145) carry no \`parent\`, so a removed method of a class that implements an interface never gets interface\_dispatch. Reproduced: store.ts \`interface Store { save(): void }\` and \`class Mem implements Store { save() {} extra() {} }\`. \`callers --symbol store.ts:Mem.extra\` gives floor true, reason interface\_dispatch, 'Zero callers found, but this is a floor: check call sites by hand.' After removing extra, \`impact --diff - --base HEAD\` gives removed Mem.extra with floor false and 'Zero callers found in the files that were read.' The same symbol is a floor while it exists and 'clean' once removed, which is exactly the case the impact.js FLOOR doc and the /w-review text say must never read as safe to remove. Same code in .claude/helpers/kit/caller-floor.js. — fix: Carry the parent class name on removed rows (from the old-side qualified chain) and in forName look up the class in the new graph (helpers.classes by file+parent) to get its implements count, as interfaceCountOf does; add a test that removes a method of an implementing class.

## Low (1)

- **unread\_files sentence count does not match its breakdown when not\_read is capped** — `src/lib/kit/caller-floor.js:116` (facts): graphLevel adds the unlisted overflow (not\_read\_total minus the 2000 listed rows) to \`unread\`, but the parenthesised breakdown only covers the listed rows. With not\_read \[{reason:'unsupported'}\] and not\_read\_total 500, the sentence reads '500 project files were not read (unsupported: 1); a caller may be in them.'. The overflow is often budget rows (a large repo that ran out of time), so it is also left out of budget\_cut\_importers, while the doc says unread\_files counts files unread 'for a reason other than a budget'. The floor stays true, so the reviewer's action does not change, but the sentence misstates why files were unread. graphLevel is at line 57. — fix: When \`unlisted \> 0\`, add 'reason not listed: N' to the breakdown (or report the overflow under its own phrase) so the counts add up.
