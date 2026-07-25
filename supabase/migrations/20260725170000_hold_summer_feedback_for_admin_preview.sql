-- Keep the summer feedback unavailable to instructors until final approval.
update public.summer_feedback_cycles
set status='draft', opens_at=null, closes_at=null, updated_at=now()
where cycle_key='summer_2026';
