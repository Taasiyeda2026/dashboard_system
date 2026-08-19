-- Gender becomes a required, atomic part of instructor onboarding, saved straight into the
-- canonical instructor_scheduling_profiles.gender ('male'/'female' — no new column/table, no Hebrew
-- text stored). This is what every police-clearance check (employee file, manager board, SharePoint
-- folder provisioning) already reads, so onboarding no longer leaves gender to be set later/manually.

-- Replace the 5-arg signature entirely so the old, gender-less overload can no longer be called.
drop function if exists public.create_instructor_onboarding(text, text, text, text, text);

create or replace function public.create_instructor_onboarding(
  p_full_name text,
  p_mobile text,
  p_email text,
  p_employment_type text,
  p_direct_manager text,
  p_gender text
)
returns table (emp_id bigint, full_name text, already_exists boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing public.contacts_instructors%rowtype;
  v_emp_id bigint;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := regexp_replace(coalesce(p_mobile, ''), '[^0-9+]', '', 'g');
  v_employment_type text := trim(coalesce(p_employment_type, ''));
  v_gender text := trim(coalesce(p_gender, ''));
begin
  if not public.app_has_permission('view_employee_files') then
    raise exception 'permission_denied:view_employee_files' using errcode = '42501';
  end if;

  if trim(coalesce(p_full_name, '')) = '' or v_phone = '' or v_email = ''
     or trim(coalesce(p_direct_manager, '')) = '' then
    raise exception 'onboarding_required_fields_missing';
  end if;

  if v_gender not in ('male', 'female') then
    raise exception 'onboarding_gender_invalid' using errcode = '22023';
  end if;

  if v_employment_type = '' then
    v_employment_type := 'עצמאי';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'onboarding_invalid_email';
  end if;

  perform pg_advisory_xact_lock(hashtext('contacts_instructors:onboarding'));

  select ci.* into v_existing
  from public.contacts_instructors ci
  where lower(trim(coalesce(ci.email, ''))) = v_email
     or regexp_replace(coalesce(ci.mobile, ''), '[^0-9+]', '', 'g') = v_phone
  order by ci.emp_id
  limit 1;

  if found then
    -- Duplicate: never touch an existing instructor's gender from a retried/duplicate onboarding attempt.
    return query select v_existing.emp_id::bigint, v_existing.full_name::text, true;
    return;
  end if;

  select coalesce(max(ci.emp_id::bigint), 0) + 1 into v_emp_id
  from public.contacts_instructors ci;

  insert into public.contacts_instructors
    (emp_id, full_name, mobile, email, employment_type, direct_manager, active)
  values
    (v_emp_id, trim(p_full_name), trim(p_mobile), trim(p_email), v_employment_type, trim(p_direct_manager), 'yes');

  insert into public.instructor_scheduling_profiles (emp_id, gender)
  values (v_emp_id, v_gender)
  on conflict (emp_id) do update set gender = excluded.gender;

  return query select v_emp_id, trim(p_full_name), false;
end;
$$;

revoke execute on function public.create_instructor_onboarding(text, text, text, text, text, text) from public;
revoke execute on function public.create_instructor_onboarding(text, text, text, text, text, text) from anon;
grant execute on function public.create_instructor_onboarding(text, text, text, text, text, text) to authenticated;

comment on function public.create_instructor_onboarding(text, text, text, text, text, text) is 'Atomic instructor onboarding: creates contacts_instructors and sets instructor_scheduling_profiles.gender (male/female, required) in the same call; duplicates are returned as-is without touching an existing instructor gender.';
