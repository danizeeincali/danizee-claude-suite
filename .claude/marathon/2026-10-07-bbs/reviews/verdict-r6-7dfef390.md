# Review 7dfef390-1cc2-4515-8615-e1ca8623476f — verdict, round 6

- Commit: 7caf67d
- Angle: facts and content
- Result: pass
- 5 findings

## Low (5)

- **A refused buy (and the table's missing buy) names no cause: legalVerdicts only records a removal reason for use** — `src/lib/bbs/verdict.js:821` (facts): --decide x=buy on a permissive power is refused without a cause; Why never says why buy is absent. — fix: Push {verdict:'buy', reason:'licence \<cls\> — buy is legal only for a commercial licence or a power that sends data off the machine'} when buy is not legal; test a refused buy quotes it.
- **Module header says use is never legal without a clean probe, but legalVerdicts lists use before any probe** — `src/lib/bbs/verdict.js:4` (docs): legal includes use with needs\_probe true before the probe; what is enforced is that a use DECISION needs a clean probe. — fix: Reword the header: use is never a default; a use decision is accepted only with a permissive licence, a sandbox on this machine and a clean probe (listed as needs\_probe before).
- **sanitizeStderr docstring says only non-http schemes are cut to scheme+host, but http(s) URLs are cut too** — `src/lib/bbs/verdict.js:196` (docs): SCHEME\_TOKEN also matches the already-redacted http(s) URL and drops its path and query. — fix: Fix the docstring to say every scheme token except unix:// and npipe:// is cut to scheme + host\[:port\].
- **With a powers.json that has no ts, the guard says powers.json changed and its advice loops** — `src/lib/bbs/verdict.js:536` (facts): powers\_ts null vs undefined throws POWERS\_CHANGED with a false cause; re-running verdict writes null again. — fix: Refuse in computeVerdicts when powers.json has no ts with a ts-specific message, or compare (vj.powers\_ts ?? null) === (powers.ts ?? null).
- **Repair hint always says --from \<same file\>, even when the input came from --decide or stdin** — `src/lib/bbs/verdict.js:529` (facts): After --decide the warning names a file that does not exist. — fix: Build the hint from the input label: re-run cli.js verdict \<label\> to append the missing rows (stdin: resubmit the same input on --from -).
