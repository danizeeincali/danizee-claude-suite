---
name: shell-string-concat
globs:
  - "**/*.{js,mjs,cjs,jsx,ts,tsx,py,rb,sh}"
match: (exec|execSync|spawn\w*|system|popen|subprocess\.\w+|shell\s*:\s*true)\b.*(\+\s*\w|\$\{|%s|\bf["'])|shell\s*:\s*true
---
Look for a shell command that is built by gluing strings together: `+`, a template literal with `${...}`, `%s`
formatting, an f-string, or `shell: true` with a variable inside the command.

Whatever ends up in the glued part (a branch name, a file name, a user message, text from a diff) becomes shell
syntax, so a space, quote, `;` or `$(...)` in it runs something else or breaks the command. Prefer the form that takes
an argument list (`execFile`, `spawn` without a shell, `subprocess.run([...])`), which never passes through a shell.

Report each place where changed text reaches a shell, say which part is variable and who controls it.
