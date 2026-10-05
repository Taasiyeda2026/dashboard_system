-- Constant-size authoritative preflight and fencing for every planning write.
-- Apply after the existing persistence, checkpoint and lease migrations.
create table public.scheduling_planning_source_state (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 1,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.scheduling_planning_source_state(singleton) values (true);
revoke all on public.scheduling_planning_source_state from public, anon, authenticated;
alter table public.scheduling_planning_source_state enable row level security;
alter table public.scheduling_planning_workspaces add column validated_source_revision bigint;
alter table public.scheduling_planning_checkpoints add column phase text;
create table public.scheduling_planning_checkpoint_rows (
  period_key text not null,
  district text not null,
  activity_id text not null,
  row_data jsonb not null,
  primary key(period_key,district,activity_id),
  foreign key(period_key,district) references public.scheduling_planning_checkpoints on delete cascade
);
alter table public.scheduling_planning_checkpoint_rows enable row level security;
revoke all on public.scheduling_planning_checkpoint_rows from public,anon,authenticated;
create index if not exists scheduling_planning_rows_dirty_idx
  on public.scheduling_planning_rows(workspace_id) where needs_recalc;

create function public.scheduling_planning_source_activity_payload(value jsonb)
returns jsonb language sql immutable set search_path=public as $$
  select coalesce(jsonb_object_agg(key,val),'{}'::jsonb)
  from jsonb_each(value) item(key,val) where key=any(array['row_id','gefen_number','calendar_sector','school_address','program_name','type','district','authority_id','authority','school','school_id','activity_name','catalog_slug','activity_no','proposal_item_id','activity_type','item_type','activity_season','grade','education_level','class_group','sessions','start_time','end_time','instruction_language','required_instructor_gender','instructor_assignment_status','instructor_assignment_locked','draft_emp_id','draft_instructor_name','draft_created_at','draft_proposed_meetings','emp_id','instructor_name','emp_id_2','instructor_name_2','start_date','end_date','status','date_1','date_2','date_3','date_4','date_5','date_6','date_7','date_8','date_9','date_10','date_11','date_12','date_13','date_14','date_15','date_16','date_17','date_18','date_19','date_20','date_21','date_22','date_23','date_24','date_25','date_26','date_27','date_28','date_29','date_30','date_31','date_32','date_33','date_34','date_35']);
$$;
revoke all on function public.scheduling_planning_source_activity_payload(jsonb) from public;

create function public.scheduling_planning_route_affects_row(p_row public.scheduling_planning_rows,addresses text[])
returns boolean language sql stable set search_path=public as $$
  select cardinality(addresses)=0 or exists(select from public.activities a where a.row_id=p_row.activity_id
    and lower(btrim(public.scheduling_school_location(a.school_id,a.school,a.authority_id,a.authority)))=any(addresses))
    or exists(select from public.contacts_instructors i where lower(btrim(i.address))=any(addresses)
      and i.emp_id::text=any(public.scheduling_planning_row_instructor_ids(p_row)));
$$;
revoke all on function public.scheduling_planning_route_affects_row(public.scheduling_planning_rows,text[]) from public;

create or replace function public.scheduling_track_planning_source_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  before_data jsonb := case when TG_OP <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  after_data jsonb := case when TG_OP <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  entity_ids text[];
  route_addresses text[];
begin
  if TG_OP = 'UPDATE' and before_data = after_data then return null; end if;
  if TG_TABLE_NAME = 'activities' and TG_OP = 'UPDATE'
    and public.scheduling_planning_source_activity_payload(before_data)=public.scheduling_planning_source_activity_payload(after_data) then return null; end if;
  -- Durable route insertion merely warms the cache. Changes/removal of an
  -- existing verified route are source changes and must invalidate currency.
  if TG_TABLE_NAME = 'scheduling_travel_cache' then
    route_addresses := array(select distinct lower(btrim(value)) from unnest(array[before_data->>'origin_address',before_data->>'destination_address',after_data->>'origin_address',after_data->>'destination_address']) value where nullif(btrim(value),'') is not null);
    if TG_OP = 'INSERT' then
      update public.scheduling_planning_rows r set needs_recalc=true where r.row_data->>'kind' in ('missing','recruitment') and public.scheduling_planning_route_affects_row(r,route_addresses);
      return null;
    end if;
    if TG_OP = 'UPDATE' and (before_data - array['updated_at','created_at','calculated_at','expires_at','last_used_at','id'])
      = (after_data - array['updated_at','created_at','calculated_at','expires_at','last_used_at','id']) then return null; end if;
    update public.scheduling_planning_rows r set needs_recalc=true where coalesce(r.row_data->>'kind','') <> 'live' and public.scheduling_planning_route_affects_row(r,route_addresses);
  end if;
  update public.scheduling_planning_source_state
    set revision=revision+1, updated_at=clock_timestamp() where singleton;
  if TG_TABLE_NAME='activities' then
    update public.scheduling_planning_rows set needs_recalc=true
    where activity_id=coalesce(after_data->>'row_id',before_data->>'row_id');
  end if;
  entity_ids := array_remove(array[
    before_data->>'id', after_data->>'id', before_data->>'school_id', after_data->>'school_id',
    before_data->>'authority_id', after_data->>'authority_id',
    before_data->>'activity_id', after_data->>'activity_id',
    before_data->>'activity_row_id', after_data->>'activity_row_id'
  ], null);
  if TG_TABLE_NAME='activity_completion_approval_uploads' then
    entity_ids := entity_ids || string_to_array(coalesce(before_data->>'activity_row_id',''),',') || string_to_array(coalesce(after_data->>'activity_row_id',''),',');
    entity_ids := array(select btrim(value) from unnest(entity_ids) value);
  end if;
  -- These joined inputs do not necessarily change activities.updated_at.
  if TG_TABLE_NAME in ('contacts_schools','schools','authorities','course_meeting_cancellations',
    'activity_completion_approval_uploads','scheduling_course_meeting_substitutions') then
    update public.scheduling_planning_rows r set needs_recalc=true
    from public.activities a
    where r.activity_id=a.row_id and coalesce(r.row_data->>'kind','') <> 'live'
      and (case
        when TG_TABLE_NAME in ('contacts_schools','schools') then to_jsonb(a)->>'school_id'=any(entity_ids)
          or (TG_TABLE_NAME='contacts_schools' and (
            (lower(btrim(to_jsonb(a)->>'school'))=lower(btrim(before_data->>'school')) and (to_jsonb(a)->>'authority_id'=before_data->>'authority_id' or lower(btrim(to_jsonb(a)->>'authority'))=lower(btrim(before_data->>'authority'))))
            or (lower(btrim(to_jsonb(a)->>'school'))=lower(btrim(after_data->>'school')) and (to_jsonb(a)->>'authority_id'=after_data->>'authority_id' or lower(btrim(to_jsonb(a)->>'authority'))=lower(btrim(after_data->>'authority'))))))
        when TG_TABLE_NAME='authorities' then to_jsonb(a)->>'authority_id'=any(entity_ids) or lower(btrim(to_jsonb(a)->>'authority'))=any(array[lower(btrim(before_data->>'name')),lower(btrim(after_data->>'name'))])
        else a.row_id=any(entity_ids) end);
  end if;
  -- A newly available/eligible instructor can rescue rows that previously had
  -- no candidates, even when the saved options do not reference that instructor.
  if TG_TABLE_NAME in ('contacts_instructors','instructor_scheduling_profiles',
    'instructor_availability_rules','instructor_availability_exceptions') then
    update public.scheduling_planning_rows set needs_recalc=true
    where row_data->>'kind' in ('recruitment','missing');
  end if;
  return null;
end $$;
revoke all on function public.scheduling_track_planning_source_change() from public;

-- Take the source lock before source-table row locks and legacy invalidation
-- locks, matching the order used by canonical commits. This avoids inversion
-- between activity/instructor triggers and a workspace save.
create function public.scheduling_lock_planning_source_change() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform 1 from public.scheduling_planning_source_state where singleton for update;
  return null;
end $$;
revoke all on function public.scheduling_lock_planning_source_change() from public;

do $$
declare source_table text;
begin
  foreach source_table in array array[
    'activities','contacts_instructors','instructor_scheduling_profiles',
    'instructor_availability_rules','instructor_availability_exceptions',
    'school_calendar','proposal_activity_pricing','contacts_schools','schools','authorities',
    'course_meeting_cancellations','activity_completion_approval_uploads',
    'scheduling_course_meeting_substitutions','scheduling_travel_cache'
  ] loop
    if to_regclass('public.'||source_table) is not null then
      execute format('create trigger aa_planning_source_lock before insert or update or delete on public.%I for each statement execute function public.scheduling_lock_planning_source_change()',source_table);
      execute format('create trigger zz_planning_source_revision after insert or update or delete on public.%I for each row execute function public.scheduling_track_planning_source_change()',source_table);
    end if;
  end loop;
end $$;

create or replace function public.get_scheduling_planning_preflight(p_period_key text,p_district text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.app_has_permission('view_operations_scheduling') or auth.uid() is null then
    raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  -- One MVCC snapshot: never pair an old source token with newer workspace facts.
  -- Checkpoint payloads are deliberately absent from this read.
  return (with w as (
    select id,engine_version,revision,validated_source_revision
    from public.scheduling_planning_workspaces
    where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''))
  ), l as (
    select run_id,owner_id,expires_at,heartbeat_at from public.scheduling_planning_run_leases
    where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''))
      and expires_at>clock_timestamp() and heartbeat_at>clock_timestamp()-interval '60 seconds'
  ), cp as (
    select completed_count,total_count,updated_at,phase,engine_version
    from public.scheduling_planning_checkpoints
    where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''))
  ) select jsonb_build_object('schemaVersion',1,'sourceRevision',s.revision::text,
    'serverTime',clock_timestamp(),
    'dirtyCount',(select count(*) from public.scheduling_planning_rows r where r.workspace_id=(select id from w) and r.needs_recalc),
    'workspace',(select jsonb_build_object('engineVersion',engine_version,'revision',revision,
      'validatedSourceRevision',validated_source_revision::text) from w),
    'activeLease',(select jsonb_build_object('run_id',run_id,'owner_id',owner_id,
      'expires_at',expires_at,'heartbeat_at',heartbeat_at,
      'retry_at',least(expires_at,heartbeat_at+interval '60 seconds')) from l),
    'checkpoint',(select jsonb_build_object('completedCount',completed_count,'totalCount',total_count,
      'updatedAt',updated_at,'phase',phase,'engineVersion',engine_version) from cp))
    from public.scheduling_planning_source_state s where s.singleton);
end $$;
revoke all on function public.get_scheduling_planning_preflight(text,text) from public;
grant execute on function public.get_scheduling_planning_preflight(text,text) to authenticated;

-- Serialize ownership decisions with commits. All time checks use wall time,
-- rather than a potentially old transaction-start timestamp.
create or replace function public.assert_scheduling_planning_run_ownership(
  p_period text,p_district text,p_run_id uuid,p_expected_revision bigint,p_source_revision bigint
) returns void language plpgsql security definer set search_path=public as $$
declare l public.scheduling_planning_run_leases; w public.scheduling_planning_workspaces; source_revision bigint;
begin
  if not public.app_has_permission('view_operations_scheduling') or auth.uid() is null then
    raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext(btrim(p_period)||'|'||btrim(coalesce(p_district,''))));
  select * into l from public.scheduling_planning_run_leases
    where period_key=btrim(p_period) and district=btrim(coalesce(p_district,'')) for update;
  if p_run_id is null or l.run_id is distinct from p_run_id or l.owner_id is distinct from auth.uid()
    or l.expires_at <= clock_timestamp() or l.heartbeat_at <= clock_timestamp()-interval '60 seconds' then
    raise exception 'planning_run_ownership_lost'; end if;
  select revision into source_revision from public.scheduling_planning_source_state where singleton for share;
  if p_source_revision is null or source_revision is distinct from p_source_revision then raise exception 'planning_source_revision_conflict'; end if;
  select * into w from public.scheduling_planning_workspaces
    where period_key=btrim(p_period) and district=btrim(coalesce(p_district,'')) for update;
  if p_expected_revision is not null and coalesce(w.revision,0) <> p_expected_revision then
    raise exception 'planning_revision_conflict'; end if;
end $$;
revoke all on function public.assert_scheduling_planning_run_ownership(text,text,uuid,bigint,bigint) from public;

create or replace function public.acquire_scheduling_planning_run_lease(
  p_period_key text,
  p_district text default '',
  p_run_id uuid default null,
  p_ttl_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := coalesce(btrim(coalesce(p_district, '')), '');
  v_run_id uuid := coalesce(p_run_id, gen_random_uuid());
  v_ttl integer := greatest(60, least(coalesce(p_ttl_seconds, 120), 3600));
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := v_now + make_interval(secs => v_ttl);
  existing public.scheduling_planning_run_leases;
  v_owner uuid := auth.uid();
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;
  if scope_period is null then
    raise exception 'planning_scope_invalid';
  end if;
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('scheduling_planning_run'),
    hashtext(scope_period || '|' || scope_district)
  );

  v_now := clock_timestamp();
  v_expires := v_now + make_interval(secs => v_ttl);

  delete from public.scheduling_planning_run_leases
  where period_key = scope_period
    and district = scope_district
    and (expires_at <= v_now or heartbeat_at <= v_now - interval '60 seconds');

  select * into existing
  from public.scheduling_planning_run_leases
  where period_key = scope_period and district = scope_district
  for update;

  if found then
    if existing.owner_id = v_owner then
      if existing.run_id <> v_run_id then
        return jsonb_build_object(
          'acquired', false,
          'reason', 'planning_run_locked',
          'run_id', existing.run_id,
          'owner_id', existing.owner_id,
          'expires_at', existing.expires_at,
          'retry_at', least(existing.expires_at,existing.heartbeat_at+interval '60 seconds')
        );
      end if;
      update public.scheduling_planning_run_leases
      set heartbeat_at = v_now,
          expires_at = v_expires,
          acquired_at = existing.acquired_at
      where period_key = scope_period and district = scope_district;
      return jsonb_build_object(
        'acquired', true,
        'renewed', true,
        'replaced', false,
        'run_id', v_run_id,
        'expires_at', v_expires
      );
    end if;
    return jsonb_build_object(
      'acquired', false,
      'reason', 'planning_run_locked',
      'run_id', existing.run_id,
      'owner_id', existing.owner_id,
      'expires_at', existing.expires_at,
          'retry_at', least(existing.expires_at,existing.heartbeat_at+interval '60 seconds')
    );
  end if;

  insert into public.scheduling_planning_run_leases(
    period_key, district, run_id, owner_id, acquired_at, heartbeat_at, expires_at
  ) values (
    scope_period, scope_district, v_run_id, v_owner, v_now, v_now, v_expires
  );

  return jsonb_build_object(
    'acquired', true,
    'renewed', false,
    'run_id', v_run_id,
    'expires_at', v_expires
  );
end;
$$;

create or replace function public.heartbeat_scheduling_planning_run_lease(
  p_period_key text,
  p_district text default '',
  p_run_id uuid default null,
  p_ttl_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := coalesce(btrim(coalesce(p_district, '')), '');
  v_run_id uuid := p_run_id;
  v_ttl integer := greatest(60, least(coalesce(p_ttl_seconds, 120), 3600));
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := v_now + make_interval(secs => v_ttl);
  existing public.scheduling_planning_run_leases;
  v_owner uuid := auth.uid();
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;
  if scope_period is null or v_run_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext(scope_period || '|' || scope_district));

  v_now := clock_timestamp();
  v_expires := v_now + make_interval(secs => v_ttl);

  select * into existing
  from public.scheduling_planning_run_leases
  where period_key = scope_period and district = scope_district
  for update;

  if not found or existing.expires_at <= v_now or existing.heartbeat_at <= v_now - interval '60 seconds' then
    delete from public.scheduling_planning_run_leases
    where period_key = scope_period and district = scope_district;
    return jsonb_build_object('ok', false, 'reason', 'lease_missing');
  end if;
  if existing.owner_id <> v_owner or existing.run_id <> v_run_id then
    return jsonb_build_object('ok', false, 'reason', 'lease_not_owned');
  end if;

  update public.scheduling_planning_run_leases
  set heartbeat_at = v_now,
      expires_at = v_expires
  where period_key = scope_period and district = scope_district;

  return jsonb_build_object('ok', true, 'expires_at', v_expires);
end;
$$;

create or replace function public.release_scheduling_planning_run_lease(
  p_period_key text,
  p_district text default '',
  p_run_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := coalesce(btrim(coalesce(p_district, '')), '');
  v_run_id uuid := p_run_id;
  existing public.scheduling_planning_run_leases;
  v_owner uuid := auth.uid();
begin
  if scope_period is null or v_run_id is null then
    return jsonb_build_object('released', false, 'reason', 'invalid_request');
  end if;
  if v_owner is null then
    return jsonb_build_object('released', false, 'reason', 'authentication_required');
  end if;

  select * into existing
  from public.scheduling_planning_run_leases
  where period_key = scope_period and district = scope_district
  for update;

  if not found then
    return jsonb_build_object('released', true, 'reason', 'already_free');
  end if;
  if existing.owner_id <> v_owner or existing.run_id <> v_run_id then
    return jsonb_build_object('released', false, 'reason', 'lease_not_owned');
  end if;

  delete from public.scheduling_planning_run_leases
  where period_key = scope_period and district = scope_district;

  return jsonb_build_object('released', true);
end;
$$;


alter function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint) rename to save_scheduling_planning_snapshot_unfenced;
revoke all on function public.save_scheduling_planning_snapshot_unfenced(text,text,text,text,text,jsonb,bigint) from public,anon,authenticated;
create function public.save_scheduling_planning_snapshot(
  p_period_key text,
  p_district text,
  p_engine_version text,
  p_data_fingerprint text,
  p_context_fingerprint text,
  p_rows jsonb,
  p_expected_revision bigint,
  p_run_id uuid default null, p_source_revision bigint default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if p_expected_revision is null then raise exception 'planning_revision_required'; end if;
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,p_expected_revision,p_source_revision);
  result := public.save_scheduling_planning_snapshot_unfenced(p_period_key,p_district,p_engine_version,p_data_fingerprint,p_context_fingerprint,p_rows,p_expected_revision);
  update public.scheduling_planning_workspaces set validated_source_revision=p_source_revision
    where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''));
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,null,p_source_revision);
  return result;
end $$;
revoke all on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint,uuid,bigint) from public;
grant execute on function public.save_scheduling_planning_snapshot(text,text,text,text,text,jsonb,bigint,uuid,bigint) to authenticated;

alter function public.save_scheduling_planning_incremental_snapshot(text,text,text,text,text,jsonb,jsonb,bigint) rename to save_scheduling_planning_incremental_snapshot_unfenced;
revoke all on function public.save_scheduling_planning_incremental_snapshot_unfenced(text,text,text,text,text,jsonb,jsonb,bigint) from public,anon,authenticated;
create function public.save_scheduling_planning_incremental_snapshot(
  p_period_key text,
  p_district text,
  p_engine_version text,
  p_data_fingerprint text,
  p_context_fingerprint text,
  p_rows jsonb,
  p_removed_activity_ids jsonb,
  p_expected_revision bigint,
  p_run_id uuid default null, p_source_revision bigint default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if p_expected_revision is null then raise exception 'planning_revision_required'; end if;
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,p_expected_revision,p_source_revision);
  if exists(select from public.scheduling_planning_workspaces w where w.period_key=btrim(p_period_key) and w.district=btrim(coalesce(p_district,'')) and w.validated_source_revision is null) then raise exception 'planning_source_validation_required'; end if;
  result := public.save_scheduling_planning_incremental_snapshot_unfenced(p_period_key,p_district,p_engine_version,p_data_fingerprint,p_context_fingerprint,p_rows,p_removed_activity_ids,p_expected_revision);
  update public.scheduling_planning_workspaces set validated_source_revision=p_source_revision
    where period_key=btrim(p_period_key) and district=btrim(coalesce(p_district,''));
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,null,p_source_revision);
  return result;
end $$;
revoke all on function public.save_scheduling_planning_incremental_snapshot(text,text,text,text,text,jsonb,jsonb,bigint,uuid,bigint) from public;
grant execute on function public.save_scheduling_planning_incremental_snapshot(text,text,text,text,text,jsonb,jsonb,bigint,uuid,bigint) to authenticated;

alter function public.save_scheduling_planning_checkpoint(text,text,text,text,text,integer,integer,jsonb,jsonb) rename to save_scheduling_planning_checkpoint_unfenced;
revoke all on function public.save_scheduling_planning_checkpoint_unfenced(text,text,text,text,text,integer,integer,jsonb,jsonb) from public,anon,authenticated;
create function public.save_scheduling_planning_checkpoint(
  p_period_key text,
  p_district text,
  p_engine_version text,
  p_data_fingerprint text,
  p_context_fingerprint text,
  p_completed_count integer,
  p_total_count integer,
  p_completed_activity_ids jsonb,
  p_rows jsonb,
  p_run_id uuid default null, p_source_revision bigint default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; meta jsonb:=p_rows->0; scope_period text:=btrim(p_period_key); scope_district text:=btrim(coalesce(p_district,'')); completed_ids jsonb; saved_count integer;
begin
  if meta->>'__planningRunMeta' is distinct from 'true' or meta->>'workspaceRevision' is null
    or meta->>'sourceRevision' is distinct from p_source_revision::text then raise exception 'planning_checkpoint_meta_required'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>11 or octet_length(p_rows::text)>1048576 then raise exception 'planning_checkpoint_chunk_too_large'; end if;
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,(meta->>'workspaceRevision')::bigint,p_source_revision);
  if exists(select from public.scheduling_planning_checkpoints c where c.period_key=scope_period and c.district=scope_district
    and (c.engine_version is distinct from p_engine_version or c.data_fingerprint is distinct from p_data_fingerprint
      or c.context_fingerprint is distinct from p_context_fingerprint or c.rows_data->0->>'sourceRevision' is distinct from p_source_revision::text
      or c.rows_data->0->>'workspaceRevision' is distinct from meta->>'workspaceRevision')) then
    delete from public.scheduling_planning_checkpoints where period_key=scope_period and district=scope_district;
  end if;
  -- Parent contains only metadata; each proposal is updated independently.
  result := public.save_scheduling_planning_checkpoint_unfenced(p_period_key,p_district,p_engine_version,p_data_fingerprint,p_context_fingerprint,0,p_total_count,'[]'::jsonb,jsonb_build_array(meta));
  insert into public.scheduling_planning_checkpoint_rows(period_key,district,activity_id,row_data)
    select scope_period,scope_district,item->>'courseId',item from jsonb_array_elements(p_rows) item
    where item->>'courseId' is not null and item->>'__planningRunMeta' is distinct from 'true'
    on conflict(period_key,district,activity_id) do update set row_data=excluded.row_data;
  select coalesce(jsonb_agg(activity_id order by activity_id),'[]'::jsonb),count(*)
    into completed_ids,saved_count from public.scheduling_planning_checkpoint_rows where period_key=scope_period and district=scope_district;
  if meta->>'phase'='validated' and saved_count<>p_total_count then raise exception 'planning_checkpoint_incomplete'; end if;
  update public.scheduling_planning_checkpoints set phase=meta->>'phase',completed_count=saved_count,completed_activity_ids=completed_ids
    where period_key=scope_period and district=scope_district;
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,null,p_source_revision);
  return result||jsonb_build_object('completedCount',saved_count);
end $$;
revoke all on function public.save_scheduling_planning_checkpoint(text,text,text,text,text,integer,integer,jsonb,jsonb,uuid,bigint) from public;
grant execute on function public.save_scheduling_planning_checkpoint(text,text,text,text,text,integer,integer,jsonb,jsonb,uuid,bigint) to authenticated;


alter function public.clear_scheduling_planning_checkpoint(text,text) rename to clear_scheduling_planning_checkpoint_unfenced;
revoke all on function public.clear_scheduling_planning_checkpoint_unfenced(text,text) from public,anon,authenticated;
create function public.clear_scheduling_planning_checkpoint(
  p_period_key text,p_district text,p_run_id uuid default null,p_source_revision bigint default null
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  perform public.assert_scheduling_planning_run_ownership(p_period_key,p_district,p_run_id,null,p_source_revision);
  return public.clear_scheduling_planning_checkpoint_unfenced(p_period_key,p_district);
end $$;
revoke all on function public.clear_scheduling_planning_checkpoint(text,text,uuid,bigint) from public;
grant execute on function public.clear_scheduling_planning_checkpoint(text,text,uuid,bigint) to authenticated;

-- A resume is the only operation that reads all checkpoint proposal rows.
create or replace function public.get_scheduling_planning_checkpoint(
  p_period_key text,p_district text,p_engine_version text,p_data_fingerprint text,p_context_fingerprint text
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.app_has_permission('view_operations_scheduling') or auth.uid() is null then
    raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  return (select jsonb_build_object('completedCount',c.completed_count,'totalCount',c.total_count,
    'completedActivityIds',c.completed_activity_ids,'updatedAt',c.updated_at,
    'rows',c.rows_data||coalesce((select jsonb_agg(r.row_data order by r.activity_id)
      from public.scheduling_planning_checkpoint_rows r where r.period_key=c.period_key and r.district=c.district),'[]'::jsonb))
    from public.scheduling_planning_checkpoints c where c.period_key=btrim(p_period_key) and c.district=btrim(coalesce(p_district,''))
      and c.engine_version=p_engine_version and c.data_fingerprint=p_data_fingerprint and c.context_fingerprint=p_context_fingerprint);
end $$;
