# New System Foundation (Phase 1)

This folder contains a clean, from-scratch foundation for the new internal activities system.

## Implemented in this phase

1. Folder and file structure for frontend + Apps Script backend.
2. Modular Apps Script backend skeleton.
3. Frontend skeleton (mobile-first, simple router/state/API client).
4. Login screen.
5. Dashboard screen.
6. Activities screen.
7. Initial Google Sheets connection + strict sheet schema metadata.

## Stack

- **Data**: Google Sheets
- **Backend API**: Google Apps Script Web App
- **Frontend**: Vanilla JS modules, responsive, PWA-ready

## How to run (phase 1)

### Backend

1. Open Google Apps Script project connected to your spreadsheet.
2. Copy files from `new-system/backend/src/*.gs` into the project.
3. Deploy as Web App (`Execute as Me`, access according to your policy).
4. Copy deployment URL.

### Frontend

1. Open `new-system/frontend/src/config.js`.
2. Set `API_URL` to your Apps Script deployment URL.
3. Serve `new-system/frontend` as static files (GitHub Pages / simple static hosting).

