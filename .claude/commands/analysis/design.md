# Design Workflow

Generate UI component designs with specifications.

## Usage
```
/frontend-design:design [component description]
```

**Intake first (one batch).** Before designing, write what is known to `"$BRIEF"` (`{kind: landing|ui|motion, answers: {...}}`), ask every question `questions` prints in one round, and fill the gaps with the stated assumptions `assume` prints. Before running a block, put the real path in place of each `NAME='<...>'` placeholder at its top (the CSS selector for `BG_SELECTOR`, a file:// or localhost URL for `URL`); shell variables do not persist between Bash calls, so run the block as one. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.

```bash
BRIEF='<the brief JSON you wrote>'; [ -f "$BRIEF" ] || echo "BRIEF is still the placeholder or does not exist: put the path of the brief JSON you wrote in place of <the brief JSON you wrote>" >&2
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js design-brief questions --file "$BRIEF"; RC=$?; (exit $RC); fi
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js design-brief assume --file "$BRIEF"; RC=$?; (exit $RC); fi
```

Exit 0 printed the answer; exit 1 is wrong input or a broken state: report it and fix the input, never read it as a pass. The step is advisory: whatever it prints, the workflow goes on.

## What It Creates
- Component specification
- Visual hierarchy
- Interaction patterns
- Accessibility considerations
- Responsive breakpoints

**Design kit checks (advisory).** For a landing page, the output follows the fixed numbered section sequence `landing-sections plan` prints; typography tokens are snapped to Tailwind steps with paired line heights (`type-scale audit` on `"$CSS"`); sample content follows the realistic-content checklist (`sample-content lint` on `"$PAGE"`). Before running a block, put the real path in place of each `NAME='<...>'` placeholder at its top (the CSS selector for `BG_SELECTOR`, a file:// or localhost URL for `URL`); shell variables do not persist between Bash calls, so run the block as one. If `.claude/helpers/kit/cli.js` is missing, say so in one line and continue; the kit is advisory and never blocks a workflow that worked before.

```bash
CSS='<the stylesheet>'; [ -f "$CSS" ] || echo "CSS is still the placeholder or does not exist: put the path of the stylesheet in place of <the stylesheet>" >&2
PAGE='<the page or copy file>'; [ -f "$PAGE" ] || echo "PAGE is still the placeholder or does not exist: put the path of the page or copy file in place of <the page or copy file>" >&2
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js landing-sections plan; RC=$?; (exit $RC); fi
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js type-scale audit --file "$CSS"; RC=$?; (exit $RC); fi
if [ ! -f .claude/helpers/kit/cli.js ]; then echo "kit not installed (.claude/helpers/kit/cli.js missing): step skipped, advisory"; (exit 0); else node .claude/helpers/kit/cli.js sample-content lint --file "$PAGE"; RC=$?; (exit $RC); fi
```

Exit 0 printed the answer; exit 1 is wrong input or a broken state: report it and fix the input, never read it as a pass. The step is advisory: whatever it prints, the workflow goes on.

## Example
```
/frontend-design:design user profile card with avatar, name, and action buttons
```
