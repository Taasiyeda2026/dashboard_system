# Impact feedback – local E2E (manual only)

Not wired into CI (see AGENTS.md: browser/E2E tests are manual-only). Runs the real admin screen and public
questionnaire against a disposable Postgres + PostgREST stack.

1. Disposable Postgres 16, empty database (e.g. `fb_e2e`).
2. Seed: `E2E_DATABASE_URL=postgres://postgres@127.0.0.1:54329/fb_e2e E2E_ALLOW_RESET=1 node e2e/impact-feedback/seed-demo.mjs`
   (**drops and recreates** the schemas; creates the `authenticator` role, demo courses, campaigns and questionnaires).
3. PostgREST on the same database: `db-uri` as `authenticator`, `db-schemas = "public"`, `db-anon-role = "anon"`,
   `jwt-secret = <secret>`, `server-port = 54330`.
4. Proxy: `POSTGREST_URL=http://127.0.0.1:54330 node e2e/impact-feedback/rest-proxy.mjs` (serves `/rest/v1` on :54321).
5. HS256 JWTs signed with the secret: anon `{"role":"anon"}`, admin `{"role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}`,
   non-admin `{"role":"authenticated","sub":"22222222-2222-2222-2222-222222222222"}`.
6. `VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=<anon JWT> npx vite --port 5173`
7. Re-seed (step 2), then:

```
E2E_APP_URL=http://127.0.0.1:5173 E2E_SUPABASE_URL=http://localhost:54321 \
E2E_ADMIN_TOKEN=<admin JWT> E2E_ANON_TOKEN=<anon JWT> E2E_MANAGER_TOKEN=<non-admin JWT> \
E2E_DATABASE_URL=postgres://postgres@127.0.0.1:54329/fb_e2e CHROMIUM_PATH=/opt/pw-browsers/chromium \
node e2e/impact-feedback/impact-feedback.e2e.mjs
```

The DB contract (`tests/impact-feedback-postgres.test.mjs`) only needs `IMPACT_FEEDBACK_TEST_DATABASE_URL` pointing at a disposable database.
