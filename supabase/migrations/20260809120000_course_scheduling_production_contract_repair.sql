-- Idempotent production repair for a partially-applied scheduling release.
-- Deliberately does not replay the preceding migrations or mutate activity data.
-- Dependencies are defined before the trigger-backed validation functions that call them.

create or replace function public.scheduling_cached_travel_distance_km(
  p_origin text,
  p_destination text
) returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select stc.distance_km
  from public.scheduling_travel_cache stc
  where stc.origin_key = public.scheduling_normalize_location(p_origin)
    and stc.destination_key = public.scheduling_normalize_location(p_destination)
    and stc.expires_at > now()
  order by stc.calculated_at desc
  limit 1
$$;

revoke all on function public.scheduling_cached_travel_distance_km(text, text) from public;

create or replace function public.scheduling_assert_home_route(
  p_emp_id bigint,
  p_activity_id text
) returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  instructor_address text;
  target public.activities;
  activity_location text;
  home_km numeric;
begin
  select ci.address
  into instructor_address
  from public.contacts_instructors ci
  where ci.emp_id = p_emp_id;

  if not found then raise exception 'instructor_not_found'; end if;
  if nullif(btrim(coalesce(instructor_address, '')), '') is null then
    raise exception 'scheduling_instructor_profile_incomplete';
  end if;

  select * into target
  from public.activities a
  where a.row_id = p_activity_id;

  if not found then raise exception 'activity_not_found'; end if;
  activity_location := public.scheduling_school_location(
    target.school_id,
    target.school,
    target.authority_id,
    target.authority
  );
  if nullif(btrim(coalesce(activity_location, '')), '') is null then
    raise exception 'scheduling_home_route_unverified';
  end if;

  home_km := public.scheduling_cached_travel_distance_km(instructor_address, activity_location);
  if home_km is null then raise exception 'scheduling_home_route_unverified'; end if;
  if home_km > 40 then raise exception 'scheduling_home_distance_exceeded'; end if;
end
$$;

revoke all on function public.scheduling_assert_home_route(bigint, text) from public;

-- One canonical meeting source for official assignments and drafts. A proposed
-- draft calendar wins whenever present; cancellation markers always win over both.
create or replace function public.scheduling_effective_meetings(
  p_activity public.activities,
  p_emp_id bigint
) returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(item order by item->>'date'), '[]'::jsonb)
  from (
    select value as item
    from jsonb_array_elements(
      case
        when p_activity.draft_proposed_meetings is not null
          then p_activity.draft_proposed_meetings
        else public.scheduling_activity_official_meetings(p_activity)
      end
    ) proposed(value)
    where nullif(value->>'date', '') is not null
      and not exists (
        select 1
        from public.course_meeting_cancellations cancellation
        where cancellation.activity_id = p_activity.row_id
          and cancellation.meeting_date = (value->>'date')::date
      )
  ) effective
$$;

revoke all on function public.scheduling_effective_meetings(public.activities, bigint) from public;

-- Runtime RPC used by deployment/smoke verification. It checks the live catalog,
-- including trigger targets, rather than merely asserting that SQL text exists in Git.
create or replace function public.scheduling_runtime_contract()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  required_signatures text[] := array[
    'public.scheduling_cached_travel_distance_km(text,text)',
    'public.scheduling_assert_home_route(bigint,text)',
    'public.scheduling_effective_meetings(public.activities,bigint)',
    'public.scheduling_course_instructor_violations(text,bigint,boolean)',
    'public.scheduling_assert_assignment_calendar(text,bigint,jsonb)',
    'public.save_course_assignment_draft(text,bigint,text,bigint,integer,integer)',
    'public.save_course_assignment_draft_with_dates(text,bigint,text,jsonb,bigint,integer,integer)',
    'public.cancel_course_assignment_draft(text)',
    'public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text)',
    'public.assign_activity_instructor_with_dates(text,bigint,text,jsonb,bigint,integer,integer,text,text)',
    'public.reassign_locked_course_instructor(text,bigint,text,bigint,integer,integer,text,text)'
  ];
  missing_signatures text[];
  broken_triggers text[];
begin
  select coalesce(array_agg(signature order by signature), '{}')
  into missing_signatures
  from unnest(required_signatures) signature
  where to_regprocedure(signature) is null;

  select coalesce(array_agg(format('%I.%I', namespace.nspname, trigger_row.tgname)), '{}')
  into broken_triggers
  from pg_trigger trigger_row
  join pg_class relation on relation.oid = trigger_row.tgrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  left join pg_proc target_function on target_function.oid = trigger_row.tgfoid
  where not trigger_row.tgisinternal
    and namespace.nspname = 'public'
    and trigger_row.tgname ilike '%schedul%'
    and target_function.oid is null;

  return jsonb_build_object(
    'ok', cardinality(missing_signatures) = 0 and cardinality(broken_triggers) = 0,
    'missing_signatures', to_jsonb(missing_signatures),
    'broken_triggers', to_jsonb(broken_triggers),
    'checked_at', now()
  );
end
$$;

revoke all on function public.scheduling_runtime_contract() from public;
grant execute on function public.scheduling_runtime_contract() to authenticated;

