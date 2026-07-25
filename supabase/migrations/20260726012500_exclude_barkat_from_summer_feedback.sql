-- Exclude Barkat Katai from the Summer 2026 instructor feedback requirement.
-- She delivered only three workshops and should not receive the dashboard card.
with target as (
  select a.id
  from public.summer_feedback_assignments a
  join public.summer_feedback_cycles c on c.id = a.cycle_id
  where c.cycle_key = 'summer_2026'
    and a.instructor_emp_id = '1515'
    and a.instructor_name = 'ברקת קטעי'
)
delete from public.summer_feedback_assignments a
using target t
where a.id = t.id;
