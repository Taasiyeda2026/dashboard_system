-- Verification queries for the authorities-based activity district fix.
-- Run before/after applying 20260802080558_fix_activity_district_from_authorities.sql

-- 1) All active authorities still have a district
select
  count(*) as active_authorities,
  count(*) filter (where nullif(btrim(coalesce(district, '')), '') is null) as missing_district
from public.authorities
where lower(btrim(coalesce(active::text, ''))) in ('yes', 'true', '1', 'y');

-- 2) Active school_2027 rows still pending district assignment
select
  count(*) as pending_active,
  count(*) filter (
    where authority_id is not null
       or nullif(btrim(coalesce(authority, '')), '') is not null
  ) as pending_with_authority,
  count(*) filter (
    where authority_id is null
      and nullif(btrim(coalesce(authority, '')), '') is null
  ) as pending_without_authority
from public.activities
where activity_season = 'school_2027'
  and btrim(coalesce(district, '')) = 'ממתין לשיוך מחוזי'
  and btrim(coalesce(status, '')) is distinct from 'נמחק';

-- 3) Deleted pending rows (must not be counted as active exceptions)
select count(*) as pending_deleted
from public.activities
where activity_season = 'school_2027'
  and btrim(coalesce(district, '')) = 'ממתין לשיוך מחוזי'
  and btrim(coalesce(status, '')) = 'נמחק';

-- 4) Backup size
select count(*) as backup_rows
from public.activities_school_2027_pending_district_backup_20260802;

-- 5) Function source no longer depends on authority_district_map
select pg_get_functiondef('public.set_activity_district()'::regprocedure) as function_def;
