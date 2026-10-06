-- Instructor contact edits such as phone/email/manager changes do not affect
-- scheduling inputs. Do not fence a planning run for those edits. Scheduling
-- consumes only active/address from the contact row plus seniority_years,
-- which is merged into the scheduling profile fingerprint.

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
  if TG_TABLE_NAME in ('contacts_instructors','instructor_scheduling_profiles',
    'instructor_availability_rules','instructor_availability_exceptions') then
    update public.scheduling_planning_rows set needs_recalc=true
    where row_data->>'kind' in ('recruitment','missing');
  end if;
  return null;
end $$;

revoke all on function public.scheduling_track_planning_source_change() from public;
