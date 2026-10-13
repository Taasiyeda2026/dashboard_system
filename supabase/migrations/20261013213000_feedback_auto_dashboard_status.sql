
-- Read-only delivery overview inside existing "משובים" admin/authorized viewer pages.
create or replace function public.feedback_auto_dashboard_status()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
 if not private.feedback_can_view() then raise exception 'feedback_forbidden' using errcode='42501'; end if;
 return jsonb_build_object(
   'enabled',coalesce((select enabled from public.feedback_auto_control where singleton),false),
   'daily_mapping','05:30',
   'daily_dispatch','09:15',
   'student_opening','after_completed_lesson_one',
   'student_closing','after_completed_third_last_lesson',
   'instructor_final','day_after_last_end_by_half',
   'instructor_training','admin_scheduled',
   'delivery_counts',coalesce(
     (select jsonb_agg(jsonb_build_object(
       'audience',x.audience,'stage',x.stage,'status',x.status,'count',x.n))
      from (select audience,stage,status,count(*)::integer n
            from public.feedback_auto_delivery
            group by audience,stage,status
            order by audience,stage,status) x),
     '[]'::jsonb)
 );
end $$;
revoke all on function public.feedback_auto_dashboard_status() from public,anon;
grant execute on function public.feedback_auto_dashboard_status() to authenticated,service_role;
notify pgrst,'reload schema';
