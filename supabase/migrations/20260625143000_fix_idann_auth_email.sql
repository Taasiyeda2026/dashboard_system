-- Align idann's public.users auth email with the Supabase Auth account email.
-- Do not change user_id, username, role, or auth_user_id.
update public.users
set auth_email = 'idann@think.org.il'
where username = 'idann'
  and user_id = '8000'
  and auth_user_id = 'e9ca304a-4e66-4774-830e-14f1318c4908';
