# Review feedb464-8b6d-4754-8a99-41e538a34a1d — preflight-doctor-checks-before-a-run, round 4

- Commit: 97cafcd
- Angle: the three safety probes: egress, secrets, sandbox escape
- Result: pass
- 1 findings

## Low (1)

- **gh-auth never looks in gh's Windows config dir, so logged-in Windows users always get the warning** — `src/lib/kit/doctor.js:158` (correctness): When neither GH\_CONFIG\_DIR nor XDG\_CONFIG\_HOME is set, checkGhAuth falls back to (HOME||USERPROFILE)/.config/gh. On Windows, gh keeps hosts.yml in %AppData%\GitHub CLI, so for a Windows user logged in with gh (and no GH\_TOKEN) the review profile always reports the advisory 'no gh login found' and tells them to run gh auth login. The module clearly targets win32 too (findOnPath handles PATHEXT). Confirmed by reading the code and by running checkGhAuth({HOME, USERPROFILE, AppData}) with a hosts.yml only under AppData: the AppData key is never read. The exit code is unchanged because the row is advisory. — fix: Before the ~/.config/gh fallback, when process.platform === 'win32' and env.AppData (or APPDATA) is set, use path.join(AppData, 'GitHub CLI'). Mirror the header comment and add a test that injects the platform or the dir list.
