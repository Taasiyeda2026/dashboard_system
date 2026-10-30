-- Issue #2523: definition-only fixes; no historical data repair or backfill.
-- Preserve existing ACLs, payroll decisions, reported km and source attendance.
-- CREATE OR REPLACE keeps function identity and current execute grants.
begin;

create or replace function public.av2_prepare_attendance_travel(
  p_source_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx jsonb;
  old public.attendance_travel_compensations%rowtype;
  changed boolean;
  locked_decision boolean;
  before_json jsonb;
begin
  ctx := public.av2_attendance_travel_context(p_source_id, p_actor_id);

  select * into old
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id
  for update;

  locked_decision := found and old.review_status in ('approved', 'corrected', 'rejected');

  -- Physical → online / ineligible: never delete locked manager decisions or their payables.
  if not coalesce((ctx->>'eligible')::boolean, false) then
    if not found then
      return ctx;
    end if;
    if locked_decision then
      before_json := public.av2_travel_compensation_snapshot(old);
      perform set_config('app.av2_compensation_write', '1', true);
      update public.attendance_travel_compensations
      set calculation_status = 'unavailable',
          failure_code = 'context_not_eligible',
          -- Keep NOT NULL fingerprint; mark ineligible without wiping locked pay.
          route_context_fingerprint = coalesce(
            old.route_context_fingerprint,
            'ineligible:' || p_source_id::text
          ),
          origin_entity_key = null,
          destination_entity_key = null,
          outbound_travel_minutes = null,
          return_travel_minutes = null,
          calculated_cancellation_minutes = null,
          system_distance_km = null,
          updated_at = now()
      where source_attendance_record_id = p_source_id
      returning * into old;
      perform public.av2_append_travel_compensation_event(
        p_source_id, old.emp_id, 'route_recalculated', before_json,
        public.av2_travel_compensation_snapshot(old),
        'preserve locked decision after ineligible context'
      );
      return ctx || jsonb_build_object(
        'context_changed', true,
        'locked_decision_preserved', true,
        'review_status', old.review_status,
        'approved_cancellation_minutes', old.approved_cancellation_minutes
      );
    end if;

    perform set_config('app.av2_compensation_write', '1', true);
    if old.generated_attendance_record_id is not null then
      delete from public.attendance_records where id = old.generated_attendance_record_id;
    end if;
    delete from public.attendance_travel_compensations
    where source_attendance_record_id = p_source_id;
    return ctx;
  end if;

  changed := not found or old.route_context_fingerprint is distinct from ctx->>'fingerprint';

  if changed then
    perform set_config('app.av2_compensation_write', '1', true);
    if found and old.generated_attendance_record_id is not null and not locked_decision then
      delete from public.attendance_records where id = old.generated_attendance_record_id;
    end if;

    insert into public.attendance_travel_compensations(
      source_attendance_record_id, emp_id, calculation_status, route_context_fingerprint,
      origin_entity_key, destination_entity_key,
      reported_outbound_minutes, reported_return_minutes, reported_at, reported_by,
      review_status, approved_cancellation_minutes, review_by, review_at, review_note,
      manually_overridden, override_by, override_at, generated_attendance_record_id,
      failure_code, final_cancellation_minutes, updated_at
    ) values (
      p_source_id, (ctx->>'emp_id')::bigint, 'pending', ctx->>'fingerprint',
      ctx->>'origin_entity_key', ctx->>'destination_entity_key',
      null, null, null, null,
      'none', null, null, null, null,
      false, null, null,
      case when locked_decision then old.generated_attendance_record_id else null end,
      null, 0, now()
    )
    on conflict (source_attendance_record_id) do update set
      calculation_status = 'pending',
      route_context_fingerprint = excluded.route_context_fingerprint,
      origin_entity_key = excluded.origin_entity_key,
      destination_entity_key = excluded.destination_entity_key,
      outbound_travel_minutes = null,
      return_travel_minutes = null,
      calculated_cancellation_minutes = null,
      system_distance_km = null,
      failure_code = null,
      -- Preserve guide report.
      reported_outbound_minutes = public.attendance_travel_compensations.reported_outbound_minutes,
      reported_return_minutes = public.attendance_travel_compensations.reported_return_minutes,
      reported_at = public.attendance_travel_compensations.reported_at,
      reported_by = public.attendance_travel_compensations.reported_by,
      -- Preserve locked manager decision; otherwise recompute later after system calc.
      review_status = case
        when public.attendance_travel_compensations.review_status in ('approved', 'corrected', 'rejected')
          then public.attendance_travel_compensations.review_status
        when public.attendance_travel_compensations.reported_outbound_minutes is not null
          then 'pending_review'
        when exists (
          select 1 from public.attendance_records sr
          where sr.id = p_source_id and sr.cancellation_before_minutes is not null
        ) then 'pending_review'
        else 'none'
      end,
      approved_cancellation_minutes = case
        when public.attendance_travel_compensations.review_status in ('approved', 'corrected', 'rejected')
          then public.attendance_travel_compensations.approved_cancellation_minutes
        else null
      end,
      review_by = public.attendance_travel_compensations.review_by,
      review_at = public.attendance_travel_compensations.review_at,
      review_note = public.attendance_travel_compensations.review_note,
      manually_overridden = public.attendance_travel_compensations.manually_overridden,
      override_by = public.attendance_travel_compensations.override_by,
      override_at = public.attendance_travel_compensations.override_at,
      generated_attendance_record_id = case
        when public.attendance_travel_compensations.review_status in ('approved', 'corrected')
          then public.attendance_travel_compensations.generated_attendance_record_id
        else null
      end,
      final_cancellation_minutes = case
        when public.attendance_travel_compensations.review_status in ('approved', 'corrected')
          then public.attendance_travel_compensations.final_cancellation_minutes
        else 0
      end,
      updated_at = now();
  end if;

  if changed then
    return ctx || jsonb_build_object('context_changed', true, 'calculation_status', 'pending');
  end if;
  return ctx || (to_jsonb(old) - 'source_attendance_record_id' - 'emp_id')
           || jsonb_build_object('context_changed', false);
end;
$$;

create or replace function public.av2_reconcile_attendance_travel(
  p_source_id uuid,
  p_fingerprint text,
  p_outbound integer,
  p_return integer,
  p_failure_code text default null,
  p_distance_km numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.attendance_travel_compensations%rowtype;
  before_json jsonb;
  calculated integer;
  next_status text;
  locked_decision boolean;
begin
  select * into c
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id
  for update;
  if not found or c.route_context_fingerprint is distinct from p_fingerprint then
    raise exception 'attendance_travel_context_stale';
  end if;

  before_json := public.av2_travel_compensation_snapshot(c);
  locked_decision := c.review_status in ('approved', 'corrected', 'rejected');

  if p_failure_code is not null then
    update public.attendance_travel_compensations
    set calculation_status = 'unavailable',
        failure_code = left(p_failure_code, 80),
        outbound_travel_minutes = null,
        return_travel_minutes = null,
        calculated_cancellation_minutes = null,
        system_distance_km = null,
        review_status = case
          when locked_decision then review_status
          when reported_outbound_minutes is not null and reported_return_minutes is not null
            then 'pending_review'
          when exists (
            select 1 from public.attendance_records a
            where a.id = p_source_id and a.cancellation_before_minutes is not null
          ) then 'pending_review'
          else 'none'
        end,
        updated_at = now()
    where source_attendance_record_id = p_source_id
    returning * into c;

    perform public.av2_append_travel_compensation_event(
      p_source_id, c.emp_id, 'route_recalculated', before_json,
      public.av2_travel_compensation_snapshot(c), p_failure_code
    );
    return to_jsonb(c) || jsonb_build_object('status', 'unavailable');
  end if;

  if p_outbound is null or p_return is null or p_outbound < 0 or p_return < 0 then
    raise exception 'attendance_travel_minutes_invalid';
  end if;

  calculated := public.av2_travel_cancellation_minutes(p_outbound, p_return);
  next_status := public.av2_compute_source_travel_review_status(
    p_source_id,
    c.reported_outbound_minutes,
    c.reported_return_minutes,
    p_outbound,
    p_return,
    calculated,
    p_distance_km,
    'resolved',
    case when locked_decision then c.review_status else null end
  );

  update public.attendance_travel_compensations
  set calculation_status = 'resolved',
      outbound_travel_minutes = p_outbound,
      return_travel_minutes = p_return,
      calculated_cancellation_minutes = calculated,
      -- Satisfy resolved_shape in this UPDATE, before the payable sync runs.
      -- A system estimate never grants payment or replaces a manager decision.
      final_cancellation_minutes = case
        when locked_decision then coalesce(c.final_cancellation_minutes, c.approved_cancellation_minutes, 0)
        else 0
      end,
      system_distance_km = p_distance_km,
      failure_code = null,
      calculated_at = now(),
      review_status = next_status,
      -- Preserve guide report and manager decision; never auto-approve payroll.
      approved_cancellation_minutes = case
        when locked_decision then approved_cancellation_minutes
        else null
      end,
      updated_at = now()
  where source_attendance_record_id = p_source_id
  returning * into c;

  -- System calculation must not mint payable hours. Sync only clears unapproved
  -- generated rows or refreshes already-approved payables after route metadata changes.
  perform public.av2_sync_travel_cancellation_payable(p_source_id);

  select * into c
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id;

  perform public.av2_append_travel_compensation_event(
    p_source_id, c.emp_id,
    case next_status
      when 'auto_matched' then 'auto_matched'
      when 'awaiting_report' then 'awaiting_report'
      when 'pending_review' then 'pending_review'
      else 'system_calculated'
    end,
    before_json, public.av2_travel_compensation_snapshot(c), null
  );

  return to_jsonb(c) || jsonb_build_object('status', 'resolved');
end;
$$;

CREATE OR REPLACE FUNCTION public.av2_sync_operation_destination_address()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  operation_address text;
  scheduled_training public.instructor_training_schedule%rowtype;
  normalized_type text;
  normalized_name text;
begin
  if new.generation_kind is not null then return new; end if;

  normalized_type := regexp_replace(lower(btrim(coalesce(new.activity_type, ''))), '\s+', '', 'g');
  normalized_name := regexp_replace(lower(btrim(coalesce(new.activity_name_snapshot, ''))), '\s+', '', 'g');
  if normalized_type <> 'תפעול' then new.operation_meeting_mode := null; end if;

  if normalized_type = 'הכשרה' and new.training_schedule_id is not null then
    select * into scheduled_training
    from public.instructor_training_schedule t
    where t.id = new.training_schedule_id
      and t.is_active = true
      and t.training_date = new.report_date
      and (t.emp_id = new.emp_id or t.participant_scope = 'open');
    if not found then
      raise exception 'attendance_training_schedule_invalid' using errcode = '42501';
    end if;
    new.training_mode := case when scheduled_training.is_online then 'online' else 'physical' end;
    new.authority_id := null;
    new.authority_name_snapshot := case
      when scheduled_training.is_online then null
      else nullif(btrim(scheduled_training.location_name), '')
    end;
    new.school_id := null;
    new.school_name_snapshot := null;
    new.semel_mosad := null;
    if scheduled_training.is_online then
      new.roundtrip_km := 0;
      new.public_transport := false;
      new.public_transport_cost := 0;
    end if;
    new.destination_address_snapshot := case
      when scheduled_training.is_online then null
      else nullif(btrim(scheduled_training.location_address), '')
    end;
  elsif normalized_type = 'הכשרה' and new.training_mode = 'online' then
    new.roundtrip_km := 0;
    new.public_transport := false;
    new.public_transport_cost := 0;
    new.authority_id := null;
    new.authority_name_snapshot := null;
    new.school_id := null;
    new.school_name_snapshot := null;
    new.semel_mosad := null;
    new.destination_address_snapshot := null;
  elsif normalized_type = 'תפעול' then
    if normalized_name = 'צוות' then
      if new.operation_meeting_mode is null or new.operation_meeting_mode not in ('online', 'physical') then
        raise exception 'attendance_team_meeting_mode_required' using errcode = '23514';
      end if;
      if new.operation_meeting_mode = 'online' then
        new.destination_address_snapshot := null;
        new.roundtrip_km := 0;
        new.public_transport := false;
        new.public_transport_cost := 0;
      else
        new.destination_address_snapshot := nullif(btrim(new.destination_address_snapshot), '');
        if new.destination_address_snapshot is null then
          raise exception 'attendance_team_physical_location_required' using errcode = '23514';
        end if;
      end if;
    else
      new.operation_meeting_mode := null;
      select nullif(btrim(o.address), '') into operation_address
      from public.attendance_operation_options o
      where lower(btrim(o.label)) = lower(btrim(coalesce(new.activity_name_snapshot, '')))
      limit 1;
      new.destination_address_snapshot := operation_address;
    end if;
  elsif normalized_type = 'הכשרה'
    and normalized_name = regexp_replace(lower('הכשרת בסיס'), '\s+', '', 'g') then
    new.destination_address_snapshot := '6RVR+XM, יקום';
  elsif normalized_type = 'הכשרה' and new.training_mode = 'physical' then
    -- Preserve the instructor's explicit venue for ordinary physical training.
    new.destination_address_snapshot := nullif(btrim(new.destination_address_snapshot), '');
  else
    new.destination_address_snapshot := null;
  end if;
  return new;
end $function$;

create or replace function public.get_payroll_attendance_location_contexts(
  p_employee_ids bigint[] default null,
  p_from_date date default null,
  p_to_date date default null
)
returns table(
  record_id uuid,
  origin_address text,
  destination_address text,
  destination_entity_key text,
  destination_type text,
  is_remote boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with visible as (
    select r.record_id
    from public.get_payroll_attendance_records(p_employee_ids,p_from_date,p_to_date) r
  ),
  base as (
    select
      ar.id,
      nullif(btrim(ci.address), '') as origin_address,
      ar.school_id,
      ar.activity_type,
      ar.training_mode,
      ar.operation_meeting_mode,
      ar.activity_name_snapshot,
      ar.program_name,
      ar.school_name_snapshot,
      nullif(btrim(ar.destination_address_snapshot), '') as snapshot_address,
      coalesce(
        nullif(btrim(cs.address), ''),
        nullif(btrim(sc.institution_address), ''),
        nullif(btrim(sc.mailing_address), '')
      ) as school_address,
      c.destination_entity_key
    from public.attendance_records ar
    join visible v on v.record_id = ar.id
    left join public.contacts_instructors ci on ci.emp_id = ar.emp_id
    left join public.schools sc on sc.id = ar.school_id
    left join public.contacts_schools cs on cs.school_id = ar.school_id
    left join public.attendance_travel_compensations c
      on c.source_attendance_record_id = ar.id
  )
  select
    b.id,
    b.origin_address,
    coalesce(b.snapshot_address, b.school_address) as destination_address,
    coalesce(
      nullif(btrim(b.destination_entity_key), ''),
      case
        when b.school_id is not null then 'school_id:' || b.school_id::text
        when coalesce(b.snapshot_address, '') <> '' then
          case
            when regexp_replace(lower(btrim(coalesce(b.activity_type,''))), '\s+', '', 'g') = 'הכשרה'
             and regexp_replace(lower(btrim(coalesce(b.activity_name_snapshot,''))), '\s+', '', 'g') = 'הכשרתבסיס'
              then 'training:base_training'
            when regexp_replace(lower(btrim(coalesce(b.activity_type,''))), '\s+', '', 'g') = 'תפעול'
              then 'operation:' || lower(btrim(coalesce(b.activity_name_snapshot,b.program_name,'תפעול')))
            when regexp_replace(lower(btrim(coalesce(b.activity_type,''))), '\s+', '', 'g') = 'הכשרה'
              then 'location:training:' ||
                   lower(regexp_replace(btrim(coalesce(b.activity_name_snapshot,b.program_name,b.school_name_snapshot,'הכשרה')), '\s+', ' ', 'g')) ||
                   ':' || lower(regexp_replace(b.snapshot_address, '\s+', ' ', 'g'))
            else
              'location:external:' ||
              lower(regexp_replace(btrim(coalesce(b.activity_name_snapshot,b.program_name,b.school_name_snapshot,'יעד חיצוני')), '\s+', ' ', 'g')) ||
              ':' || lower(regexp_replace(b.snapshot_address, '\s+', ' ', 'g'))
          end
        else null
      end
    ) as destination_entity_key,
    case
      when ((b.activity_type = 'הכשרה' and b.training_mode = 'online')
        or (b.activity_type = 'תפעול' and b.operation_meeting_mode = 'online')
        or lower(concat_ws(' ',coalesce(b.activity_type,''),coalesce(b.activity_name_snapshot,''),coalesce(b.program_name,''))) ~ '(zoom|זום)')
        then 'remote'
      when b.school_id is not null then 'school'
      when coalesce(b.snapshot_address,'') <> '' then 'location'
      else 'unknown'
    end as destination_type,
    ((b.activity_type = 'הכשרה' and b.training_mode = 'online')
        or (b.activity_type = 'תפעול' and b.operation_meeting_mode = 'online')
        or lower(concat_ws(' ',coalesce(b.activity_type,''),coalesce(b.activity_name_snapshot,''),coalesce(b.program_name,''))) ~ '(zoom|זום)') as is_remote
  from base b
$$;

commit;
