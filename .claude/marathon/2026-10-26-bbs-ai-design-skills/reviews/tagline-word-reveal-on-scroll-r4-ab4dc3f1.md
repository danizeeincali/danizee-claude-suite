# Review ab4dc3f1-115f-479d-932b-a5a34bc1ef8b — tagline-word-reveal-on-scroll, round 4

- Commit: dde450e
- Angle: correctness
- Result: pass
- 1 findings

## Low (1)

- **Stdin and lint-from-stdin packaged runs are never checked for egress** — `test/kit-tagline-word-reveal-on-scroll-packaged.test.js:769` (test-quality): Only the first packaged test asserts pkg.egress() is empty (line 766). The second test (lines 769-785) drives new paths through the installed CLI under the no-egress preload: emit from stdin, lint from stdin, the over-cap stdin input, and the repeated or empty --text-file. It ends without checking the egress log, so an egress attempt or a read outside the allowed dir on the stdin path would go unnoticed. The code makes no network calls today, so this does not change behaviour. The test just asserts less than it could. — fix: Add assert.deepEqual(pkg.egress(), \[\]) at the end of the second packaged test.
