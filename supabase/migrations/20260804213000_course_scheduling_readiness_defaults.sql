-- Safe data-only default backfill for school_2027 open course scheduling requirements.
-- Course and legacy program activity_type values are operationally courses for scheduling.

update public.activities
set instruction_language = 'he'
where activity_season = 'school_2027'
  and lower(trim(coalesce(activity_type, ''))) in ('קורס', 'course', 'program')
  and lower(trim(coalesce(status, ''))) in ('פתוח', 'open')
  and nullif(trim(coalesce(instruction_language, '')), '') is null;

update public.activities
set required_instructor_gender = 'any'
where activity_season = 'school_2027'
  and lower(trim(coalesce(activity_type, ''))) in ('קורס', 'course', 'program')
  and lower(trim(coalesce(status, ''))) in ('פתוח', 'open')
  and nullif(trim(coalesce(required_instructor_gender, '')), '') is null;

alter table public.activities alter column instruction_language set default 'he';
alter table public.activities alter column required_instructor_gender set default 'any';
