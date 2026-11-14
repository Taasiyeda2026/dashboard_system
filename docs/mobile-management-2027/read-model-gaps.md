# Isolated read-model gaps — no database change applied

These are findings for a separate server-contract review. The mobile implementation uses the existing authenticated interfaces and preserves production policies. No SQL migration or production permission change is included.

## Missing attendance reports

The existing `get_payroll_attendance_records` projection provides direct activity identity but omits `course_dashboard_sources` bundle membership. One instructor report may represent several activity rows. Filtering by direct `activity_row_id` alone therefore cannot prove that an unmatched planned meeting lacks a report. Filtering by the currently assigned instructor would additionally hide historical reports.

Current behavior: show the count of linked visible reports; mark the picture partial; keep missing-report count unknown and the shortcut disabled. Attendance is never execution approval. Missing-report filtering is an unresolved original requirement.

Needed contract: a narrowly scoped authenticated read exposing report-to-activity membership and meeting number/date, a coverage/completeness signal, and existing role/manager/instructor access checks. It should not expose salary, travel, bank, contact, free-text review or unrelated employee data. Reuse the existing authoritative bundle parser/matching logic; do not join by activity title or date alone. Review intentional double meetings and cancellations before accepting any missing predicate.

Required validation before release: direct and bundled reports, two same-date sessions, changed instructor, partial/denied source, cancelled dates, conflicting numeric/text identity; real JWT admin/manager/instructor access and no rows outside permitted scope. A successful empty RLS-filtered response alone cannot establish full coverage.

## Restricted cancellations/history/coordination

Production cancellation and instructor-history reads permit admin/operation_manager. Coordination context has an admin capability boundary. The frontend does not bypass those restrictions for activities_manager: it displays unavailable, not zero. For a fully useful manager snapshot, owners must decide whether a limited status/date projection for the manager's exact activity rows is authorized. Any server function/view must retain the existing scoped access mechanism and avoid broadening direct table policies. No proposed signature here grants new access.

## Tasks and notifications

`manager_ongoing_tasks.activity_label` is a label, not a proven activity row key. Weekly program updates use activity/program number, not exact group identity. Existing notification targets represent employee/month or personal/proposal report workflows. These cannot reliably be attached to an activity just because names/programs match. Existing screen navigation remains available; per-activity task/notification aggregation stays unimplemented until an exact authoritative relationship exists.

## Local acceptance environment

GoTrue/PostgREST/Postgres worked with real synthetic accounts, but the minimal existing fixture does not reproduce the entire live database. Payroll/history/coordination/automation dependencies and edit-request approvals were not fully installed. This is a technical validation limit, not evidence of a production failure. Complete the remaining workflows against an isolated complete fixture or authorized non-production environment; never test writes on production to close this gap.
