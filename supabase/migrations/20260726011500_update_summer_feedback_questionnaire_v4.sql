alter table public.summer_feedback_activity_ratings
  add column if not exists delivery_experience text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'summer_feedback_delivery_experience_allowed'
      and conrelid = 'public.summer_feedback_activity_ratings'::regclass
  ) then
    alter table public.summer_feedback_activity_ratings
      add constraint summer_feedback_delivery_experience_allowed
      check (
        delivery_experience <@ array[
          'קלה להעברה',
          'נעימה ומהנה',
          'עמוסה',
          'מורכבת או מסורבלת',
          'דרשה ממני לבצע התאמות במהלך ההדרכה',
          'מתאימה להעברה כפי שהיא'
        ]::text[]
      );
  end if;
end
$$;

update public.summer_feedback_cycles
set question_version = 4,
    updated_at = now()
where cycle_key = 'summer_2026';

notify pgrst, 'reload schema';
