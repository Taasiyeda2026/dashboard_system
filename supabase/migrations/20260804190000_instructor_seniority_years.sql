alter table public.contacts_instructors
  add column if not exists seniority_years smallint;

alter table public.contacts_instructors
  drop constraint if exists contacts_instructors_seniority_years_check;

alter table public.contacts_instructors
  add constraint contacts_instructors_seniority_years_check
  check (seniority_years is null or seniority_years between 1 and 20);

comment on column public.contacts_instructors.seniority_years is
  'Whole years of instructor seniority displayed in the instructor profile. Allowed values: 1-20 or NULL when not defined.';

notify pgrst, 'reload schema';
