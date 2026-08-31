update public.users u
set permissions = coalesce(u.permissions, '{}'::jsonb) || jsonb_build_object(
  'access_attendance_reporting', 'yes',
  'view_dashboard', 'yes',
  'access_password_recovery', 'yes'
),
updated_at = now()
where u.role = 'instructor'
  and u.is_active = true
  and btrim(coalesce(u.emp_id, '')) <> '1519'
  and exists (
    select 1
    from public.contacts_instructors ci
    where ci.emp_id::text = btrim(coalesce(u.emp_id, ''))
      and lower(btrim(coalesce(ci.active, ''))) = 'yes'
  );

update public.users u
set permissions = coalesce(u.permissions, '{}'::jsonb) || jsonb_build_object(
  'access_attendance_reporting', 'no',
  'view_dashboard', 'no',
  'access_password_recovery', 'no'
),
updated_at = now()
where u.role = 'instructor'
  and u.is_active = true
  and btrim(coalesce(u.emp_id, '')) = '1519';
