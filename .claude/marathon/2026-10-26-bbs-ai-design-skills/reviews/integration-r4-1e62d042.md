# Review 1e62d042-6765-4225-84b5-1a51c891a126 — integration, round 4

- Commit: bb36f2f
- Angle: security
- Result: pass
- 2 findings

## Medium (1)

- **BG\_SELECTOR is pasted into a single-quoted shell literal, so a quoted selector runs part of itself as a command** — `src/plugins/dot-shortcuts.js:1111` (security): The Review step tells the agent to put the CSS selector in place of BG\_SELECTOR='\<the background element selector\>'. Attribute selectors usually carry single quotes (\[data-bg='hero'\], \[aria-label='Hero image'\]). Pasted in, the quote closes the literal: BG\_SELECTOR='\[data-bg='hero'\]' silently becomes \[data-bg=hero\] (bg-fill guard then exits 1 'no rule selects \[data-bg=hero\]', so the judge never runs), and a selector with a space or ';' after the quote is split into words the shell executes. Probe: bash -c "BG\_SELECTOR='\[aria-label='Hero;echo INJECTED'\]'" prints INJECTED. Unlike the paths, the selector is copied from page or stylesheet text, which this file elsewhere says never goes into a shell argument (the cluster and search steps write such text to a file with the Write tool). The reach test's fixture '.hero' has no quote, so this is not covered. — fix: Take the selector from a file (write it with the Write tool and read it with BG\_SELECTOR=$(cat "$SEL\_FILE")), or tell the agent to write each ' as '\'' and add a reach-test case with \[data-bg='hero'\].

## Low (1)

- **The new JSON error text echoes part of the input file** — `src/lib/kit/design-brief.js:251` (security): The r2 change appends V8's JSON.parse message to the error. That message quotes about 10 characters of the input around the error position. Probe: --file pointing at '{..., "api\_key": sk-live-0123...}' prints 'kit: input is not valid JSON: Unexpected token 's', ..."api\_key": sk-live-01"... is not valid JSON', and --file .env prints its first ten bytes ('OPENAI\_API'). A wrong --file path, such as a credentials file picked by mistake, leaks a fragment of it to stderr and the transcript. motion-plan, layer-place, entrance and bg-fill keep the plain 'input is not valid JSON'. — fix: Report only the position (parse it from the message, or use e.message.replace(/, ".\*$/, '')), never the quoted snippet. Add a test that the error does not contain the input text.
