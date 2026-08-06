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

Do not run the full legacy test suite by default.

Default verification for Cursor/Codex tasks:

- For changed JavaScript files, run `npm run check:changed` or `node --check <changed-file>` on the files touched by the task.
- For a changed screen, run only the relevant screen test file when it exists, for example `node --test tests/proposals-agreements-screen.test.mjs`.
- For frontend, build, Service Worker, or `dist` changes, run `npm run check:build`.
- For every deployable frontend update, verify both the `HOTFIX_VERSION` release marker and the incremented `CACHE_VERSION` before opening or merging the pull request.
- When Service Worker files change, bump/verify `CACHE_VERSION` in `frontend/sw.js` only; root `sw.js` has no manual version.
- For proposal-template changes, run syntax checks plus the focused proposal multiline/template tests only.
- Do not run unrelated backend or legacy tests for frontend-only changes.

Legacy full suite:

- `npm run test:all:legacy` runs all `tests/*.test.mjs`.
- Do not run `npm run test:all:legacy` unless the user explicitly asks for a full suite or the task is specifically about repairing the legacy suite.
- This suite may include known failing or historical tests that are not part of regular task verification.

Reporting:

- Summarize changed files, focused checks run, whether `npm run check:build` passed, and whether SW/cache was updated when applicable.
- If a relevant focused check fails, fix it or report it.
- If an unrelated legacy check fails, mention it briefly and do not spend time debugging it unless requested.

## CI Workflow Policy

- Do not create a new workflow that runs Playwright, installs a browser (e.g. Chromium), or runs E2E tests automatically on `pull_request` without an explicit user request.
- Browser/E2E tests are manual-only. Keep them runnable via `npm run test:e2e` and friends, but do not wire them into an automatic `pull_request` trigger.
- Every PR should trigger exactly one automatic quick-check workflow (`quick-pr-check.yml`). Do not add a second automatic workflow next to it.
- Do not expand automatic CI just because a shared file changed, e.g. `frontend/src/feature-loaders.js`, `frontend/src/config.js`, or `frontend/sw.js`. Do not reintroduce per-feature/path-triggered heavy workflows.
- Do not run tests that are not directly related to the task at hand.

## Cursor Cloud specific instructions

- Architecture recap: this is a static Vite SPA (vanilla JS) that talks directly to a hosted Supabase project from the browser. There is **no local backend server and no local database to start** — the only local process is the Vite dev/preview server. Do not look for/spin up Postgres, Redis, Docker, etc.
- Run/build/lint/test commands live in `package.json` and are documented in `README.md`; use those rather than duplicating here. Common ones: `npm run dev` (Vite dev, port **5173**), `npm run build` (build to `dist/`), `npm run preview` (serves the build; E2E uses port **4173**), `npm run check:frontend` / `npm run check:build` for focused checks.
- `dist/` and `node_modules/` are gitignored, so running `npm run build` locally leaves the working tree clean — no need to revert build output.
- Supabase config: `frontend/src/supabase-client.js` has a **hardcoded fallback** project URL + publishable (anon) key, so the app boots and reaches a shared Supabase project even with no env vars set. To point at a controlled project, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (aliases in `.env.example`). The fallback Supabase project was reachable from the Cloud VM.
- Login is gated: authentication needs an admin-provisioned row in the Supabase `users` table plus matching Supabase Auth credentials (`api.js` → `loginWithSupabaseAuth`). There is **no self-signup**, so without real credentials you can only exercise the login flow up to the backend rejecting invalid credentials (a red Hebrew error confirms the frontend↔Supabase wiring works). Full logged-in E2E/manual testing requires valid `E2E_USERNAME` / `E2E_PASSWORD` (and `E2E_BASE_URL`).
- Playwright E2E (`npm run test:e2e`) is optional and manual-only; it needs a one-off `npx playwright install chromium` (see README) and can auto-start its own preview server via `E2E_START_PREVIEW=true`.
