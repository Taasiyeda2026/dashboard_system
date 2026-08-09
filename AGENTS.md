# Agent Work Scope and Testing Policy

## Work-scope policy

Keep the working context small. For every task, inspect and edit only the files directly relevant to the requested change.

- Do not scan `attached_assets/` unless the task explicitly asks about attached/pasted assets, screenshots, or imported user files.
- Do not scan `dist/` unless the task is specifically about build output, deploy output, generated assets, or Service Worker deployment verification.
- Do not perform broad refactors. Avoid aesthetic-only rewrites, unrelated cleanup, or cross-project restructuring unless explicitly requested.
- Do not read archive, generated, pasted, or bulk asset folders during normal feature/bug tasks. Prefer `docs/PROJECT_MAP.md`, `rg --files`, and targeted file opens.
- Treat `node_modules/`, `dist/`, `attached_assets/`, `artifacts/`, large public catalogs, and generated files as out-of-scope by default.
- Every deployable frontend update must also refresh both cache layers: append a new release marker to `HOTFIX_VERSION` in `frontend/src/config.js` and increment `CACHE_VERSION` in `frontend/sw.js`.
- When a changed CSS or JavaScript entry is loaded directly from `index.html`, also update its query-string version so the browser requests the new asset immediately.
- When touching Service Worker or cache logic, verify that bulky/static archives are not added to cache/precache lists.
- The only manual cache version source is `CACHE_VERSION` in `frontend/sw.js`; root `sw.js` must remain an entry shim only and must not define `SW_ENTRY_VERSION` or any separate manual version.
- Do not restore local Service Worker registrations in catalog pages; the root `sw.js` entry controls the deployed scope.
- Never add PDF, CSV, XLSX, `attached_assets/`, `dist/`, `tests/`, `docs/prompts/`, archive, mock, or debug paths to Service Worker cache/precache lists.

## Agent Testing Policy

**Minimum relevant validation only.** Before every command, ask whether it adds coverage that has not already passed since the last relevant code change. It is valid to run no automated test when none meaningfully covers the change.

Mandatory execution rules:

- Do not run the full legacy suite or Full Regression during an ordinary task. Use them only when explicitly requested or when repairing that suite/workflow itself.
- **Do not rerun an already-passing test or suite unless relevant code changed after that run.** This applies to syntax checks, builds, PWA, DB, E2E, Quick PR checks, and every subset of a previously passing command.
- Do not rerun four or five files in slightly different combinations for extra assurance. If `a`, `b`, and `c` passed together, do not rerun `a` and `b` unless relevant code changed afterward.
- **Prefer test-name-pattern over entire large test files when only specific scenarios changed.** When one to three cases changed, use `node --test --test-name-pattern="<relevant cases>" tests/<file>.test.mjs` rather than the whole file.
- Do not select a test merely because its filename or domain resembles the changed file. Select it only when its assertions exercise the changed behavior.
- Do not run a build unless the change needs build validation. Do not run business tests for CSS-only, text-only, or cache-marker-only changes.
- **No test is required when the change has no meaningful automated test coverage.** Documentation-only changes may need no further validation; otherwise `node --check`, `git diff --check`, or a focused manual/visual check may be sufficient.

Validation by change type:

- **Text only:** use syntax or a pinpoint check only when the edited context requires it; otherwise no automated test.
- **CSS only:** use a build or focused UI/manual check only when needed; never run business-logic tests for CSS.
- **Cache/version only:** use only the relevant PWA/cache check when needed.
- **Single function:** run only test cases for that function or behavior, preferably with `--test-name-pattern`.
- **Focused UI behavior:** run only cases that assert the changed interaction or rendering behavior.
- **Business logic:** run only the cases for the specific rule or behavior changed.
- **DB/RPC/migration:** run only the directly relevant DB contract or migration checks.
- **Broad change or genuine shared dependency:** expand coverage only according to dependencies actually affected, not merely because a shared filename changed.

Local workflow and final CI:

- During development, run only the smallest checks needed for feedback and debugging.
- After changes are complete, `npm run ci:quick` may be run once, and only when relevant. Do not first run everything it will cover manually unless that was necessary for debugging.
- Before any rerun, determine whether relevant code changed since the passing run and record the reason if a rerun is genuinely necessary.
- For every deployable frontend update, verify both the `HOTFIX_VERSION` release marker and the incremented `CACHE_VERSION` before opening or merging the pull request.
- When Service Worker files change, bump/verify `CACHE_VERSION` in `frontend/sw.js` only; root `sw.js` has no manual version.

Legacy full suite:

- `npm run test:all:legacy` runs all `tests/*.test.mjs`.
- Do not run `npm run test:all:legacy` unless the user explicitly asks for a full suite or the task is specifically about repairing the legacy suite.
- This suite may include known failing or historical tests that are not part of regular task verification.

Reporting:

- Report what was checked, why each check was selected, and how many test cases actually ran.
- Report any repeated command and why the rerun was necessary; omit duplicate entries when there was no separate run.
- State whether a build was required and run, and whether SW/cache was updated, only when applicable.
- Do not run checks merely to make the final report longer.
- If a relevant focused check fails, fix it or report it.
- If an unrelated legacy check fails, mention it briefly and do not spend time debugging it unless requested.

## CI Workflow Policy

- Do not create a new workflow that runs Playwright, installs a browser (e.g. Chromium), or runs E2E tests automatically on `pull_request` without an explicit user request.
- Browser/E2E tests are manual-only. Keep them runnable via `npm run test:e2e` and friends, but do not wire them into an automatic `pull_request` trigger.
- Every PR should trigger exactly one automatic quick-check workflow (`quick-pr-check.yml`). Do not add a second automatic workflow next to it.
- Do not expand automatic CI just because a shared file changed, e.g. `frontend/src/feature-loaders.js`, `frontend/src/config.js`, or `frontend/sw.js`. Do not reintroduce per-feature/path-triggered heavy workflows.
- Do not run tests that are not directly related to the task at hand.
