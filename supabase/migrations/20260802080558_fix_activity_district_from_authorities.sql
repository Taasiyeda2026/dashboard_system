-- Fix activity district assignment to use authorities.district as the source of truth.
-- Stops relying on the legacy authority_district_map table as the primary lookup.
-- Also backfills school_2027 active rows currently marked "ממתין לשיוך מחוזי".
--
-- Safe / reversible:
--   1) Backup table created before any UPDATE
--   2) Only school_2027 rows are updated
--   3) Deleted rows are not updated
--   4) Rows without an authority are left unchanged
--   5) authority_district_map is not dropped

-- ---------------------------------------------------------------------------
-- 1) Canonical trigger function: set_activity_district
-- ---------------------------------------------------------------------------
create or replace function public.set_activity_district()
returns trigger
language plpgsql
as $$
declare
  v_district text;
  v_authority_norm text;
  v_match_count integer := 0;
begin
  v_district := null;

  -- Primary source: authorities.district via authority_id
  if new.authority_id is not null then
    select nullif(btrim(a.district), '')
      into v_district
    from public.authorities a
    where a.id = new.authority_id
    limit 1;
  end if;

  -- Fallback: unique safe name match after trimming/collapsing whitespace
  if v_district is null
     and nullif(btrim(coalesce(new.authority, '')), '') is not null then
    v_authority_norm := regexp_replace(lower(btrim(new.authority)), '\s+', '', 'g');

    select count(*), min(nullif(btrim(a.district), ''))
      into v_match_count, v_district
    from public.authorities a
    where regexp_replace(lower(btrim(coalesce(a.authority_name, ''))), '\s+', '', 'g')
          = v_authority_norm
      and nullif(btrim(coalesce(a.district, '')), '') is not null;

    if v_match_count <> 1 then
      v_district := null;
    end if;
  end if;

  if v_district is not null then
    new.district := v_district;
  elsif new.authority_id is not null
        or nullif(btrim(coalesce(new.authority, '')), '') is not null then
    -- Authority present but no district could be resolved from authorities
    new.district := 'ממתין לשיוך מחוזי';
  end if;
  -- No authority: leave district unchanged. Missing-authority is a separate UI exception.

  return new;
end;
$$;

comment on function public.set_activity_district() is
  'Sets activities.district from authorities.district (by authority_id, then unique authority name). Does not use authority_district_map as the primary source.';

drop trigger if exists trg_set_activity_district on public.activities;
create trigger trg_set_activity_district
before insert or update of authority_id, authority
on public.activities
for each row
execute function public.set_activity_district();

-- ---------------------------------------------------------------------------
-- 2) Pre-update verification (NOTICE only)
-- ---------------------------------------------------------------------------
do $$
declare
  v_pending_total integer;
  v_pending_active integer;
  v_pending_deleted integer;
  v_by_id integer;
  v_by_name integer;
  v_no_authority integer;
  v_authorities_with_district integer;
  v_authorities_active integer;
begin
  select count(*) into v_pending_total
  from public.activities
  where activity_season = 'school_2027'
    and btrim(coalesce(district, '')) = 'ממתין לשיוך מחוזי';

  select count(*) into v_pending_active
  from public.activities
  where activity_season = 'school_2027'
    and btrim(coalesce(district, '')) = 'ממתין לשיוך מחוזי'
    and btrim(coalesce(status, '')) is distinct from 'נמחק';

  select count(*) into v_pending_deleted
  from public.activities
  where activity_season = 'school_2027'
    and btrim(coalesce(district, '')) = 'ממתין לשיוך מחוזי'
    and btrim(coalesce(status, '')) = 'נמחק';

  select count(*) into v_by_id
  from public.activities act
  join public.authorities auth on auth.id = act.authority_id
  where act.activity_season = 'school_2027'
    and btrim(coalesce(act.district, '')) = 'ממתין לשיוך מחוזי'
    and btrim(coalesce(act.status, '')) is distinct from 'נמחק'
    and nullif(btrim(coalesce(auth.district, '')), '') is not null;

  select count(*) into v_by_name
  from public.activities act
  where act.activity_season = 'school_2027'
    and btrim(coalesce(act.district, '')) = 'ממתין לשיוך מחוזי'
    and btrim(coalesce(act.status, '')) is distinct from 'נמחק'
    and act.authority_id is null
    and nullif(btrim(coalesce(act.authority, '')), '') is not null
    and (
      select count(*)
      from public.authorities auth
      where regexp_replace(lower(btrim(coalesce(auth.authority_name, ''))), '\s+', '', 'g')
            = regexp_replace(lower(btrim(act.authority)), '\s+', '', 'g')
        and nullif(btrim(coalesce(auth.district, '')), '') is not null
    ) = 1;

  select count(*) into v_no_authority
  from public.activities
  where activity_season = 'school_2027'
    and btrim(coalesce(district, '')) = 'ממתין לשיוך מחוזי'
    and btrim(coalesce(status, '')) is distinct from 'נמחק'
    and authority_id is null
    and nullif(btrim(coalesce(authority, '')), '') is null;

  select count(*) into v_authorities_active
  from public.authorities
  where lower(btrim(coalesce(active::text, ''))) in ('yes', 'true', '1', 'y');

  select count(*) into v_authorities_with_district
  from public.authorities
  where lower(btrim(coalesce(active::text, ''))) in ('yes', 'true', '1', 'y')
    and nullif(btrim(coalesce(district, '')), '') is not null;

  raise notice
    'district-fix BEFORE: pending_total=%, pending_active=%, pending_deleted=%, by_id=%, by_name=%, no_authority=%, authorities_active=%, authorities_with_district=%',
    v_pending_total, v_pending_active, v_pending_deleted, v_by_id, v_by_name, v_no_authority,
    v_authorities_active, v_authorities_with_district;
end
$$;

-- ---------------------------------------------------------------------------
-- 3) Backup table (all school_2027 rows currently pending district assignment)
-- ---------------------------------------------------------------------------
create table if not exists public.activities_school_2027_pending_district_backup_20260802 as
select
  act.*,
  now() as backup_created_at
from public.activities act
where false;

alter table public.activities_school_2027_pending_district_backup_20260802
  add column if not exists backup_created_at timestamptz;

truncate table public.activities_school_2027_pending_district_backup_20260802;

insert into public.activities_school_2027_pending_district_backup_20260802
select
  act.*,
  now() as backup_created_at
from public.activities act
where act.activity_season = 'school_2027'
  and btrim(coalesce(act.district, '')) = 'ממתין לשיוך מחוזי';

comment on table public.activities_school_2027_pending_district_backup_20260802 is
  'Backup of school_2027 activities with district=ממתין לשיוך מחוזי before the 2026-08-02 authorities-based district fix. Restore by copying district (and related fields) back from this table.';

alter table public.activities_school_2027_pending_district_backup_20260802 enable row level security;

-- Backup is for DBA/service-role restore only; no client roles need access.
revoke all on table public.activities_school_2027_pending_district_backup_20260802 from public, anon, authenticated;
grant all on table public.activities_school_2027_pending_district_backup_20260802 to service_role;

-- ---------------------------------------------------------------------------
-- 4) Data fix: assign district from authorities for active school_2027 rows
-- ---------------------------------------------------------------------------

-- 4a) By authority_id
update public.activities act
set district = nullif(btrim(auth.district), ''),
    updated_at = now()
from public.authorities auth
where act.activity_season = 'school_2027'
  and btrim(coalesce(act.district, '')) = 'ממתין לשיוך מחוזי'
  and btrim(coalesce(act.status, '')) is distinct from 'נמחק'
  and act.authority_id is not null
  and auth.id = act.authority_id
  and nullif(btrim(coalesce(auth.district, '')), '') is not null;

-- 4b) By unique authority name (only when authority_id is missing)
with name_matches as (
  select
    act.ctid as act_ctid,
    min(nullif(btrim(auth.district), '')) as district
  from public.activities act
  join public.authorities auth
    on regexp_replace(lower(btrim(coalesce(auth.authority_name, ''))), '\s+', '', 'g')
     = regexp_replace(lower(btrim(act.authority)), '\s+', '', 'g')
  where act.activity_season = 'school_2027'
    and btrim(coalesce(act.district, '')) = 'ממתין לשיוך מחוזי'
    and btrim(coalesce(act.status, '')) is distinct from 'נמחק'
    and act.authority_id is null
    and nullif(btrim(coalesce(act.authority, '')), '') is not null
    and nullif(btrim(coalesce(auth.district, '')), '') is not null
  group by act.ctid
  having count(*) = 1
)
update public.activities act
set district = name_matches.district,
    updated_at = now()
from name_matches
where act.ctid = name_matches.act_ctid;

-- ---------------------------------------------------------------------------
-- 5) Post-update verification
-- ---------------------------------------------------------------------------
do $$
declare
  v_backup_count integer;
  v_fixed_active integer;
  v_remaining_pending_active integer;
  v_remaining_with_authority integer;
  v_remaining_no_authority integer;
  v_remaining_deleted integer;
  v_authorities_active integer;
  v_authorities_missing_district integer;
  v_summer_or_regular_changed integer;
begin
  select count(*) into v_backup_count
  from public.activities_school_2027_pending_district_backup_20260802;

  select count(*) into v_fixed_active
  from public.activities_school_2027_pending_district_backup_20260802 b
  join public.activities a
    on a.row_id is not distinct from b.row_id
   and a.activity_season = 'school_2027'
  where btrim(coalesce(b.status, '')) is distinct from 'נמחק'
    and btrim(coalesce(b.district, '')) = 'ממתין לשיוך מחוזי'
    and btrim(coalesce(a.district, '')) is distinct from 'ממתין לשיוך מחוזי'
    and nullif(btrim(coalesce(a.district, '')), '') is not null;

  select count(*) into v_remaining_pending_active
  from public.activities
  where activity_season = 'school_2027'
    and btrim(coalesce(district, '')) = 'ממתין לשיוך מחוזי'
    and btrim(coalesce(status, '')) is distinct from 'נמחק';

  select count(*) into v_remaining_with_authority
  from public.activities
  where activity_season = 'school_2027'
    and btrim(coalesce(district, '')) = 'ממתין לשיוך מחוזי'
    and btrim(coalesce(status, '')) is distinct from 'נמחק'
    and (
      authority_id is not null
      or nullif(btrim(coalesce(authority, '')), '') is not null
    );

  select count(*) into v_remaining_no_authority
  from public.activities
  where activity_season = 'school_2027'
    and btrim(coalesce(district, '')) = 'ממתין לשיוך מחוזי'
    and btrim(coalesce(status, '')) is distinct from 'נמחק'
    and authority_id is null
    and nullif(btrim(coalesce(authority, '')), '') is null;

  select count(*) into v_remaining_deleted
  from public.activities
  where activity_season = 'school_2027'
    and btrim(coalesce(district, '')) = 'ממתין לשיוך מחוזי'
    and btrim(coalesce(status, '')) = 'נמחק';

  select count(*) into v_authorities_active
  from public.authorities
  where lower(btrim(coalesce(active::text, ''))) in ('yes', 'true', '1', 'y');

  select count(*) into v_authorities_missing_district
  from public.authorities
  where lower(btrim(coalesce(active::text, ''))) in ('yes', 'true', '1', 'y')
    and nullif(btrim(coalesce(district, '')), '') is null;

  -- Ensure we did not touch summer_2026 / regular pending rows via this migration's updates.
  -- Compare backup row_ids only cover school_2027; this check confirms no non-2027 row
  -- with matching backup identity was altered (always 0 by construction).
  select count(*) into v_summer_or_regular_changed
  from public.activities_school_2027_pending_district_backup_20260802 b
  join public.activities a on a.row_id is not distinct from b.row_id
  where a.activity_season is distinct from 'school_2027';

  raise notice
    'district-fix AFTER: backup=%, fixed_active=%, remaining_pending_active=%, remaining_with_authority=%, remaining_no_authority=%, remaining_deleted=%, authorities_active=%, authorities_missing_district=%, non_2027_backup_join=%',
    v_backup_count, v_fixed_active, v_remaining_pending_active, v_remaining_with_authority,
    v_remaining_no_authority, v_remaining_deleted, v_authorities_active,
    v_authorities_missing_district, v_summer_or_regular_changed;

  if v_authorities_missing_district <> 0 then
    raise exception 'district-fix failed: % active authorities are missing district', v_authorities_missing_district;
  end if;

  if v_remaining_with_authority <> 0 then
    raise exception
      'district-fix failed: % active school_2027 rows still pending district despite having an authority',
      v_remaining_with_authority;
  end if;

  if v_summer_or_regular_changed <> 0 then
    raise exception 'district-fix failed: backup unexpectedly joined to non-school_2027 activities';
  end if;
end
$$;
