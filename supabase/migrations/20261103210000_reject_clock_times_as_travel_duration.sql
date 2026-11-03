-- Guard against treating cancellation clock timestamps as minute durations.
CREATE OR REPLACE FUNCTION public.av2_review_attendance_travel_compensation(p_source_id uuid, p_decision text, p_approved_minutes integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_name text;
  c public.attendance_travel_compensations%rowtype;
  s public.attendance_records%rowtype;
  before_json jsonb;
  decision text := lower(btrim(coalesce(p_decision, '')));
  approved integer;
  next_status text;
  requested integer;
begin
  if decision not in ('approve', 'correct', 'reject') then
    raise exception 'attendance_travel_decision_invalid' using errcode = '22023';
  end if;

  select
    lower(btrim(coalesce(u.role, ''))),
    coalesce(
      nullif(btrim(coalesce(u.full_name, '')), ''),
      nullif(btrim(coalesce(u.name, '')), ''),
      nullif(btrim(coalesce(u.username, '')), '')
    )
  into v_role, v_name
  from public.users u
  where u.auth_user_id = auth.uid() and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'attendance_auth_required' using errcode = '42501';
  end if;
  if v_role not in (
    'admin', 'operation_manager', 'activities_manager', 'manager', 'instructor_manager'
  ) then
    raise exception 'attendance_permission_denied' using errcode = '42501';
  end if;

  select * into s
  from public.attendance_records
  where id = p_source_id and generation_kind is null
  for update;
  if not found then
    raise exception 'attendance_source_not_found' using errcode = '22023';
  end if;

  if v_role in ('activities_manager', 'manager', 'instructor_manager')
     and not public.attendance_manager_can_review_employee(s.emp_id) then
    raise exception 'attendance_permission_denied' using errcode = '42501';
  end if;

  select * into c
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id
  for update;
  if not found then
    raise exception 'attendance_travel_not_applicable' using errcode = '22023';
  end if;

  before_json := public.av2_travel_compensation_snapshot(c);
  -- Clock-time fields are timestamps within a day, NOT durations.
  -- Only explicitly reported leg durations may be auto-approved.
  requested := case
    when c.reported_outbound_minutes is not null and c.reported_return_minutes is not null
      then public.av2_travel_cancellation_minutes(c.reported_outbound_minutes, c.reported_return_minutes)
    else null
  end;

  if decision = 'reject' then
    approved := 0;
    next_status := 'rejected';
  elsif decision = 'correct' then
    if p_approved_minutes is null or p_approved_minutes < 0 or p_approved_minutes > 360 then
      raise exception 'attendance_travel_minutes_invalid' using errcode = '22023';
    end if;
    approved := p_approved_minutes;
    next_status := 'corrected';
  else
    -- approve: require a guide report; use requested minutes
    if requested is null then
      raise exception 'attendance_travel_report_required' using errcode = '22023';
    end if;
    if requested > 360 then
      raise exception 'attendance_travel_minutes_exceeds_limit' using errcode = '22023';
    end if;
    approved := requested;
    next_status := 'approved';
  end if;

  update public.attendance_travel_compensations
  set review_status = next_status,
      approved_cancellation_minutes = approved,
      review_by = auth.uid(),
      review_at = now(),
      review_note = nullif(btrim(coalesce(p_note, '')), ''),
      override_by = case when next_status = 'corrected' then auth.uid() else null end,
      override_at = case when next_status = 'corrected' then now() else null end,
      manually_overridden = (next_status = 'corrected'),
      updated_at = now()
  where source_attendance_record_id = p_source_id
  returning * into c;

  perform public.av2_sync_travel_cancellation_payable(p_source_id);

  select * into c
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id;

  perform public.av2_append_travel_compensation_event(
    p_source_id, c.emp_id, next_status, before_json,
    public.av2_travel_compensation_snapshot(c), p_note
  );

  return to_jsonb(c);
end;
$function$

