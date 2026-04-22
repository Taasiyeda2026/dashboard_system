Implement a focused redesign of the activity drawer on the Activities page so it matches the approved mockup exactly.

Visual source of truth:
Use these files as the exact visual and behavioral reference:
- docs/mockups/activity-drawer/activity-drawer-view
- docs/mockups/activity-drawer/activity-drawer-edit_1
- docs/mockups/activity-drawer/activity-drawer-edit_2
- docs/mockups/activity-drawer/DrawerMockup.jsx

Important:
- The mockup files above are the visual source of truth.
- Do not interpret them loosely.
- Do not “improve” beyond them if that causes deviation from the approved structure and behavior.

Work only in these files:
- frontend/src/screens/activities.js
- frontend/src/screens/shared/activity-detail-html.js
- frontend/src/screens/shared/bind-activity-edit-form.js
- frontend/src/screens/shared/interactions.js
- frontend/src/styles/main.css

Do not:
- do not scan the whole repo
- do not change backend
- do not change API contracts
- do not change Google Sheets structure / schema
- do not change business logic outside the activity drawer
- do not redesign other screens
- do not add hardcoded arrays for activities / funding / instructors / managers / authorities
- do not duplicate source of truth that already exists in the system

Data rules:
- Use only existing system sources for dropdowns and lists.
- If the current drawer contains hardcoded lists, remove them and switch to the system’s existing sources.
- Do not keep source-of-truth lists inside activity-detail-html.js.

Goal:
Replace the current activity drawer with a clean, hierarchical, accurate drawer that matches the mockup in:
- information hierarchy
- visual density
- block order
- header structure
- edit mode behavior
- date editing behavior
- removal of duplicate fields in view mode

1) Header
The header must contain:
- a small type pill showing one of:
  - קורס
  - חוג אפטרסקול
  - סדנה
  - סיור
  - חדר בריחה
- main title: activity name
- meta line below:
  - small quiet status
  - בית ספר · רשות
- close button in the corner

Do not show in the header:
- finance status
- finance notes
- extra admin metadata

2) Drawer body structure
The drawer body must contain exactly 4 blocks, in this order:
- 👤
- 📚
- 📅
- 📝

Important:
- block titles must be emoji only
- do not write text section titles like:
  - אנשים
  - פעילות
  - תאריכים
  - הערות

3) 👤 block
Always show:
- מנהל פעילות

Instructor rules:
- only for workshop / סדנה:
  - מדריך/ה 1
  - מדריך/ה 2
- for every other activity type:
  - only one מדריך/ה

Important:
- do not use long/short logic to determine number of instructors
- instructor count must be based only on activity_type

4) 📚 block
View mode:
Do not show again:
- activity name
- school
- authority
- grade as separate field
- class/group as separate field
- price

Do show:
- מימון
- כיתה = combined value from שכבה + קבוצה/כיתה
- שעות
- יום

Edit mode:
Show editable fields:
- activity selector label must match type:
  - שם קורס
  - שם חוג אפטרסקול
  - שם סדנה
  - שם סיור
  - שם פעילות
- מימון
- מחיר
- בית ספר
- רשות
- שכבה
- קבוצה / כיתה
- שעת התחלה
- שעת סיום

Rules:
- מחיר appears only in edit mode, next to מימון
- מחיר does not appear at all in view mode
- רשות in edit mode must be a free text input, not a fixed dropdown
- activity selector options must be filtered by activity_type using the system’s existing data source
- if activity_type changes, the selector options must refresh accordingly
- do not expose activity_no in the UI
- if activity_no is required internally for save logic, preserve it behind the scenes without showing it

5) 📅 block
This block must match the mockup very closely.

General:
- edit controls belong in this block header only
- end date is displayed above the dates as an important computed value

View mode:
- show progress bar
- show prominent end date row above dates
- end date is always calculated from the last meeting
- dates are displayed in 3 columns
- no direct editing of end date

Edit mode:
- end date remains visible
- end date is read-only
- end date updates only through meeting dates
- dates are displayed in 2 columns
- each date opens as a real date picker
- support two modes:
  - single mode: changes only that date
  - chain mode: changes that date and all following dates in weekly jumps
- include ➕ add meeting button:
  - adds a new meeting one week after the last date
  - session count is derived from meeting_schedule length

Rules by activity type:
- סדנה / סיור / חדר בריחה:
  - always exactly one date
  - no ➕ button
  - no chain/single toggle
  - no multiple meetings behavior
- קורס / חוג אפטרסקול:
  - full meeting list supported
  - ➕ enabled
  - chain/single enabled

6) 📝 block
- regular notes visible to all relevant users
- private operational note visible only to permitted users
- the private section header is a small 🔒 badge only
- do not write “תפעול בלבד”

7) Remove duplicates in view mode
Do not show these again in view mode:
- activity name inside the 📚 block
- school
- authority
- grade
- class/group
- price
- footer like “X מפגשים · ₪Y ליחידה”
- RowID

8) Visual implementation
The result must feel like a real polished panel, not a raw form.

Required visual characteristics:
- dark clean header
- light section cards
- clear spacing hierarchy
- quiet pills
- highlighted end date row
- neat dates grid
- clean notes/private section separation

Use:
- existing design system
- main.css
- shared utility classes if already available

Prefer:
- structured CSS classes
- minimal inline styles only if absolutely necessary

Create / update classes for:
- drawer header
- type pill
- meta row
- section block
- end date row
- dates grid
- date card
- private note section

9) Save / cancel behavior
Keep existing save flow through saveActivity.

Required behavior:
- after save, drawer stays open
- drawer returns to view mode
- success toast appears
- drawer data refreshes
- cancel returns to view mode without saving

10) Decision rules
If there is a conflict between:
- the old implementation
- general interpretation
- the approved mockup files

The approved mockup files win.

If there is a conflict between:
- hardcoded lists in the drawer
- existing system sources

The existing system sources win.

11) Cleanup
If old drawer code becomes irrelevant after this redesign:
- remove it
- do not leave dead UI branches that conflict with the new structure

12) Output required
At the end, return:
- files changed
- what changed in each file
- which hardcodes were removed
- which behaviors were added
- which existing behaviors were preserved
- which existing data sources were reused instead of hardcoding
