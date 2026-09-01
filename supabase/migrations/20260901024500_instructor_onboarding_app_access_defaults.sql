create or replace function private.grant_new_instructor_app_access_defaults()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if lower(coalesce(nullif(new.active, ''), 'yes')) in ('no', 'false', '0', 'inactive') then
    return new;
  end if;

  update public.users
     set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
       'view_dashboard', 'yes',
       'access_attendance_reporting', 'yes',
       'access_password_recovery', 'yes'
     ),
         updated_at = now()
   where user_id = new.emp_id::text
     and role = 'instructor';

  return new;
end;
$$;

revoke all on function private.grant_new_instructor_app_access_defaults() from public, anon, authenticated;

drop trigger if exists zz_grant_new_instructor_app_access_defaults on public.contacts_instructors;
create trigger zz_grant_new_instructor_app_access_defaults
after insert on public.contacts_instructors
for each row execute function private.grant_new_instructor_app_access_defaults();

comment on function private.grant_new_instructor_app_access_defaults() is
'New active instructor onboarding receives dashboard, attendance and password-recovery permissions immediately after the canonical users row is created.';
