## Architecture overview

- **Data layer**: Google Sheets is the only source of truth.
- **API layer**: Google Apps Script Web App exposes thin action endpoints.
- **Frontend layer**: Mobile-first web app, PWA-ready, all data via Apps Script only.
- **Design rule**: No direct frontend access to sheets.

## Final folder/file structure

```
new-system/
  README.md
  ARCHITECTURE_OVERVIEW.md
  backend/
    src/
      Code.gs
      config.gs
      router.gs
      sheets.gs
      auth.gs
      actions/
        login.gs
        bootstrap.gs
        dashboard.gs
        activities.gs
  frontend/
    index.html
    public/
      manifest.json
      sw.js
    src/
      main.js
      config.js
      api/
        client.js
      app/
        state.js
        router.js
      screens/
        login.js
        dashboard.js
        activities.js
      styles/
        main.css
```

## Data flow between frontend, Apps Script, and Google Sheets

1. Frontend calls Apps Script action (`login`, `getBootstrap`, `getDashboard`, `getActivities`).
2. Apps Script router authenticates (except login).
3. Action reads needed sheet(s) from Google Sheets.
4. Apps Script returns compact JSON.
5. Frontend renders screen state.

## Screen structure

- **Login**: entry code input + submit + error text.
- **Dashboard**: 4 compact KPI cards + manager-level summary.
- **Activities**: activity-type tabs + relevant filters + compact list.

## Permission flow

- User identity source: `permissions` sheet.
- Login validates by `entry_code` + `active`.
- Protected actions require session and permission flag:
  - `view_dashboard` for Dashboard API.
  - `view_activities` for Activities API.

## Edit/add flow

- In phase 1 only read flow + login are implemented.
- Add/edit flow will follow spec:
  - direct edit for Admin / operations reviewer.
  - edit request flow for others via `edit_requests`.

## Mobile + PWA implementation plan

- Responsive CSS first with compact cards and one-column mobile fallback.
- PWA baseline delivered:
  - `manifest.json`
  - `sw.js`
  - service worker registration in `main.js`
- Next phases: offline strategy tuning, install prompts, icon pack.

## Exact files to create first

1. `backend/src/config.gs`
2. `backend/src/sheets.gs`
3. `backend/src/auth.gs`
4. `backend/src/router.gs`
5. `backend/src/actions/login.gs`
6. `backend/src/actions/dashboard.gs`
7. `backend/src/actions/activities.gs`
8. `frontend/src/config.js`
9. `frontend/src/api/client.js`
10. `frontend/src/app/state.js`
11. `frontend/src/app/router.js`
12. `frontend/src/screens/login.js`
13. `frontend/src/screens/dashboard.js`
14. `frontend/src/screens/activities.js`
15. `frontend/src/styles/main.css`

## Any blockers still requiring decision

1. Final authentication model: entry code only vs Google identity binding.
2. Hosting path decision for final production (domain + base path).
3. CORS/deployment policy for Apps Script endpoint (public vs restricted).
4. Whether Hebrew headers are written automatically in setup script or manually.
