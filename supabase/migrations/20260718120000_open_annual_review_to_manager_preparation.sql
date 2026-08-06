-- Route newly opened annual reviews directly to manager preparation.
-- Safe to stage in branch/preview only; do not apply to production until approved.

create or replace function public.open_review_for_employee(
  p_review_id uuid,
  p_expected_version bigint
) returns public.annual_reviews
language sql
security definer
set search_path=pg_catalog
as $$
  select public.transition_annual_review(
    p_review_id,
    p_expected_version,
    'manager',
    'not_opened',
    'manager_preparation'
  )
$$;

revoke all on function public.open_review_for_employee(uuid,bigint) from public, anon;
grant execute on function public.open_review_for_employee(uuid,bigint) to authenticated;
