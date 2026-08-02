# E2E and Performance Gate

Playwright (Chromium) suite that gates PRs affecting the UI, data loading, or performance.

## Required GitHub Secrets

| Secret | Purpose |
| --- | --- |
| `E2E_USERNAME` | Dedicated test user username (login form `#userId`) |
| `E2E_PASSWORD` | Dedicated test user entry code (login form `#entryCode`) |
| `E2E_BASE_URL` | Live site URL for post-deploy smoke (e.g. `https://taasiyeda2026.github.io/dashboard_system`) |
| `VITE_SUPABASE_URL` | Already used by Deploy — required to build the preview app |
| `VITE_SUPABASE_ANON_KEY` | Already used by Deploy — required to build the preview app |

Never commit credentials, tokens, or `e2e/.auth/storage-state.json`.

## Local run

```bash
export E2E_USERNAME=...
export E2E_PASSWORD=...
export E2E_BASE_URL=http://127.0.0.1:4173
export E2E_START_PREVIEW=true
export VITE_SUPABASE_URL=...
export VITE_SUPABASE_ANON_KEY=...
npm run build
npm run test:e2e
```

Capture / refresh baseline on `main`:

```bash
E2E_UPDATE_BASELINE=1 npm run test:e2e:baseline
```

## Required Status Check name

Configure branch protection with:

`E2E and Performance Gate / e2e-performance`

## Screens covered

Login, dashboard, activities, week, month, client file (landing / open / open proposal / new proposal form), operations management, instructors, contacts — plus client-file paging/search guards and per-screen performance budgets.
