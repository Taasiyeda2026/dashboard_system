-- Resolve an annual-review manager's full name without exposing Auth identifiers
-- through the general employee directory. Only a participant in a review assigned
-- to the requested manager may call this function.
create or replace function public.resolve_annual_review_manager_name(p_manager_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(nullif(btrim(u.full_name), ''), nullif(btrim(u.name), ''))
  from public.users as u
  where u.auth_user_id = p_manager_id
    and u.is_active = true
    and exists (
      select 1
      from public.annual_reviews as review
      where review.manager_id = p_manager_id
        and auth.uid() in (review.employee_id, review.manager_id)
    )
  limit 1;
$$;

revoke all
on function public.resolve_annual_review_manager_name(uuid)
from public, anon;

grant execute
on function public.resolve_annual_review_manager_name(uuid)
to authenticated;

comment on function public.resolve_annual_review_manager_name(uuid) is
  'Returns the full name of an annual-review manager only to a participant assigned to that manager.';
