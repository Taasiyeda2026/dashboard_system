# Remaining acceptance — real device and complete local fixture

No physical device was available. Playwright WebKit download returned HTTP403 (Domain forbidden); Chromium emulation cannot substitute for Safari or a real keyboard/safe area.

Use synthetic accounts and an isolated local/test database only. No production editing, approving or sending. Record browser/OS, role, viewport, pass/fail and a screenshot without personal data.

## Short physical-device pass (iPhone Safari + installed PWA; Android Chrome + installed PWA)

1. Sign in separately as admin, activity manager and instructor using real Auth. Confirm each sees only permitted menus/rows. Instructor must not gain manager activity/feedback treatment actions.
2. Search activities, select a management filter, expand a card, open its original drawer and return. Confirm search/filter/expanded state and list position persist. Compare verified execution, cancellation/unknown, next meeting and audience/stage statuses to the synthetic source rows.
3. Rotate portrait/landscape. Check notch/top header and home-indicator/bottom actions. No page-wide overflow; a Gantt/matrix scrolls inside its own container.
4. Open the existing edit form. Focus first/last inputs and notes, open the on-screen keyboard, scroll to save/cancel, dismiss keyboard and cancel. Actions must remain reachable; no input zoom/clipped footer. Test drawer and nested confirmation dialog independently.
5. Install the earlier PWA build on the same test origin; release the candidate test build, reopen/update/reload and confirm the new marker/assets. Retired static cache removed; API data stays network-only. Repeat after app background/resume and network interruption.

## Complete isolated-schema workflow pass

- Dashboard: populated districts, each KPI/district drill-down agrees with original counts and returns correctly.
- Manager: management, attendance, tracking and admin payroll tabs; month/week/day, Gantt local scroll, orange instructor-file action clear of tab controls; team agreements/documents/police/feedback/observation statuses match their actual sources.
- Instructors: active/inactive search, open file, assignments, work schedule, maintenance and payroll local scroll.
- Feedback: each audience/stage, zero/unopened/unavailable states, permitted edit/open/close/answer/export and denied-role attempts. Keep automated external sending disabled in the test environment.
- Activities: all management filters (missing reports only after the reviewed complete read contract exists), indicator→actual treatment→return, stale role/session, source outage, concurrent drawer/late response and preserved unsaved edits.
- Operations/approvals/end dates/archive: nested screens, existing add/edit/cancel/delete confirmation/export; actual permitted test saves/approvals and denied-role server responses. Delete only disposable fixture records. Existing end-date live replacement currently exposes different controls from the base renderer; verify the version actually used.

Do not mark a workflow passed merely because its navigation/tab opened. Current executed paths and limits are listed in README.md; these items remain outstanding.
