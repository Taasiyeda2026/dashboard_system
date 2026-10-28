-- One row per personal campaign. Instructor feedback is annual, not per school.
create or replace function private.feedback_expired_for_manager(
  p_manager_user_id text, p_now timestamptz default now()
) returns table (
 campaign_id uuid, audience text, stage text, program_title text,
 subject_name text, school_name text, expires_at timestamptz
) language sql stable security definer set search_path to ''
as $fn$
 select distinct on (c.id)
   c.id,c.audience,c.stage,coalesce(p.title,c.program_key),
   case when c.audience='instructor' then coalesce(nullif(c.instructor_name,''),'מדריך')
     else coalesce(nullif(c.contact_name,''),'צוות חינוכי') end,
   case when c.audience='instructor' then 'משוב שנתי'
     else coalesce(nullif(c.school_name,''),nullif(a.school,''),'—') end,
   c.expires_at
 from public.users u
 join public.activities a
   on lower(regexp_replace(btrim(a.activity_manager),'[[:space:]]+',' ','g')) =
      lower(regexp_replace(btrim(coalesce(nullif(u.full_name,''),nullif(u.name,''),u.username,'')),'[[:space:]]+',' ','g'))
 join public.feedback_campaigns c
   on c.academic_year=a.activity_season
   and (
     (c.audience='educational_staff' and c.activity_row_id=a.row_id)
     or (c.audience='instructor' and
       (a.emp_id::text=c.instructor_emp_id or a.emp_id_2=c.instructor_emp_id))
   )
 join public.feedback_programs p on p.key=c.program_key
 left join lateral (
   select mapping.program_key from private.feedback_activity_program(to_jsonb(a)) mapping limit 1
 ) mapped on true
 where u.user_id=p_manager_user_id and u.role='activities_manager' and u.is_active=true
   and a.start_date is not null and a.instructor_assignment_locked is true
   and (a.emp_id is not null or nullif(btrim(a.emp_id_2),'') is not null)
   and (c.audience='educational_staff' or mapped.program_key=c.program_key)
   and c.status='active' and c.expires_at is not null and c.expires_at<=p_now
   and not exists(select 1 from public.feedback_responses r where r.campaign_id=c.id)
   and not exists(select 1 from public.feedback_recipients rc
       where rc.campaign_id=c.id and (rc.status='completed' or rc.completed_at is not null))
 order by c.id;
$fn$;
revoke all on function private.feedback_expired_for_manager(text,timestamptz) from public,anon,authenticated;
