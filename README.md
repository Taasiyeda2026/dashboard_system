# Operations System (New Internal Build)

Small, mobile-first internal system with Google Sheets as source of truth and Google Apps Script as backend API.

## Stack
- Google Sheets
- Google Apps Script (`backend/Code.gs`)
- Vanilla JavaScript ES Modules frontend
- PWA support (`frontend/public/manifest.json`, `frontend/public/sw.js`)

## Data sheets
1. `data_short`
2. `data_long`
3. `activity_meetings`
4. `permissions`
5. `lists`
6. `contacts_instructors`
7. `contacts_schools`
8. `edit_requests`
9. `operations_private_notes`

## Role model
- **Admin**: direct read/write/add to source data.
- **Operations reviewer**: direct read/write/add, edit-request review, private notes access.
- **Other authorized users**: submit edit requests only.
- **Instructor**: my-data only.

## Screens
1. Dashboard
2. Activities
3. Week
4. Month
5. Instructors
6. Exceptions
7. My Data
8. Contacts
9. Finance
10. Permissions

## Quick start

### Backend (Apps Script)
1. Create Apps Script project attached to your spreadsheet.
2. Paste `backend/Code.gs`.
3. Set `SETTINGS.spreadsheetId`.
4. Deploy Web App and copy deployment URL.

### Frontend
1. Set `frontend/src/config.js` with the deployment URL.
2. Serve repository as static site.
3. Open `index.html`.

## Notes
- `data_short.start_date` is one day only.
- `data_long.start_date/end_date` are derived from `activity_meetings`.
- `direct_manager` is read from `contacts_instructors`.
- Exceptions run on `data_long` only with priority:
  1) missing instructor
  2) missing start date
  3) end date after `2026-06-15`

## Manual validation checklist (deployment readiness)

Run these checks against the deployed Apps Script Web App URL and the served frontend on real devices/browsers.

- [ ] admin login
- [ ] operations reviewer login
- [ ] authorized user login
- [ ] instructor login
- [ ] session restore
- [ ] logout
- [ ] admin direct edit
- [ ] operations reviewer direct edit
- [ ] authorized user edit request creation
- [ ] authorized user cannot add directly
- [ ] operations reviewer can add directly
- [ ] private notes visible only to operations reviewer
- [ ] exceptions logic validation
- [ ] finance screen validation
- [ ] permissions screen save validation
- [ ] week view on mobile
- [ ] month view on mobile
- [ ] activities screen table/compact toggle on mobile
- [ ] PWA install and refresh validation
