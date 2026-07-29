-- Course-level scheduling requirements for the instructor matching flow.
-- Language values: he = Hebrew, ar = Arabic.
-- Gender values: any = no requirement, female = female instructor only, male = male instructor only.

alter table public.activities
  add column if not exists instruction_language text not null default 'he',
  add column if not exists required_instructor_gender text not null default 'any';

alter table public.catalog_program_details
  add column if not exists instruction_language text not null default 'he',
  add column if not exists required_instructor_gender text not null default 'any';

alter table public.proposal_gefen_courses
  add column if not exists instruction_language text not null default 'he',
  add column if not exists required_instructor_gender text not null default 'any';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'activities_instruction_language_check'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_instruction_language_check
      check (instruction_language in ('he', 'ar'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'activities_required_instructor_gender_check'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_required_instructor_gender_check
      check (required_instructor_gender in ('any', 'female', 'male'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_program_details_instruction_language_check'
      and conrelid = 'public.catalog_program_details'::regclass
  ) then
    alter table public.catalog_program_details
      add constraint catalog_program_details_instruction_language_check
      check (instruction_language in ('he', 'ar'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_program_details_required_instructor_gender_check'
      and conrelid = 'public.catalog_program_details'::regclass
  ) then
    alter table public.catalog_program_details
      add constraint catalog_program_details_required_instructor_gender_check
      check (required_instructor_gender in ('any', 'female', 'male'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'proposal_gefen_courses_instruction_language_check'
      and conrelid = 'public.proposal_gefen_courses'::regclass
  ) then
    alter table public.proposal_gefen_courses
      add constraint proposal_gefen_courses_instruction_language_check
      check (instruction_language in ('he', 'ar'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'proposal_gefen_courses_required_instructor_gender_check'
      and conrelid = 'public.proposal_gefen_courses'::regclass
  ) then
    alter table public.proposal_gefen_courses
      add constraint proposal_gefen_courses_required_instructor_gender_check
      check (required_instructor_gender in ('any', 'female', 'male'));
  end if;
end $$;

-- "פורצות דרך" is delivered only by a female instructor.
update public.catalog_program_details
set required_instructor_gender = 'female',
    instruction_language = 'he',
    updated_at = now()
where gefen_number = '3604'
   or activity_no = '3604'
   or catalog_title ilike '%פורצות דרך%';

update public.proposal_gefen_courses
set required_instructor_gender = 'female',
    instruction_language = 'he',
    updated_at = now()
where gefen_number in ('3604', '67861')
   or short_name ilike '%פורצות דרך%'
   or full_name ilike '%פורצות דרך%';

update public.activities
set required_instructor_gender = 'female',
    instruction_language = 'he',
    updated_at = now()
where gefen_number in ('3604', '67861')
   or activity_name ilike '%פורצות דרך%'
   or program_name ilike '%פורצות דרך%';

comment on column public.activities.instruction_language is 'Scheduling language requirement: he or ar';
comment on column public.activities.required_instructor_gender is 'Scheduling gender requirement: any, female or male';
comment on column public.catalog_program_details.instruction_language is 'Default scheduling language requirement: he or ar';
comment on column public.catalog_program_details.required_instructor_gender is 'Default scheduling gender requirement: any, female or male';
comment on column public.proposal_gefen_courses.instruction_language is 'Default scheduling language requirement: he or ar';
comment on column public.proposal_gefen_courses.required_instructor_gender is 'Default scheduling gender requirement: any, female or male';
