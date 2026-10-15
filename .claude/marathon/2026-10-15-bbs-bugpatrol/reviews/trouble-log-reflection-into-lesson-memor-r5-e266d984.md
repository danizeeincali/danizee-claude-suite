# Review e266d984-c342-4e3d-900a-4077d333a940 — trouble-log-reflection-into-lesson-memor, round 5

- Commit: 7a0ce33
- Angle: accessibility
- Result: pass
- 1 findings

## Medium (1)

- **Lessons in any language whose first letter is not plain ASCII are refused with a misleading 'starts with a verb' error** — `src/lib/kit/reflect.js:233` (accessibility): checkLessonText requires /^\[A-Za-z\]/ on the text, and line 232 strips every non-ASCII letter from the first word. A lesson written in German, French, Russian, Japanese and so on is refused with exit 1 and 'a lesson starts with a verb (imperative)', even when it does start with an imperative verb. Confirmed through cli.js in a fresh git repo: 'Éteignez le cache avant les tests.', 'Überprüfe die Konfiguration vor dem Deploy.', 'Проверьте конфигурацию перед деплоем.' and '設定を確認してからデプロイする。' all exit 1 with that message, while 'Run the linter before pushing changes.' saves. A team or reviewer model working in another language cannot save any lesson, and the error tells it to fix something that is not wrong. The same ASCII-only rule in words() (line 205, /\[^a-z0-9\s\]/) splits accented words into fragments ('Vérifiez' becomes 'v' and 'rifiez'), so the near-match guard scores non-English lessons on broken word pieces. — fix: Use Unicode letter classes: test /^\p{L}/u on the text, strip with /\[^\p{L}'\]/gu for the first word, and normalise words() with /\[^\p{L}\p{N}\s\]/gu; add a test that saves a lesson starting with an accented capital and one in a non-Latin script.
