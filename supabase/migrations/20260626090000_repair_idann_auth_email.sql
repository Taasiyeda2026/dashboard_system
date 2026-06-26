-- Re-apply the idann auth_email repair after PR #820 so Supabase Auth email
-- and public.users.auth_email agree for the existing admin profile.
-- Intentionally only changes auth_email; the WHERE clause pins the existing
-- idann row and protects user_id, username, role, and auth_user_id.
update public.users
set auth_email = 'idann@think.org.il'
where username = 'idann'
  and user_id = '8000'
  and role = 'admin'
  and is_active = true
  and auth_user_id = 'e9ca304a-4e66-4774-830e-14f1318c4908'
  and auth_email is distinct from 'idann@think.org.il';
