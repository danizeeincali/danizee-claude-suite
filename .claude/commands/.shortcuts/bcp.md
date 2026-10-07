# /bcp — alias for /w-background-compound --push

Background-compound-push. Invoke the `.shortcuts:w-background-compound` skill via the Skill tool, passing the user's arguments verbatim as the `args` field **with `--push` appended**. Do not pre-execute any of that skill's pre-flight steps yourself — let the parent skill run its full protocol from scratch.

`/bcp` is the owner's go: after the write-up and commit it pushes the branch and, when not on main, merges to main. For a compound that must not push, use `/bc`.
