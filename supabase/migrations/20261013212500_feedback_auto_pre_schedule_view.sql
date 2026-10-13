
-- Admin-only schedule visibility in the existing "מדריכים" feedback tab.
create or replace function public.feedback_auto_admin_pre_schedules(
  p_academic_year text default 'school_2027'
)
returns table(instructor_emp_id text, program_key text, academic_year text,
send_at timestamptz, status text, delivery_status text)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode='42501'; end if;
 return query
 select r.instructor_emp_id,r.program_key,r.academic_year,r.send_at,r.status,
   (select d.status from public.feedback_auto_delivery d
     where d.delivery_key='instructor:pre:'||r.program_key||':'||r.instructor_emp_id
     limit 1)
 from public.feedback_auto_pre_requests r
 where r.academic_year=p_academic_year
 order by r.send_at,r.instructor_emp_id;
end $$;
revoke all on function public.feedback_auto_admin_pre_schedules(text) from public,anon;
grant execute on function public.feedback_auto_admin_pre_schedules(text) to authenticated;

-- The admin may cancel a not-yet-attempted instructor PRE invitation.
create or replace function public.feedback_auto_cancel_instructor_pre(
 p_instructor_emp_id text,p_program_key text,p_academic_year text default 'school_2027'
) returns boolean language plpgsql security definer set search_path=''
as $$
declare v_count int;
begin
 if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode='42501'; end if;
 if exists(
   select 1 from public.feedback_auto_delivery d
   where d.delivery_key='instructor:pre:'||p_program_key||':'||p_instructor_emp_id
    and d.status in ('claimed','sending','accepted','unknown')
 ) then raise exception 'feedback_already_sending'; end if;
 update public.feedback_auto_pre_requests
 set status='cancelled',updated_at=now()
 where instructor_emp_id=p_instructor_emp_id and program_key=p_program_key
   and academic_year=p_academic_year and status='scheduled';
 get diagnostics v_count=row_count;
 update public.feedback_auto_delivery d
 set status='cancelled',updated_at=now()
 where d.delivery_key='instructor:pre:'||p_program_key||':'||p_instructor_emp_id
   and d.status in ('pending','needs_attention','invalidated') and d.graph_started_at is null;
 return v_count>0;
end $$;
revoke all on function public.feedback_auto_cancel_instructor_pre(text,text,text) from public,anon;
grant execute on function public.feedback_auto_cancel_instructor_pre(text,text,text) to authenticated;

notify pgrst,'reload schema';
