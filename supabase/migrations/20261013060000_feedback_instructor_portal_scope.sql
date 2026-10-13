-- Existing impact-feedback module: narrowly scoped instructor read access.
-- Do not widen the admin RPCs, table SELECT policies, or Israa's permissions.
-- Public form submission and questionnaire templates remain unchanged.
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
        'token', c.public_token
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

-- Do not grant direct access to campaigns, recipients or responses.
notify pgrst, 'reload schema';
