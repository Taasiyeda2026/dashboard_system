-- Historical base-training rows were seeded without a display location even
-- though their trusted travel destination has always been Greenwork in Yakum.
-- Backfill the schedule source so attendance selection/editing shows the same
-- destination that is used for travel calculation.
update public.instructor_training_schedule
set location_name = 'Greenwork, יקום',
    location_address = '6RVR+XM, יקום',
    updated_at = now()
where is_online = false
  and btrim(course_name) = 'הכשרת בסיס'
  and training_date in (date '2026-09-15', date '2026-09-16', date '2026-09-17')
  and (
    nullif(btrim(coalesce(location_name, '')), '') is null
    or nullif(btrim(coalesce(location_address, '')), '') is null
  );
