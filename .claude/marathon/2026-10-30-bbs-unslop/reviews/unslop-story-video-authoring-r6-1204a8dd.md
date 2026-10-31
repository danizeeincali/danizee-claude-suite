# Review 1204a8dd-0736-419a-98d7-284f04ef169c — unslop-story-video-authoring, round 6

- Commit: 2cb7d9b
- Angle: facts and content
- Result: pass
- 2 findings

## Low (2)

- **A swap text wider than its element spills out of it, and the template's own example does so on a small button** — `src/lib/kit/story-plan.js:345` (docs): The \<story-swap\> is out of flow, white-space:nowrap and width:max-content, centred over the old text, and the element keeps its size. So new text wider than the element's box runs past its edges. I rendered the template story over a page whose .btn is a pill button with the label "Go" (about 42px wide, align-self:flex-start). At t=4500 the 55px-wide "Start free" hangs about 7px past each side of the button. Its white ink is invisible on the light card there, so the label reads "tart fre". The header describes the swap as "one line as wide as the new text" moved over the old text, but its 'Limits of the inserted swap child' list never says that a longer label overflows the element. The template, which is the example authors copy, swaps a short CTA to a longer one without saying so. It is advisory, the page is the author's own and the author sees it in a preview, so this is low. — fix: Add one line to the swap limits in the header: the element keeps its size, so new text wider than it overflows; widen it with a padding step first. Optionally put a note in the template's step (or make its swap text no longer than a typical short label).
- **Header says pill-radius fires at 999px and up; check fires at 500px** — `src/lib/kit/story-plan.js:27` (facts): The rules table says 'pill-radius a pill radius (999px and up) cannot tween', but check() flags any plain radius \>= 500 (line 260: Number(m\[1\]) \>= 500). So an author who reads the header and writes border-radius 600px gets an unexpected pill-radius problem, and ok becomes false. — fix: Change the header to '(500px and up)', or make the code threshold match the documented 999.
