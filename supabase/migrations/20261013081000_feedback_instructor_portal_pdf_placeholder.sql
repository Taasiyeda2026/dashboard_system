-- Preserve the instructor-scoped data source and expose a boolean to render disabled
-- PDF controls for elementary campaigns without an uploaded file.
-- Neither admin file ownership nor mail scheduling is changed.

create or replace function public.feedback_instructor_portal_items(
  p_academic_year text default 'school_2027'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_emp_id text;
begin
  -- Match the Supabase authenticated identity, not caller-supplied employee ids.
  select nullif(btrim(u.emp_id), '') into v_emp_id
  from public.users u
  where u.auth_user_id = (select auth.uid())
    and u.role = 'instructor'
    and u.is_active is true
  limit 1;

  if v_emp_id is null then
    raise exception 'feedback_forbidden' using errcode = '42501';
  end if;
  if p_academic_year is null or p_academic_year not in ('school_2027') then
    raise exception 'feedback_invalid_academic_year' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'students',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'campaign_id', c.id,
        'stage', c.stage,
        'program_title', p.title,
        'school_name', c.school_name,
        'authority_name', c.authority_name,
        'class_name', coalesce(nullif(c.class_group, ''), nullif(c.grade, ''), ''),
        'token', c.public_token,
        -- The next valid course meeting still in the future, Israel local time.
        -- Read the activity schedule directly; do not store a second date.
        'due_date', (
          select min(m.meeting_date)::text
          from (
            select nullif(to_jsonb(a)->>('date_' || n.slot), '')::date as meeting_date
            from generate_series(1, 35) as n(slot)
          ) m
          where m.meeting_date is not null
            and (m.meeting_date + coalesce(
              public.scheduling_effective_end_time(a.row_id, m.meeting_date, a.end_time),
              a.end_time,
              time '23:59:59'
            )) > (now() at time zone 'Asia/Jerusalem')
            and not exists (
              select 1 from public.course_meeting_cancellations cancel
              where cancel.activity_id = a.row_id and cancel.meeting_date = m.meeting_date
            )
        ),
        'paper_pdf_supported', (p.education_level = 'elementary'),
        'paper_pdfs', case when p.education_level = 'elementary' then coalesce((
          select jsonb_agg(jsonb_build_object(
            'language', fp.language, 'storage_path', fp.storage_path, 'file_name', fp.file_name
          ) order by fp.language desc)
          from public.feedback_templates t
          join public.feedback_template_pdfs fp on fp.template_id = t.id
          where t.program_key = c.program_key
            and t.audience = 'student' and t.stage = c.stage
            and t.current_version_id = fp.version_id
            and c.template_version_id = fp.version_id
        ), '[]'::jsonb) else '[]'::jsonb end
      ) order by c.school_name, c.program_key, c.stage, c.id)
      from public.feedback_campaigns c
      join public.activities a on a.row_id = c.activity_row_id
      join public.feedback_programs p on p.key = c.program_key
      where c.audience = 'student'
        and c.stage in ('pre', 'post')
        and c.academic_year = p_academic_year
        and c.status = 'active'
        and c.opens_at <= now()
        and (c.expires_at is null or c.expires_at > now())
        and c.public_token is not null
        and (a.emp_id::text = v_emp_id or a.emp_id_2 = v_emp_id)
    ), '[]'::jsonb),
    'personal',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'campaign_id', c.id,
        'stage', c.stage,
        'program_title', p.title,
        'completed', (r.status = 'completed' or r.completed_at is not null),
        'expires_at', c.expires_at,
        'token', case
          when c.status = 'active'
           and (c.expires_at is null or c.expires_at > now())
           and coalesce(r.status, '') <> 'completed'
           and r.completed_at is null
          then r.token else null
        end
      ) order by p.title, c.stage, c.id)
      from public.feedback_campaigns c
      join public.feedback_recipients r
        on r.campaign_id = c.id
       and r.instructor_emp_id = v_emp_id
       and r.recipient_type = 'instructor'
      join public.feedback_programs p on p.key = c.program_key
      where c.audience = 'instructor'
        and c.stage in ('pre', 'final', 'final_b')
        and c.academic_year = p_academic_year
        and c.instructor_emp_id = v_emp_id
        and c.opens_at <= now()
    ), '[]'::jsonb)
  );
end;
$function$;



revoke all on function public.feedback_instructor_portal_items(text) from public, anon;
grant execute on function public.feedback_instructor_portal_items(text) to authenticated;
notify pgrst, 'reload schema';
