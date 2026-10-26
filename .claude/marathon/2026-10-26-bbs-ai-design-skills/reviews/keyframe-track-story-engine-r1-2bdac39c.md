# Review 2bdac39c-82b5-4c10-9a23-84838a3e8d81 — keyframe-track-story-engine, round 1

- Commit: a914d45
- Angle: correctness
- Result: pass
- 4 findings

## Medium (1)

- **Unison check groups by raw offset\_ms, missing offsets equal modulo loop\_ms** — `src/lib/kit/keyframes.js:314` (correctness): check() buckets stories by the raw offset\_ms value (byOffset Map, line 314). Local time is (clock + offset\_ms) mod loop\_ms, and offset\_ms may be any non-negative number, so two stories on different cards with offset\_ms 0 and 2000 (loop\_ms 2000) act in exact unison but produce no warning. Confirmed via stdin: check returns ok:true with warnings:\[\] for that input. The rule exists to catch cards moving in lockstep, and this misses an equivalent case. — fix: Key the map by ((offset\_ms % loop\_ms) + loop\_ms) % loop\_ms (and print that phase in the message), and add a test with offsets 0 and loop\_ms on different cards.

## Low (3)

- **sample returns an arbitrary value for tracks whose times are out of order** — `src/lib/kit/keyframes.js:326` (correctness): normalizeTrack treats time order as a check finding, not an error, so sample accepts a track like t=0,1500,1000,2000. evaluate's binary search assumes sorted times and returns a confident but meaningless number (at 1200 ms this gives 8) with no signal. check flags the track, but someone who only runs sample never learns that the value is invalid. — fix: In sample, reject (exit 1) or add a warnings entry when a track's times are not strictly increasing.
- **sentenceCount counts abbreviations as sentence breaks** — `src/lib/kit/keyframes.js:276` (correctness): Any ./!/? followed by whitespace and more text starts a new sentence, so a single sentence such as 'The bar grows, e.g. from zero.' or 'Dr. Lee's card pulses once.' gets a false sentence-not-single finding and ok:false. — fix: Only count a break when the next non-space character is uppercase, or skip a short list of common abbreviations (e.g., i.e., Dr., vs.).
- **Unused NAMED constant duplicates the ease control points** — `src/lib/kit/keyframes.js:41` (other): NAMED is never read. ease() hardcodes the same bezier points, so the two copies can drift apart. — fix: Delete NAMED, or have ease() read from it (emit would then need the table inlined).
