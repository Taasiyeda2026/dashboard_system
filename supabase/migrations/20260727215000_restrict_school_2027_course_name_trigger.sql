-- This function is invoked only by the activities table trigger and must not be exposed as an RPC.
revoke all on function public.normalize_school_2027_activity_course_short_name() from public;
revoke all on function public.normalize_school_2027_activity_course_short_name() from anon;
revoke all on function public.normalize_school_2027_activity_course_short_name() from authenticated;
revoke all on function public.normalize_school_2027_activity_course_short_name() from service_role;
