-- Allow request-only activity editors to insert edit_requests without granting
-- direct UPDATE permission on public.activities.

create or replace function public.app_can_request_edit()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.app_is_admin_or_operation_manager()
    or public.app_has_permission('can_request_edit')
    or public.app_has_permission('can_request_edit_2')
    or public.app_current_role() in ('activities_manager', 'instructor_manager', 'business_development_manager'),
    false
  )
$$;

revoke all on function public.app_can_request_edit() from public;
grant execute on function public.app_can_request_edit() to authenticated;

alter table public.edit_requests enable row level security;

drop policy if exists edit_requests_insert_all on public.edit_requests;
drop policy if exists edit_requests_insert_requesters on public.edit_requests;

create policy edit_requests_insert_requesters
on public.edit_requests
for insert
to authenticated
with check (
  public.app_can_request_edit()
  and requested_by_user_id = public.app_current_user_id()
  and coalesce(status, 'pending') = 'pending'
);

grant insert on public.edit_requests to authenticated;
