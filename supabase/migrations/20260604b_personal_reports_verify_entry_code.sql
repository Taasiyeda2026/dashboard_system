-- Dedicated second-factor verification for the Personal Reports screen.
-- Unlike login_user_by_entry_code (which is a general login RPC), this function
-- is designed for an ALREADY-AUTHENTICATED user: it receives the email of the
-- logged-in session and verifies that the supplied entry_code belongs to that
-- exact user record — no fallback to user_id / emp_id lookups.

drop function if exists public.verify_personal_reports_entry_code(text, text);

create function public.verify_personal_reports_entry_code(
  p_email      text,   -- email of the already-authenticated dashboard user
  p_entry_code text    -- code typed on the Personal Reports lock screen
)
returns table (
  verify_status text,   -- 'ok' | 'user_not_found' | 'inactive_user' | 'entry_code_mismatch' | 'invalid_input'
  email         text,
  name          text,
  role          text,
  emp_id        text
)
language sql
security definer
set search_path = public
as $$
  with input as (
    select
      lower(trim(coalesce(p_email, '')))      as email,
      trim(coalesce(p_entry_code, ''))        as code
  ),
  -- Require a real email (must contain @) so internal IDs cannot be passed.
  guard as (
    select
      case
        when (select i.email from input i) = ''           then 'invalid_input'
        when (select i.code  from input i) = ''           then 'invalid_input'
        when position('@' in (select i.email from input i)) = 0 then 'invalid_input'
        else 'pass'
      end as result
  ),
  candidate as (
    select u.*
    from public.users u
    cross join input i
    where lower(trim(u.email)) = i.email   -- email-only lookup, no user_id/emp_id fallback
    limit 1
  ),
  diagnostic as (
    select
      case
        when (select g.result from guard g) <> 'pass'           then (select g.result from guard g)
        when not exists (select 1 from candidate)               then 'user_not_found'
        when not (select c.is_active from candidate c)          then 'inactive_user'
        when trim(coalesce((select c.entry_code from candidate c), ''))
             <> (select i.code from input i)                    then 'entry_code_mismatch'
        else 'ok'
      end as status
  )
  select
    d.status                                            as verify_status,
    case when d.status = 'ok' then c.email  end         as email,
    case when d.status = 'ok' then c.name   end         as name,
    case when d.status = 'ok' then c.role   end         as role,
    case when d.status = 'ok' then c.emp_id end         as emp_id
  from diagnostic d
  left join candidate c on true;
$$;

-- Only authenticated users (already signed-in dashboard sessions) may call this.
revoke all on function public.verify_personal_reports_entry_code(text, text) from public;
grant execute on function public.verify_personal_reports_entry_code(text, text) to authenticated;
