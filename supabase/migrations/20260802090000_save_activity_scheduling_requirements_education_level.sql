-- Narrow save_activity_scheduling_requirements to the three activity fields used by
-- the simplified scheduling-requirements modal. Existing blocked/allowed lists and
-- scheduling_note values are intentionally left untouched.
drop function if exists public.save_activity_scheduling_requirements(text, text, text, text[], text[], text);

create or replace function public.save_activity_scheduling_requirements(
  p_activity_id text,
  p_instruction_language text,
  p_required_instructor_gender text,
  p_education_level text
) returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.activities;
  caller_role text := public.app_current_role();
  normalized_language text := nullif(btrim(coalesce(p_instruction_language, '')), '');
  normalized_gender text := coalesce(nullif(btrim(coalesce(p_required_instructor_gender, '')), ''), 'any');
  normalized_education text := nullif(btrim(coalesce(p_education_level, '')), '');
begin
  if caller_role <> all(array['admin', 'operation_manager']) then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;

  select * into result
  from public.activities
  where row_id = p_activity_id
  for update;
  if not found then
    raise exception 'activity_not_found';
  end if;
  if coalesce(result.activity_season, '') <> 'school_2027' then
    raise exception 'scheduling_activity_not_school_2027';
  end if;
  if lower(btrim(coalesce(result.status::text, ''))) in ('סגור', 'closed', 'בוטל', 'cancelled', 'canceled', 'נמחק', 'deleted') then
    raise exception 'scheduling_activity_not_open';
  end if;

  if normalized_language is not null and normalized_language not in ('he', 'ar') then
    raise exception 'invalid_instruction_language';
  end if;
  if normalized_gender not in ('any', 'female', 'male') then
    raise exception 'invalid_instructor_gender';
  end if;
  if normalized_education is null or normalized_education not in ('elementary', 'middle_school', 'high_school') then
    raise exception 'invalid_education_level';
  end if;

  update public.activities
  set instruction_language = normalized_language,
      required_instructor_gender = normalized_gender,
      education_level = normalized_education
  where row_id = p_activity_id
  returning * into result;

  return result;
end;
$$;

revoke all on function public.save_activity_scheduling_requirements(text, text, text, text) from public;
grant execute on function public.save_activity_scheduling_requirements(text, text, text, text) to authenticated;
