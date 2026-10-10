---
name: test-asserts-nothing
globs:
  - "**/*.{test,spec}.{js,mjs,cjs,jsx,ts,tsx}"
  - "test/**/*.{js,mjs,cjs,ts}"
  - "tests/**/*.{js,mjs,cjs,ts}"
  - "**/test_*.py"
  - "**/*_test.py"
match: \b(it|test)(\.(only|skip|todo))?\s*\(|\bdef test_|\.skip\b|\.only\b|assert\.ok\(\s*true\s*\)|expect\(\s*true\s*\)
---
Look for a test that can pass without proving anything.

Read each changed or added test body and ask: if the code under test were deleted or broken, would this test fail?
Warning signs: no assertion at all; an assertion that is always true (`assert.ok(true)`, `expect(true)`); an assertion
inside a callback that may never run; a promise that is not awaited, so the test ends before the check; a name that
promises one behaviour while the assertion checks only that nothing threw; a `.skip`, `.only` or `.todo` left in;
a fake that is more lenient than the real thing it stands for.

Report the test name, file and line, and the one change that would make it fail when the behaviour is wrong.
