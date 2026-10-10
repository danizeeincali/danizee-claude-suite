# Review 196df4bb-a456-40b9-93fc-95487913aa8b — lens-catalog-file-triggered-checks, round 5

- Commit: 064bf3c
- Angle: accessibility
- Result: pass
- 2 findings

## Low (2)

- **Unindented '- item' list is refused with an error that says that form is supported** — `.claude/helpers/kit/lenses.js:132` (other): The list-item regex on line 123 (/^\s+-\s+/) requires leading whitespace, but YAML commonly writes list items at column 0 under the key ("globs:\n- \"\*.js\""). For that input parseLens throws 'f.md:4: cannot read this line (supported: "key: value", "key: \[a, b\]", "key:" then "- item" lines): - "\*.js"'. The message tells the author that the exact form they wrote is supported, so they cannot tell what to change. The header comment ('or one \`- item\` per line') does not mention indentation either. Verified with parseLens. The same code is in src/lib/kit/lenses.js. — fix: Accept /^\s\*-\s+/ while a list key is open, or say in the error that '- item' lines must be indented under their key. Update the doc comment in both copies.
- **A trailing '# comment' on a match line becomes part of the regex, so the lens never fires** — `.claude/helpers/kit/lenses.js:147` (docs): Only whole-line '# comment' lines are skipped. 'match: foo # catch foo' parses without error, and the regex becomes 'foo # catch foo', which needs that literal text. The lens loads, is counted in 'loaded' and never fires, and nothing reports it. An author used to YAML inline comments gets a check that is silently off. Verified with parseLens. The same code is in src/lib/kit/lenses.js. — fix: State in the header comment that inline comments are not supported and that the value is taken verbatim, or refuse a scalar that contains ' #' with a file:line error (other than on match, where '#' may be meant literally, warn instead).
