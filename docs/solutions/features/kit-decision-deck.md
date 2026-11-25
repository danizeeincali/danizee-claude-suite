# kit verb: decision-deck

**What it does:** `node .claude/helpers/kit/cli.js decision-deck check | emit | read` (`src/lib/kit/decision-deck.js`).
`check --file deck.json` validates a deck (every length bound, unique ids, `recommend` among the choices, images as
`data:` URIs of png/jpeg/webp at most 400 KB, the page under 12 MB) and prints `{ok, cards, problems:[{path, message,
fix}], collection, progress}`, exit 0 either way (`collection` and `progress` only when ok). `emit --file deck.json --out deck.html [--standalone]` writes one self-contained page (no
requests; the cards embedded as JSON with every `<` escaped; all text set with textContent) and prints `{out, bytes,
cards, title, collection}`. `read --file <picks> --deck deck.json` takes the copied `id | choice | note` text or the
artifact database rows and prints `{decided, undecided, byChoice, problems, collection}`. Exit 1 is unreadable input, a bad flag, or a deck that is not ok for `emit`.

**Publishing it:** as a Claude artifact with `capabilities: {db: {}, user: {}}`. The page calls only
`window.claude.use("db")`. Every deck has its own key, the 8 hex characters of `deckKey` (FNV-1a over the deck title,
card ids and card titles; also the localStorage key `decision-deck:<key>`), so a new deck republished to the same
artifact with the same card ids starts clean. The page writes `decks/<key>/decisions/<card id>` = `{choice, note, at,
title}` on each pick (`choice: null` after an undo) and `decks/<key>` = `{title, cards, decided, done, at}` when its
count changes: that document is the progress of the device that saved last, not the truth, which is the decision rows.
It reads `decks/<key>/decisions` once on load to resume (newer `at` wins; a row whose title is not its card's is
ignored). A late answer (the db can resolve up to 10 s after load) refreshes only what changed: the current card is
re-rendered only when its own pick changed, and never while the note has focus or unsaved text or a drag is under way.

**Saving states:** each write has a 10 s timeout; `unavailable`, `resource_exhausted` (longer pause) or an unknown
code is retried once after a short random pause; `invalid_argument`, `quota_exceeded`, `not_granted`, `revoked`, a
timeout or a second refusal mark that document failed. Failures never turn the database off: later picks still write,
and failed documents are pushed again after the next write that lands, when the end screen opens, and from its "Try
saving again" button. The end screen (a polite status region) says "Saving…" while anything is in flight, "Saved. The
agent has your decisions." only when every pick written has landed, "Saved on this device only. Copy your decisions
to send them." after a failure, and "Not saved yet. Copy your decisions to send them." when localStorage refused the
picks too. The deck's quiet line says "Saved on this device only" or "Not saved yet" in the same cases.

**Reading back:** the agent gets the collection from `check` or `emit` output (or `read`'s), lists it with the
artifact database, and passes the rows to `read`, which derives progress from the decision rows alone. Rows whose
`path` is outside this deck's collection (another deck's, or an older page's bare `decisions/<id>`) or whose `title`
is not the card's are listed under `problems` as belonging to another deck and not counted; rows with no `path` are
taken as given; the progress document `decks/<key>` is skipped. All id-keyed maps (`picks`, `mergeResume`'s output,
the page's write bookkeeping) have no prototype, so a card id like `constructor` is an ordinary card.

**Tests:** `test/kit-decision-deck.test.js` (bounds, emit safety, the page's pure functions, read, the CLI),
`test/kit-decision-deck-packaged.test.js` (installed kit, zero egress) and `test/kit-decision-deck-browser.test.js`
(Playwright at 390x844: button, swipe, key, undo, end screen, export, resume, double-tap guards on the choices and
"Decide later", a mocked artifact database holding another deck's rows, a late db answer during typing and dragging,
pending / timed-out / retried / refused writes, a full localStorage; skipped when Playwright is missing).
