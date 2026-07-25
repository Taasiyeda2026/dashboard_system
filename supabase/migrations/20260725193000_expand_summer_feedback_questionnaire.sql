-- Expand the summer feedback questionnaire and rebuild feedback assignments from
-- the current authoritative summer report. Operational statuses are ignored for
-- inclusion: every non-deleted and non-cancelled row is treated as completed.

alter table public.summer_feedback_activity_ratings
  add column if not exists content_clarity smallint check (content_clarity between 1 and 5),
  add column if not exists delivery_ease smallint check (delivery_ease between 1 and 5),
  add column if not exists student_engagement smallint check (student_engagement between 1 and 5),
  add column if not exists overall_rating smallint check (overall_rating between 1 and 5);

do $$
declare
  v_cycle_id uuid;
  v_source_total integer;
  v_assignment_total integer;
  v_missing_users integer;
begin
  select id into v_cycle_id
  from public.summer_feedback_cycles
  where cycle_key = 'summer_2026';

  if v_cycle_id is null then
    raise exception 'summer_2026 feedback cycle not found';
  end if;

  if exists (
    select 1
    from public.summer_feedback_responses
    where cycle_id = v_cycle_id
  ) then
    raise exception 'summer feedback responses already exist; assignments were not rebuilt';
  end if;

  create temporary table tmp_summer_feedback_source on commit drop as
  with source_rows as (
    select
      trim(a.instructor_name) as instructor_name,
      nullif(a.emp_id::text, '') as instructor_emp_id,
      trim(a.activity_name) as source_activity_name,
      coalesce(nullif(trim(a.activity_type), ''), nullif(trim(a.item_type), ''), 'workshop') as activity_type,
      nullif(trim(a.grade), '') as grade_label
    from public.summer_2026_activities_with_contacts a
    where a.activity_season = 'summer_2026'
      and coalesce(trim(a.status), '') not in ('נמחק', 'בוטל')
      and nullif(trim(a.instructor_name), '') is not null
      and nullif(trim(a.activity_name), '') is not null

    union all

    select
      trim(a.instructor_name_2) as instructor_name,
      nullif(trim(a.emp_id_2), '') as instructor_emp_id,
      trim(a.activity_name) as source_activity_name,
      coalesce(nullif(trim(a.activity_type), ''), nullif(trim(a.item_type), ''), 'workshop') as activity_type,
      nullif(trim(a.grade), '') as grade_label
    from public.summer_2026_activities_with_contacts a
    where a.activity_season = 'summer_2026'
      and coalesce(trim(a.status), '') not in ('נמחק', 'בוטל')
      and nullif(trim(a.instructor_name_2), '') is not null
      and nullif(trim(a.activity_name), '') is not null
  ),
  normalized as (
    select
      s.instructor_name,
      s.instructor_emp_id,
      case
        when s.source_activity_name in (
          'עולם הביומימיקרי הקסום',
          'עולם הביומימיקרי הקסום (דיגיטלי)'
        ) then 'עולם הביומימיקרי הקסום (דיגיטלי)'
        else s.source_activity_name
      end as activity_name,
      s.activity_type,
      s.grade_label
    from source_rows s
  )
  select
    u.auth_user_id as instructor_auth_user_id,
    coalesce(nullif(u.emp_id, ''), n.instructor_emp_id) as instructor_emp_id,
    n.instructor_name,
    md5(n.activity_name) as activity_key,
    n.activity_name,
    max(n.activity_type) as activity_type,
    count(*)::integer as activity_count,
    coalesce(array_agg(distinct n.grade_label order by n.grade_label)
      filter (where n.grade_label is not null), '{}'::text[]) as grade_labels
  from normalized n
  left join public.users u
    on u.is_active = true
   and u.auth_user_id is not null
   and (
     (n.instructor_emp_id is not null and u.emp_id = n.instructor_emp_id)
     or u.full_name = n.instructor_name
   )
  group by u.auth_user_id, coalesce(nullif(u.emp_id, ''), n.instructor_emp_id), n.instructor_name, n.activity_name;

  select count(*) into v_missing_users
  from tmp_summer_feedback_source
  where instructor_auth_user_id is null;

  if v_missing_users <> 0 then
    raise exception '% feedback assignment groups have no authenticated user', v_missing_users;
  end if;

  select coalesce(sum(activity_count), 0) into v_source_total
  from tmp_summer_feedback_source;

  delete from public.summer_feedback_assignments
  where cycle_id = v_cycle_id;

  insert into public.summer_feedback_assignments (
    cycle_id,
    instructor_auth_user_id,
    instructor_emp_id,
    instructor_name,
    activity_key,
    activity_name,
    activity_type,
    activity_count,
    grade_labels,
    source_note
  )
  select
    v_cycle_id,
    instructor_auth_user_id,
    instructor_emp_id,
    instructor_name,
    activity_key,
    activity_name,
    activity_type,
    activity_count,
    grade_labels,
    'authoritative summer report; all non-deleted/non-cancelled rows treated as completed regardless of operational status'
  from tmp_summer_feedback_source;

  insert into public.summer_feedback_assignments (
    cycle_id,
    instructor_auth_user_id,
    instructor_emp_id,
    instructor_name,
    activity_key,
    activity_name,
    activity_type,
    activity_count,
    grade_labels,
    source_note
  )
  select
    d.cycle_id,
    d.instructor_auth_user_id,
    d.instructor_emp_id,
    d.instructor_name,
    md5('עולם הביומימיקרי הקסום (פיזי)'),
    'עולם הביומימיקרי הקסום (פיזי)',
    d.activity_type,
    0,
    d.grade_labels,
    'feedback-only physical variant; combined execution count is retained once on the paired digital row'
  from public.summer_feedback_assignments d
  where d.cycle_id = v_cycle_id
    and d.activity_name = 'עולם הביומימיקרי הקסום (דיגיטלי)'
    and d.instructor_name in ('הילה רוזן', 'אפרת אוחיון', 'כרמית סמנדרוב')
  on conflict (cycle_id, instructor_auth_user_id, activity_key)
  do update set
    activity_name = excluded.activity_name,
    activity_type = excluded.activity_type,
    activity_count = 0,
    grade_labels = excluded.grade_labels,
    source_note = excluded.source_note;

  select coalesce(sum(activity_count), 0) into v_assignment_total
  from public.summer_feedback_assignments
  where cycle_id = v_cycle_id;

  if v_assignment_total <> v_source_total then
    raise exception 'feedback activity total mismatch: source %, assignments %', v_source_total, v_assignment_total;
  end if;

  update public.summer_feedback_cycles
  set question_version = 2,
      status = 'draft',
      opens_at = null,
      closes_at = null,
      updated_at = now()
  where id = v_cycle_id;
end $$;

notify pgrst, 'reload schema';
