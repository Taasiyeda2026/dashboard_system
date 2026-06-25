-- Seed initial instructor logins by employee number without overwriting existing usernames.
-- Temporary passwords follow the existing auth migration mechanism: public.users.entry_code.

with instructor_seed(user_id, full_name) as (
  values
    ('1525', 'אייל יוחאי'),
    ('1527', 'איתמר יוחאי'),
    ('1502', 'אלדר מיכאל טייב'),
    ('1507', 'אלכס זפקה'),
    ('1509', 'אפרת אוחיון'),
    ('1500', 'הילה רוזן'),
    ('1503', 'הנאא אבו אמזה'),
    ('1511', 'כרמית סמנדרוב')
)
insert into public.users (
  user_id,
  username,
  name,
  full_name,
  role,
  display_role,
  emp_id,
  entry_code,
  auth_email,
  is_active
)
select
  s.user_id,
  s.user_id,
  s.full_name,
  s.full_name,
  'instructor',
  'instructor',
  s.user_id,
  s.user_id,
  lower(s.user_id || '@think.org.il'),
  true
from instructor_seed s
on conflict (user_id) do update set
  username = coalesce(nullif(public.users.username, ''), excluded.username),
  name = coalesce(nullif(public.users.name, ''), excluded.name),
  full_name = coalesce(nullif(public.users.full_name, ''), excluded.full_name),
  role = case
    when public.users.role is null or btrim(public.users.role) = '' or public.users.role = 'authorized_user' then 'instructor'
    else public.users.role
  end,
  display_role = case
    when public.users.display_role is null or btrim(public.users.display_role) = '' or public.users.display_role = 'authorized_user' then 'instructor'
    else public.users.display_role
  end,
  emp_id = coalesce(nullif(public.users.emp_id, ''), excluded.emp_id),
  entry_code = coalesce(nullif(public.users.entry_code, ''), excluded.entry_code),
  auth_email = coalesce(nullif(public.users.auth_email, ''), excluded.auth_email),
  is_active = true;
