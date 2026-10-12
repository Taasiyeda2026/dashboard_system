-- Follow-up correction for the initial production rollout; regular expressions must use portable [0-9] classes.
CREATE OR REPLACE FUNCTION public.feedback_admin_open_campaign(p_activity_row_id text, p_audience text, p_stage text, p_opens_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_age_band text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a jsonb;
  v_existing uuid;
  v_program text;
  v_version uuid;
  v_campaign uuid;
  v_contact_id bigint;
  v_contact jsonb;
  v_instructor jsonb;
  v_emp text;
  v_name text;
  v_phone text;
  v_email text;
  v_age text;
  v_excluded boolean;
  v_opens timestamptz := coalesce(p_opens_at, now());
begin
  if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
  if p_audience not in ('student', 'educational_staff', 'instructor') then raise exception 'feedback_invalid_audience'; end if;
  if (p_audience = 'student' and p_stage not in ('pre', 'post'))
    or (p_audience = 'educational_staff' and p_stage not in ('pre', 'final'))
    or (p_audience = 'instructor' and p_stage <> 'final') then
    raise exception 'feedback_invalid_stage';
  end if;
  if p_expires_at is not null and p_expires_at <= v_opens then raise exception 'feedback_invalid_window'; end if;

  select to_jsonb(x) into a from public.activities x where x.row_id = p_activity_row_id;
  if a is null then raise exception 'feedback_activity_not_found'; end if;
  -- Use actual scheduled course dates; a planned end date is not required for staff opening.
  if p_audience = 'educational_staff' and (
    coalesce(a->>'start_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' or
    (p_stage = 'final' and coalesce(a->>'end_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')
  ) then
    raise exception 'feedback_staff_stage_date_missing' using errcode = '22023';
  end if;

  select id into v_existing from public.feedback_campaigns
  where activity_row_id = p_activity_row_id and audience = p_audience and stage = p_stage;
  if v_existing is not null then
    return private.feedback_campaign_json(v_existing);
  end if;

  select r.program_key, r.excluded into v_program, v_excluded from private.feedback_activity_program(a) r;
  if coalesce(v_excluded, false) then raise exception 'feedback_activity_excluded'; end if;
  if v_program is null or not exists (select 1 from public.feedback_programs where key = v_program) then
    raise exception 'feedback_program_unresolved';
  end if;

  select t.current_version_id into v_version from public.feedback_templates t
  where t.program_key = v_program and t.audience = p_audience and t.stage = p_stage;
  if v_version is null then raise exception 'feedback_template_not_published'; end if;

  v_age := coalesce(
    nullif(p_age_band, ''),
    private.feedback_age_band(a->>'grade'),
    (select default_age_band from public.feedback_programs where key = v_program)
  );
  if v_age is not null and v_age not in ('a_c', 'd_f', 'g_i', 'j_l') then raise exception 'feedback_invalid_age_band'; end if;

  v_contact_id := case when coalesce(a->>'school_contact_id', '') ~ '^[0-9]+$' then (a->>'school_contact_id')::bigint end;
  if v_contact_id is not null then
    select to_jsonb(cs) into v_contact from public.contacts_schools cs where cs.id = v_contact_id;
    if v_contact is null then v_contact_id := null; end if;
  end if;
  v_emp := nullif(btrim(coalesce(a->>'emp_id', '')), '');
  if v_emp is not null then
    select to_jsonb(ci) into v_instructor from public.contacts_instructors ci where ci.emp_id::text = v_emp;
  end if;

  insert into public.feedback_campaigns (
    activity_row_id, program_key, template_version_id, audience, stage, age_band, academic_year,
    activity_name, school_id, school_name, authority_id, authority_name, grade, class_group,
    instructor_emp_id, instructor_name, contact_id, contact_name,
    activity_start_date, activity_end_date, public_token, opens_at, expires_at, created_by
  ) values (
    p_activity_row_id, v_program, v_version, p_audience, p_stage, v_age, coalesce(nullif(a->>'activity_season', ''), 'regular'),
    coalesce(a->>'activity_name', ''),
    case when coalesce(a->>'school_id', '') ~ '^[0-9]+$' then (a->>'school_id')::bigint end,
    coalesce(a->>'school', ''),
    case when coalesce(a->>'authority_id', '') ~ '^[0-9]+$' then (a->>'authority_id')::bigint end,
    coalesce(a->>'authority', ''),
    coalesce(a->>'grade', ''), coalesce(a->>'class_group', ''),
    v_emp, coalesce(nullif(v_instructor->>'full_name', ''), a->>'instructor_name', ''),
    v_contact_id, coalesce(nullif(v_contact->>'contact_name', ''), a->>'contact_name', ''),
    case when coalesce(a->>'start_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(a->>'start_date', 10)::date end,
    case when coalesce(a->>'end_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(a->>'end_date', 10)::date end,
    case when p_audience = 'student' then private.feedback_new_token() end,
    v_opens, p_expires_at, auth.uid()
  )
  returning id into v_campaign;

  if p_audience = 'educational_staff' then
    v_name := coalesce(nullif(btrim(v_contact->>'contact_name'), ''), nullif(btrim(a->>'contact_name'), ''));
    v_phone := coalesce(nullif(btrim(v_contact->>'mobile'), ''), nullif(btrim(v_contact->>'phone'), ''), nullif(btrim(a->>'contact_phone'), ''), '');
    v_email := coalesce(nullif(btrim(v_contact->>'email'), ''), nullif(btrim(a->>'contact_email'), ''), '');
    if v_name is null and v_phone = '' and v_email = '' then
      raise exception 'feedback_contact_missing';
    end if;
    insert into public.feedback_recipients (campaign_id, recipient_type, contact_id, display_name, phone, email, token)
    values (v_campaign, 'educational_staff', v_contact_id, coalesce(v_name, ''), v_phone, v_email, private.feedback_new_token());
  elsif p_audience = 'instructor' then
    v_name := coalesce(nullif(btrim(v_instructor->>'full_name'), ''), nullif(btrim(a->>'instructor_name'), ''));
    if v_name is null and v_emp is null then
      raise exception 'feedback_instructor_missing';
    end if;
    insert into public.feedback_recipients (campaign_id, recipient_type, instructor_emp_id, display_name, phone, email, token)
    values (v_campaign, 'instructor', v_emp, coalesce(v_name, ''),
      coalesce(nullif(btrim(v_instructor->>'mobile'), ''), ''), coalesce(nullif(btrim(v_instructor->>'email'), ''), ''),
      private.feedback_new_token());
  end if;

  return private.feedback_campaign_json(v_campaign);
end $function$
;
