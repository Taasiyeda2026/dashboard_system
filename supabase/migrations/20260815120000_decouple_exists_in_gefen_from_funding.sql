-- `exists_in_gefen` records catalog presence independently of the activity's
-- funding sources. Keep all historical columns and values; only remove the
-- obsolete cross-field constraint that coupled it to `is_gefen_funded`.
alter table public.activities
  drop constraint if exists activities_gefen_exists_requires_funding;
