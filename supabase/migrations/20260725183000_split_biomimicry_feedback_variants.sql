-- Split the biomimicry escape room into feedback-only physical and digital variants.
-- Only Hila Rosen, Efrat Ohayon and Carmit Smandrov receive both variants.
-- The physical rows use activity_count=0 because the historical source does not split counts by format.
-- Existing combined counts remain on the digital row so total activations stay unchanged.

alter table public.summer_feedback_assignments
  drop constraint if exists summer_feedback_assignments_activity_count_check;

alter table public.summer_feedback_assignments
  add constraint summer_feedback_assignments_activity_count_check
  check (activity_count >= 0);

do $$
declare
  v_cycle_id uuid;
begin
  select id into v_cycle_id
  from public.summer_feedback_cycles
  where cycle_key = 'summer_2026';

  if v_cycle_id is null then
    raise exception 'summer_2026 feedback cycle not found';
  end if;

  update public.summer_feedback_assignments
  set activity_name = 'עולם הביומימיקרי הקסום (דיגיטלי)',
      activity_key = md5('עולם הביומימיקרי הקסום (דיגיטלי)'),
      source_note = concat_ws(' | ', nullif(source_note, ''), 'feedback variant: digital; combined count retained where physical/digital split is unknown')
  where cycle_id = v_cycle_id
    and activity_name in ('עולם הביומימיקרי הקסום', 'עולם הביומימיקרי הקסום (דיגיטלי)');

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
    a.cycle_id,
    a.instructor_auth_user_id,
    a.instructor_emp_id,
    a.instructor_name,
    md5('עולם הביומימיקרי הקסום (פיזי)'),
    'עולם הביומימיקרי הקסום (פיזי)',
    a.activity_type,
    0,
    a.grade_labels,
    'feedback-only variant; activation count is included once in the paired digital row because the split is unknown'
  from public.summer_feedback_assignments a
  where a.cycle_id = v_cycle_id
    and a.activity_name = 'עולם הביומימיקרי הקסום (דיגיטלי)'
    and a.instructor_name in ('הילה רוזן', 'אפרת אוחיון', 'כרמית סמנדרוב')
  on conflict (cycle_id, instructor_auth_user_id, activity_key)
  do update set
    activity_name = excluded.activity_name,
    activity_type = excluded.activity_type,
    activity_count = 0,
    grade_labels = excluded.grade_labels,
    source_note = excluded.source_note;
end $$;

notify pgrst, 'reload schema';
