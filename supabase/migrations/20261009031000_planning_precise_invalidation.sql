-- Scheduling planning: precise invalidation (refs #2187).
--
-- 1. needs_recalc_marked_at records when a planning row was last flagged. A
--    planning run uses it to recheck rows that were already dirty when it
--    started and were flagged again while it was calculating (route change,
--    meeting substitution, approval upload, cancellation, school edit). Without
--    it the client must treat every still-dirty row as stale.
-- 2. Instructor edits flag missing/recruitment rows only when the edit can add
--    capacity, instead of on every profile/availability/contact change.
--
-- 3. A run's save/commit no longer clears flags set after that run started
--    (row trigger, see below). Route-cache INSERTs flag rows without bumping
--    the source revision, so before this the commit silently cleared them.
--
-- Additive only: one nullable column, one row trigger, one pure helper, and
-- two function bodies replaced. No row is deleted or rewritten, the saved plan
-- and any checkpoint are untouched, and the source revision fence is
-- unchanged (every change still bumps scheduling_planning_source_state).

alter table public.scheduling_planning_rows
  add column if not exists needs_recalc_marked_at timestamptz;

-- Stamp every flag. And while a planning run holds the lease for this
-- workspace, a flag set after that run started is never cleared by the run's
-- save/commit: the run computed that row before the change (e.g. a route-cache
-- INSERT, which deliberately does not bump the source revision so that a run's
-- own lookups do not fence it). The row stays dirty for the next incremental
-- run instead of being stored as current.
create or replace function public.scheduling_planning_rows_stamp_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  run_started_at timestamptz;
begin
  if new.needs_recalc is true then
    new.needs_recalc_marked_at := clock_timestamp();
  elsif TG_OP = 'UPDATE' and old.needs_recalc is true then
    select l.acquired_at into run_started_at
    from public.scheduling_planning_workspaces w
    join public.scheduling_planning_run_leases l
      on l.period_key = w.period_key and l.district = w.district
    where w.id = new.workspace_id and l.expires_at > clock_timestamp();
    -- A null flag time predates this migration, hence any run started after
    -- it (apply only while no planning lease is active), and may be cleared.
    if run_started_at is not null and old.needs_recalc_marked_at >= run_started_at then
      new.needs_recalc := true;
      new.needs_recalc_marked_at := old.needs_recalc_marked_at;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists scheduling_planning_rows_stamp_recalc on public.scheduling_planning_rows;
create trigger scheduling_planning_rows_stamp_recalc
  before insert or update of needs_recalc on public.scheduling_planning_rows
  for each row execute function public.scheduling_planning_rows_stamp_recalc();

-- True unless the edit can only keep or reduce the instructor's capacity.
-- Unknown shapes (inserts/deletes of weekly rules, profile inserts/deletes,
-- moved exception dates, unparsable times) fail open to the old behaviour.
create or replace function public.scheduling_instructor_change_may_add_capacity(
  p_table text, p_op text, p_before jsonb, p_after jsonb
) returns boolean language plpgsql immutable set search_path = public as $$
declare
  meta text[] := array['notes','updated_at','updated_by','created_at','created_by'];
  window_cols text[] := array['available','start_time','end_time'];
  b jsonb := coalesce(p_before, '{}'::jsonb) - meta;
  a jsonb := coalesce(p_after, '{}'::jsonb) - meta;
  inactive text[] := array['no','false','0'];
  after_active boolean := lower(btrim(coalesce(p_after->>'active', ''))) <> all(inactive);
  narrowed boolean;
begin
  if p_op = 'UPDATE' and b = a then return false; end if;

  if p_table = 'contacts_instructors' then
    if p_op = 'DELETE' then return false; end if;
    -- Deactivation, or edits to an instructor that stays inactive.
    if not after_active then return false; end if;
    return true;
  end if;

  if p_table = 'instructor_scheduling_profiles' then
    if p_op <> 'UPDATE' then return true; end if;
    if (b - array['default_start_time','default_end_time','friday_allowed'])
       is distinct from (a - array['default_start_time','default_end_time','friday_allowed']) then
      return true;
    end if;
    narrowed := (a->>'default_start_time')::time >= (b->>'default_start_time')::time
      and (a->>'default_end_time')::time <= (b->>'default_end_time')::time
      and not (coalesce((a->>'friday_allowed')::boolean, false)
               and not coalesce((b->>'friday_allowed')::boolean, false));
    return not coalesce(narrowed, false);
  end if;

  if p_table = 'instructor_availability_rules' then
    if p_op <> 'UPDATE' or (b - window_cols) is distinct from (a - window_cols) then return true; end if;
    narrowed := not coalesce((a->>'available')::boolean, true)
      or (coalesce((b->>'available')::boolean, true)
          and (a->>'start_time')::time >= (b->>'start_time')::time
          and (a->>'end_time')::time <= (b->>'end_time')::time);
    return not coalesce(narrowed, false);
  end if;

  if p_table = 'instructor_availability_exceptions' then
    -- A new unavailable date, or removing an extra-availability date.
    if p_op = 'INSERT' then return coalesce((a->>'available')::boolean, false); end if;
    if p_op = 'DELETE' then return not coalesce((b->>'available')::boolean, false); end if;
    if (b - window_cols) is distinct from (a - window_cols) then return true; end if;
    narrowed := not coalesce((a->>'available')::boolean, false)
      or (coalesce((b->>'available')::boolean, false)
          and (a->>'start_time')::time >= (b->>'start_time')::time
          and (a->>'end_time')::time <= (b->>'end_time')::time);
    return not coalesce(narrowed, false);
  end if;

  return true;
exception when others then
  -- Never block an instructor save; unknown input keeps the old broad marking.
  return true;
end $$;

revoke all on function public.scheduling_instructor_change_may_add_capacity(text,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.scheduling_planning_rows_stamp_recalc() from public, anon, authenticated;

create or replace function public.scheduling_track_planning_source_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  before_data jsonb := case when TG_OP <> 'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  after_data jsonb := case when TG_OP <> 'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  entity_ids text[];
  route_addresses text[];
  request_role text := coalesce((nullif(current_setting('request.jwt.claims', true),'')::jsonb)->>'role','');
begin
  if TG_OP = 'UPDATE' and before_data = after_data then return null; end if;
  if TG_TABLE_NAME = 'activities' and TG_OP = 'UPDATE'
    and public.scheduling_planning_source_activity_payload(before_data)=public.scheduling_planning_source_activity_payload(after_data) then return null; end if;
  if TG_TABLE_NAME = 'contacts_instructors' and TG_OP = 'UPDATE'
    and jsonb_build_array(before_data->'active', before_data->'address', before_data->'seniority_years')
      = jsonb_build_array(after_data->'active', after_data->'address', after_data->'seniority_years') then return null; end if;
  if TG_TABLE_NAME = 'scheduling_travel_cache' then
    route_addresses := array(select distinct lower(btrim(value)) from unnest(array[before_data->>'origin_address',before_data->>'destination_address',after_data->>'origin_address',after_data->>'destination_address']) value where nullif(btrim(value),'') is not null);
    if TG_OP = 'INSERT' then
      update public.scheduling_planning_rows r set needs_recalc=true where r.row_data->>'kind' in ('missing','recruitment') and public.scheduling_planning_route_affects_row(r,route_addresses);
      return null;
    end if;
    if TG_OP = 'UPDATE' and (before_data - array['updated_at','created_at','calculated_at','expires_at','last_used_at','id'])
      = (after_data - array['updated_at','created_at','calculated_at','expires_at','last_used_at','id']) then return null; end if;
    update public.scheduling_planning_rows r set needs_recalc=true where coalesce(r.row_data->>'kind','') <> 'live' and public.scheduling_planning_route_affects_row(r,route_addresses);
    if TG_OP = 'UPDATE' and request_role = 'service_role' then return null; end if;
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
  -- Unassigned rows can only become plannable when an instructor gains
  -- capacity. Deactivation, removed/narrowed availability, new unavailable
  -- dates and notes-only edits keep the source fence (revision bump above) but
  -- no longer flag every missing/recruitment row national-wide. The edited
  -- instructor's own proposals stay covered by the client dependency closure
  -- (context diff) and mark_scheduling_planning_needs_recalc_for_instructor.
  if TG_TABLE_NAME in ('contacts_instructors','instructor_scheduling_profiles',
    'instructor_availability_rules','instructor_availability_exceptions')
    and public.scheduling_instructor_change_may_add_capacity(TG_TABLE_NAME, TG_OP, before_data, after_data) then
    update public.scheduling_planning_rows set needs_recalc=true
    where row_data->>'kind' in ('recruitment','missing');
  end if;
  return null;
end $$;

revoke all on function public.scheduling_track_planning_source_change() from public;

create or replace function public.get_scheduling_planning_workspace(
  p_period_key text,
  p_district text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  workspace public.scheduling_planning_workspaces;
  editor_name text;
  rows_json jsonb;
begin
  if not public.app_has_permission('view_operations_scheduling') then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if scope_period is null then raise exception 'planning_period_required'; end if;

  select * into workspace
  from public.scheduling_planning_workspaces
  where period_key = scope_period and district = scope_district;

  if not found then
    return jsonb_build_object('workspace', null, 'rows', '[]'::jsonb);
  end if;

  select coalesce(u.full_name, u.name, u.email, '')
    into editor_name
  from public.users u
  where u.auth_user_id = workspace.updated_by
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'activityId', r.activity_id,
        'row', r.row_data,
        'activityUpdatedAt', r.activity_updated_at,
        'lockedOption', r.locked_option,
        'lockedAt', r.locked_at,
        'lockedBy', r.locked_by,
        'needsRecalc', r.needs_recalc,
        'needsRecalcMarkedAt', r.needs_recalc_marked_at
      )
      order by r.activity_id
    ),
    '[]'::jsonb
  ) into rows_json
  from public.scheduling_planning_rows r
  where r.workspace_id = workspace.id;

  return jsonb_build_object(
    'workspace', jsonb_build_object(
      'id', workspace.id,
      'periodKey', workspace.period_key,
      'district', workspace.district,
      'engineVersion', workspace.engine_version,
      'dataFingerprint', workspace.data_fingerprint,
      'contextFingerprint', workspace.context_fingerprint,
      'calculatedAt', workspace.calculated_at,
      'updatedAt', workspace.updated_at,
      'updatedBy', workspace.updated_by,
      'updatedByName', coalesce(editor_name, ''),
      'revision', workspace.revision
    ),
    'rows', rows_json
  );
end
$$;

revoke all on function public.get_scheduling_planning_workspace(text,text) from public;
grant execute on function public.get_scheduling_planning_workspace(text,text) to authenticated;
