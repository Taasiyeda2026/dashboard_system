-- Refine the summer feedback scope and questionnaire presentation.
-- Tamir activities took place during the summer period but are not part of the
-- STEM, space and escape-room summer workshop feedback.

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

  if exists (
    select 1
    from public.summer_feedback_responses
    where cycle_id = v_cycle_id
  ) then
    raise exception 'summer feedback responses already exist; Tamir assignments were not removed';
  end if;

  delete from public.summer_feedback_assignments
  where cycle_id = v_cycle_id
    and activity_name in (
      'תמיר - חדר בריחה קווסט',
      'תמיר - המחזור מתחיל בבית'
    );

  update public.summer_feedback_cycles
  set question_version = 3,
      status = 'draft',
      opens_at = null,
      closes_at = null,
      updated_at = now()
  where id = v_cycle_id;
end $$;
