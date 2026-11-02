# Review 511c8e15-66e9-4a4c-8bf1-71bf7a2df020 — unslop-direction-brief, round 2

- Commit: 3abd3f8
- Angle: failure conditions and error paths
- Result: pass
- 4 findings

## Medium (1)

- **JSON array of blank strings passes as a present field instead of missing** — `src/lib/kit/direction.js:178` (correctness): fromJson joins array elements with '; ' before checkFields trims, so {"moments": \[" ", ""\]} becomes text ';' (present: true, no problems) and \["","",""," "\] becomes '; ; ;' with count 0. The missing check never fires, so with the other four fields valid, check returns ok: true and --strict exits 0 for an empty moments line (probed via cli.js direction check). The same applies to any field given as an array. The .claude/helpers copy has the same code. No test covers it. — fix: Drop blank elements before joining (v.map(x =\> x.trim()).filter(Boolean).join('; ')) so an all-blank array gives '' and reports missing; add a test for moments: \[' ', ''\].

## Low (3)

- **Arrays are accepted for every field, but the docs and error message say only moments** — `src/lib/kit/direction.js:178` (correctness): The array branch has no id === 'moments' guard, so {"character": \["patient"\]} is accepted and joined, yet the header says 'moments may be an array of strings' and line 179's error offers the array form only for moments. A wrong-shaped input for other fields is accepted without an error. — fix: Limit the array branch to id === 'moments', or document that every field accepts an array of strings.
- **Exact duplicate JSON keys: last one wins silently, while text input says first wins and flags it** — `src/lib/kit/direction.js:286` (correctness): JSON.parse keeps the last of {"product":"a","product":"b"} (probed: text 'b', no problem), and the 'given more than once' guard at line 174 only catches case variants. The markdown path reports duplicate\_field and keeps the first. So the same mistake behaves differently depending on the input format. — fix: Document that duplicate JSON keys are last-wins, or detect exact repeats (for example with a reviver or a light key scan) and report duplicate\_field.
- **Non-object JSON (null, an array) on check is read as markdown and reported as five missing fields** — `src/lib/kit/direction.js:286` (other): Only a leading '{' routes to fromJson, so a JSON file containing null or \["Product: a"\] goes to parseText and returns ok:false with five 'missing' problems and exit 0. The 'direction JSON must be an object' error in fromJson can never be reached from the CLI. This follows the documented sniffing rule, but the user gets a misleading message instead of a clear input error. — fix: Also treat a leading '\[' (or text that parses as JSON) as JSON, so fromJson's object error is shown with exit 1.
