-- Optional free-text destination for tour activity records only.
-- Keep the canonical school/authority association unchanged.
alter table public.activities
  add column if not exists tour_location text;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.activities'::regclass
      and conname = 'activities_tour_location_max_15_chk'
  ) then
    alter table public.activities
      add constraint activities_tour_location_max_15_chk
      check (
        tour_location is null
        or (coalesce(activity_type, '') = 'tour' and char_length(tour_location) <= 15)
      );
  end if;
end
$migration$;

comment on column public.activities.tour_location
  is 'Tour destination (up to 15 characters); only populated for activity_type = tour.';
