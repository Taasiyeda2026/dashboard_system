-- Atomic instructor onboarding: duplicate protection and server-owned employee IDs.
create or replace function public.create_instructor_onboarding(
  p_full_name text,
  p_mobile text,
  p_email text,
  p_employment_type text,
  p_direct_manager text
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
begin
  if trim(coalesce(p_full_name, '')) = '' or v_phone = '' or v_email = ''
     or trim(coalesce(p_employment_type, '')) = '' or trim(coalesce(p_direct_manager, '')) = '' then
    raise exception 'onboarding_required_fields_missing';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'onboarding_invalid_email';
  end if;

  -- One transaction-wide lock makes both duplicate detection and MAX+1 allocation safe
  -- when several employees onboard instructors concurrently.
  perform pg_advisory_xact_lock(hashtext('contacts_instructors:onboarding'));

  select ci.* into v_existing
  from public.contacts_instructors ci
  where lower(trim(coalesce(ci.email, ''))) = v_email
     or regexp_replace(coalesce(ci.mobile, ''), '[^0-9+]', '', 'g') = v_phone
  order by ci.emp_id
  limit 1;

  if found then
    return query select v_existing.emp_id::bigint, v_existing.full_name::text, true;
    return;
  end if;

  select coalesce(max(ci.emp_id::bigint), 0) + 1 into v_emp_id
  from public.contacts_instructors ci;

  insert into public.contacts_instructors
    (emp_id, full_name, mobile, email, employment_type, direct_manager, active)
  values
    (v_emp_id, trim(p_full_name), trim(p_mobile), trim(p_email), trim(p_employment_type), trim(p_direct_manager), 'yes');

  return query select v_emp_id, trim(p_full_name), false;
end;
$$;

grant execute on function public.create_instructor_onboarding(text, text, text, text, text) to authenticated;

insert into public.settings (key, value, description)
values (
  'activity_manager_contacts',
  '[{"name":"גיל נאמן","phone":"052-4506699","email":"GilNeeman@think.org.il"},{"name":"הילה רוזן","phone":"052-3222951","email":"HilaR@think.org.il"}]',
  'Approved activity-manager contact details for instructor onboarding'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description;
