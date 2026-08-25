-- Instructor onboarding is permission-gated by manage_instructor_onboarding.
-- Run the atomic onboarding RPC as the function owner so its internal insert into
-- instructor_scheduling_profiles is not blocked by the table's stricter scheduling RLS.
-- Direct writes to instructor_scheduling_profiles remain limited by the existing RLS policies.

alter function public.create_instructor_onboarding(text, text, text, text, text, text)
  security definer;

alter function public.create_instructor_onboarding(text, text, text, text, text, text)
  set search_path = public;

revoke all on function public.create_instructor_onboarding(text, text, text, text, text, text) from public, anon;
grant execute on function public.create_instructor_onboarding(text, text, text, text, text, text) to authenticated;

comment on function public.create_instructor_onboarding(text, text, text, text, text, text) is
'Atomic instructor onboarding. Access is explicitly gated inside the function by manage_instructor_onboarding; SECURITY DEFINER allows the required internal scheduling-profile insert without granting broader scheduling-table write access.';
