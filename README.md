# Internal Dashboard System (Google Sheets + Apps Script + Vanilla JS)

This repository is a brand new internal dashboard system built from scratch with:

- Vanilla JS (ES modules)
- Google Apps Script backend
- Google Sheets as source of truth
- Mobile-first RTL UI
- PWA support (manifest + service worker)

## Final Sheets

- `data_short`
- `data_long`
- `activity_meetings`
- `permissions`
- `lists`
- `contacts_instructors`
- `contacts_schools`
- `edit_requests`
- `operations_private_notes`

## Key Rules Implemented

- `data_short` = one-day activities, supports `instructor_1` and `instructor_2`.
- `data_long` = multi-date activities, supports `instructor_1` only.
- `activity_meetings` stores dates for `data_long` only.
- `direct_manager` is read only from `contacts_instructors`.
- Admin + operations reviewer can add/edit source data directly.
- Authorized user + instructor submit edit requests (no direct source edit).
- Instructor routes are limited to `my-data`.
- No settings screen, no lists screen, no heavy approval workflow.

## Frontend Setup

1. Open `frontend/src/config.js`.
2. Set `apiUrl` to your deployed Apps Script Web App URL.
3. Serve repository root with any static server and open `index.html`.

## Backend Setup

1. Copy `backend/Code.gs` into Apps Script.
2. Set `APP_CONFIG.spreadsheetId`.
3. Ensure each target sheet has a header row matching used keys.
4. Deploy as Web App (execute as script owner, accessible to required users).
