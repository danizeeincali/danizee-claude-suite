# kit verb: decision-deck

**What it does:** `node .claude/helpers/kit/cli.js decision-deck check | emit | read` (`src/lib/kit/decision-deck.js`).
`check --file deck.json` validates a deck (every length bound, unique ids, `recommend` among the choices, images as
`data:` URIs of png/jpeg/webp at most 400 KB, the page under 12 MB) and prints `{ok, cards, problems:[{path, message,
fix}]}`, exit 0 either way. `emit --file deck.json --out deck.html [--standalone]` writes one self-contained page (no
requests; the cards embedded as JSON with every `<` escaped; all text set with textContent). `read --file <picks>
--deck deck.json` takes the copied `id | choice | note` text or the artifact database rows and prints `{decided,
undecided, byChoice, problems}`. Exit 1 is unreadable input, a bad flag, or a deck that is not ok for `emit`.

**Publishing it:** as a Claude artifact with `capabilities: {db: {}, user: {}}`. The page calls only
`window.claude.use("db")`; it writes `decisions/<card id>` = `{choice, note, at, title}` on each pick (`choice: null`
after an undo) and `decks/meta` = `{title, cards, decided, done, at}` when the count changes, and reads the
`decisions` collection once on load to resume (the database wins over the browser's copy). Any refusal keeps it
working on the device with one quiet line, "Saved on this device only". The agent reads the picks with the artifact
database `list` of `decisions` and passes the rows to `read`.

**Tests:** `test/kit-decision-deck.test.js` (bounds, emit safety, the page's pure functions, read, the CLI),
`test/kit-decision-deck-packaged.test.js` (installed kit, zero egress) and `test/kit-decision-deck-browser.test.js`
(Playwright at 390x844: button, swipe, key, undo, end screen, export, resume, a mocked artifact database; skipped
when Playwright is missing).
