-- Scope the optional tour destination to school year 2027 only.
-- Historical activities retain their existing data unchanged.
alter table public.activities
  drop constraint if exists activities_tour_location_max_15_chk;

alter table public.activities
  add constraint activities_tour_location_max_15_chk
  check (
    tour_location is null
    or (
      coalesce(activity_type, '') = 'tour'
      and coalesce(activity_season, '') = 'school_2027'
      and char_length(tour_location) <= 15
    )
  );

comment on column public.activities.tour_location
  is 'Optional destination for school_2027 tours only (up to 15 characters). Historical activities do not use this field.';
