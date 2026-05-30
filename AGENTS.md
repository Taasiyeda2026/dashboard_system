# Agent Testing Policy

Do not run the full legacy test suite by default.

Default verification for Cursor/Codex tasks:

- For changed JavaScript files, run `npm run check:changed` or `node --check <changed-file>` on the files touched by the task.
- For a changed screen, run only the relevant screen test file when it exists, for example `node --test tests/proposals-agreements-screen.test.mjs`.
- For frontend, build, Service Worker, or `dist` changes, run `npm run check:build`.
- When Service Worker files change, verify the cache version is bumped consistently in both `frontend/sw.js` and root `sw.js`.
- For proposal-template changes, run syntax checks plus the focused proposal multiline/template tests only.
- Do not run unrelated backend or legacy tests for frontend-only changes.

Legacy full suite:

- `npm run test:all:legacy` runs all `tests/*.test.mjs`.
- This suite may include known failing or historical tests that are not part of regular task verification.
- Only run it when the user explicitly asks for a full suite or when the task is specifically about repairing the legacy suite.

Reporting:

- Summarize changed files, focused checks run, whether `npm run check:build` passed, and whether SW/cache was updated when applicable.
- If a relevant focused check fails, fix it or report it.
- If an unrelated legacy check fails, mention it briefly and do not spend time debugging it unless requested.
