-- Every saved manager value is a current, accountable value; no draft concept.
-- Submitted weekly management reports remain immutable snapshots.
-- Existing saved data (if any) is preserved in place.
alter table public.manager_weekly_reports
  alter column status set default 'current';
alter table public.manager_weekly_reports
  drop constraint if exists manager_weekly_reports_status_check;
update public.manager_weekly_reports
set status = 'current'
where status = 'draft';
alter table public.manager_weekly_reports
  add constraint manager_weekly_reports_status_check
  check (status in ('current','submitted'));
drop policy if exists manager_weekly_reports_update_drafts_self on public.manager_weekly_reports;
create policy manager_weekly_reports_update_current_self
on public.manager_weekly_reports for update to authenticated
using (
  manager_user_id = (select public.manager_weekly_self_user_id())
  and status = 'current'
) with check (
  manager_user_id = (select public.manager_weekly_self_user_id())
  and status in ('current','submitted')
);
-- The existing valid-submission and submitted_at constraints still apply to
-- 'submitted' only. All entered current values are stored and visible now.
