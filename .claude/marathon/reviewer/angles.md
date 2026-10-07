# Reviewer angles

Each review round takes one angle; `cli.js review-brief` rotates through them in order. The rotation itself is `DEFAULT_ANGLES` in `reviewer.js` — this table documents it; editing the table alone does not change the rotation.
A "confirm the fixes" pass is never a round on its own — it came back clean and missed real
defects. Fix confirmation happens inside the next angled round.

| Round | Angle | What the reviewer looks for |
|-------|-------|-----------------------------|
| 1 | One input method at a time | Keyboard only, then touch only, then mouse only, then screen reader. Each path must complete the task. |
| 2 | Failure conditions and error paths | What happens on a timeout, an empty response, a malformed file, a full disk, a missing permission. |
| 3 | Older environments and degraded networks | Older browsers or Node versions the project supports, slow or flaky networks, offline. |
| 4 | The three safety probes | Egress: does anything leave the machine that should not? Secrets: can any key or token be read or logged? Sandbox: can foreign code touch files or sockets outside its box? |
| 5 | Accessibility | Labels, focus order, announcements, contrast, motion. Announcements that fire too often count. |
| 6 | Facts and content | Every number, name, date and claim in copy or docs is true and current. |
| 7 | Performance and memory | Expected data sizes, repeated operations, leaks across runs, unbounded growth. |

## Scope

Review the diff from the **last certified point** to HEAD — the commit that the last *completed*
clean streak certified, else the stream's base commit — not the whole tree. An over round
certifies nothing, so every round of a clean streak judges the same code from a different angle.
Lock files and generated assets are excluded; an oversize diff arrives as `--stat` plus the first
part — read the listed files directly. Reread a file only when the diff does not make its
behaviour clear.

## Output

JSON rows only, one per finding:

```json
{ "severity": "high|medium|low", "category": "<from the list in the brief>",
  "file": "path", "line": 12, "title": "one line", "detail": "why it is wrong",
  "fix_hint": "what would fix it" }
```

No prose outside the rows. The write-up is generated from them.
