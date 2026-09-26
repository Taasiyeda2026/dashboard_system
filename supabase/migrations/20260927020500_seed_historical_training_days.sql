insert into public.instructor_training_schedule (
  emp_id, participant_scope, training_date, activity_type, course_id, course_name,
  start_time, end_time, is_online, location_name, notes
)
select null, 'open', d.training_date, 'הכשרה', null, 'הכשרת בסיס',
       d.start_time, d.end_time, false, null, 'הכשרה היסטורית; משתתפים פתוחים'
from (
  values
    (date '2026-09-15', time '10:00', time '15:00'),
    (date '2026-09-16', time '10:00', time '14:00'),
    (date '2026-09-17', time '10:00', time '14:00')
) as d(training_date, start_time, end_time)
where not exists (
  select 1
  from public.instructor_training_schedule t
  where t.is_active = true
    and t.emp_id is null
    and t.participant_scope = 'open'
    and t.training_date = d.training_date
    and lower(btrim(t.course_name)) = lower(btrim('הכשרת בסיס'))
    and t.start_time = d.start_time
    and t.end_time = d.end_time
);

insert into public.instructor_training_schedule (
  emp_id, participant_scope, training_date, activity_type, course_id, course_name,
  start_time, end_time, is_online, location_name, notes
)
select null, 'open', date '2026-09-24', 'הכשרה', c.id, c.short_name,
       time '10:00', time '12:30', true, 'Zoom', 'הכשרה היסטורית; משתתפים פתוחים'
from public.proposal_gefen_courses c
where c.is_active = true
  and c.short_name = 'פורצות דרך'
  and not exists (
    select 1
    from public.instructor_training_schedule t
    where t.is_active = true
      and t.emp_id is null
      and t.participant_scope = 'open'
      and t.training_date = date '2026-09-24'
      and lower(btrim(t.course_name)) = lower(btrim(c.short_name))
      and t.start_time = time '10:00'
      and t.end_time = time '12:30'
  )
limit 1;
