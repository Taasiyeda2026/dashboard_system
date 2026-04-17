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

1. `API_URL` is already pre-configured to:
   `https://script.google.com/macros/s/AKfycbwlJuofD5-Adw1CD1pSdBR3f5RRS-LZsBv1I_zMM1-4UN6maq8qdPZqBQ1Zo4c_fneU/exec`
2. If you deploy a different Apps Script version, update `new-system/frontend/src/config.js`.
3. Serve `new-system/frontend` as static files (GitHub Pages / simple static hosting).

### Default spreadsheet binding

- `new-system/backend/src/config.gs` is now bound by default to:
  `1odLLnhpm7gLwSsDrgzxjIy2cuHXZGNNQYXCkuhAt52s`
- Replace this value only if you intentionally switch to a new spreadsheet.
