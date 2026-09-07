-- Fix the Eden 2026-09-30 school-calendar exception flow.
-- The original exception table intentionally revoked direct API access, but the
-- activity validation trigger inserts into this table under the authenticated
-- session. Grant only the operations required by that flow and keep RLS narrow.

grant select, insert
on table public.activity_school_calendar_exceptions
to authenticated;

drop policy if exists "eden_can_read_own_20260930_calendar_exception"
on public.activity_school_calendar_exceptions;

create policy "eden_can_read_own_20260930_calendar_exception"
on public.activity_school_calendar_exceptions
for select
to authenticated
using (
  meeting_date = date '2026-09-30'
  and approved_by_user_id = '6000'
  and exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.user_id = '6000'
      and u.is_active is true
  )
);

drop policy if exists "eden_can_insert_own_20260930_calendar_exception"
on public.activity_school_calendar_exceptions;

create policy "eden_can_insert_own_20260930_calendar_exception"
on public.activity_school_calendar_exceptions
for insert
to authenticated
with check (
  meeting_date = date '2026-09-30'
  and approved_by_user_id = '6000'
  and exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.user_id = '6000'
      and u.is_active is true
  )
);
