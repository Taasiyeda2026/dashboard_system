-- Retire the legacy PDF-on-lock trigger.
--
-- The current manager approval flow persists the approved attendance PDF to
-- SharePoint before calling manager_finalize_attendance_month_review().
-- Locking the month must therefore not launch the legacy av2-month-pdf flow,
-- which mutates protected pdf_* fields and can roll back the approval.
--
-- Keep av2_guard_pdf_path intact: it still protects the legacy PDF metadata
-- fields from untrusted direct writes.

drop trigger if exists av2_request_pdf_on_lock
on public.attendance_month_approvals;
