-- New daily travel payroll record: one payable per instructor/day.
-- Starts 2026-11-04. Never change historical approved data.
create unique index if not exists attendance_one_daily_travel_payable
  on public.attendance_records(source_attendance_record_id)
  where generation_kind='daily_travel_cancellation';

CREATE OR REPLACE FUNCTION public.av2_attendance_record_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp_id bigint;
  v_internal_compensation_write boolean := coalesce(current_setting('app.av2_compensation_write', true), '') = '1';
  v_manager_review_write boolean := coalesce(current_setting('app.av2_manager_attendance_write', true), '') = '1';
begin
  if v_internal_compensation_write
     and new.generation_kind in ('travel_time_cancellation','daily_travel_cancellation')
     and new.source_attendance_record_id is not null then
    if new.emp_id is null or not exists (
      select 1
      from public.attendance_records source_row
      where source_row.id = new.source_attendance_record_id
        and source_row.emp_id = new.emp_id
        and source_row.generation_kind is null
    ) then
      raise exception 'Invalid generated travel cancellation source';
    end if;
    return new;
  end if;

  if v_manager_review_write then
    if new.emp_id is null
       or new.generation_kind is not null
       or new.source_attendance_record_id is not null
       or not public.attendance_manager_can_review_employee(new.emp_id)
       or not public.attendance_manager_month_allows_mutation(new.emp_id, new.report_date) then
      raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
    end if;
    return new;
  end if;

  select emp_id::bigint
    into v_emp_id
  from public.users
  where auth_user_id = auth.uid()
  limit 1;

  if v_emp_id is null then
    raise exception 'No authenticated user or missing users mapping';
  end if;

  new.emp_id := v_emp_id;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.av2_guard_generated_attendance_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op in ('INSERT','UPDATE') and new.generation_kind in ('travel_time_cancellation','daily_travel_cancellation')
    and current_setting('app.av2_compensation_write',true) is distinct from '1' then
    raise exception 'attendance_generated_record_protected' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $function$
;
CREATE OR REPLACE FUNCTION public.av2_sync_travel_cancellation_payable(p_source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.attendance_records%rowtype;
  c public.attendance_travel_compensations%rowtype;
  child uuid;
  approved integer;
begin
  perform set_config('app.av2_compensation_write', '1', true);

  select * into s
  from public.attendance_records
  where id = p_source_id and generation_kind is null
  for update;
  if not found then
    raise exception 'attendance_source_not_found' using errcode = '22023';
  end if;
  if s.report_date >= date '2026-11-04' then
    return jsonb_build_object('status','daily_travel_only');
  end if;

  select * into c
  from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id
  for update;
  if not found then
    return jsonb_build_object('status', 'missing');
  end if;

  approved := case
    when c.review_status in ('approved', 'corrected')
      then greatest(0, coalesce(c.approved_cancellation_minutes, 0))
    else 0
  end;

  if approved > 0 then
    insert into public.attendance_records(
      emp_id, report_date, start_time, end_time, total_hours, activity_type,
      activity_name_snapshot, authority_id, authority_name_snapshot, school_id,
      school_name_snapshot, roundtrip_km, public_transport, public_transport_cost,
      expenses, expense_details, notes, source_attendance_record_id, generation_kind,
      updated_at
    ) values (
      s.emp_id, s.report_date, null, null, approved / 60.0, 'ביטול זמן',
      'ביטול זמן מאושר', s.authority_id, s.authority_name_snapshot, s.school_id,
      s.school_name_snapshot, 0, false, 0, 0, null, null, s.id,
      'travel_time_cancellation', now()
    )
    on conflict (source_attendance_record_id) where generation_kind = 'travel_time_cancellation'
    do update set
      report_date = excluded.report_date,
      total_hours = excluded.total_hours,
      activity_name_snapshot = excluded.activity_name_snapshot,
      school_id = excluded.school_id,
      school_name_snapshot = excluded.school_name_snapshot,
      authority_id = excluded.authority_id,
      authority_name_snapshot = excluded.authority_name_snapshot,
      updated_at = now()
    returning id into child;
  else
    if c.generated_attendance_record_id is not null then
      delete from public.attendance_records where id = c.generated_attendance_record_id;
    end if;
    child := null;
  end if;

  update public.attendance_travel_compensations
  set final_cancellation_minutes = approved,
      generated_attendance_record_id = child,
      manually_overridden = (review_status = 'corrected'),
      updated_at = now()
  where source_attendance_record_id = p_source_id
  returning * into c;

  return to_jsonb(c);
end;
$function$
;
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
  if s.report_date >= date '2026-11-04' then
    raise exception 'attendance_daily_travel_review_required' using errcode='22023';
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
;
CREATE OR REPLACE FUNCTION public.av2_month_open_travel_reviews(p_emp_id bigint, p_month_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  result jsonb;
begin
  if p_emp_id is null then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;

  select lower(btrim(coalesce(u.role, '')))
  into v_role
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'attendance_auth_required' using errcode = '42501';
  end if;

  -- Instructors cannot enumerate another employee's open travel reviews.
  -- Team managers: only their reviewable employees. Admin/ops/finance: all.
  if v_role in ('admin', 'operation_manager', 'finance') then
    null;
  elsif v_role in (
    'activities_manager', 'manager', 'instructor_manager'
  ) then
    if not public.attendance_manager_can_review_employee(p_emp_id) then
      raise exception 'attendance_permission_denied' using errcode = '42501';
    end if;
  else
    raise exception 'attendance_permission_denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source_id', c.source_attendance_record_id,
    'review_status', c.review_status,
    'report_date', s.report_date
  )), '[]'::jsonb)
  into result
  from public.attendance_travel_compensations c
  join public.attendance_records s on s.id = c.source_attendance_record_id
  where c.emp_id = p_emp_id
    and to_char(s.report_date, 'YYYY-MM') = p_month_key
    and s.report_date < date '2026-11-04'
    and c.review_status in ('awaiting_report', 'auto_matched', 'pending_review');

  return result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.manager_finalize_attendance_month_review(p_employee_id text, p_month_key text, p_manager_name text, p_manager_pdf_sharepoint_url text DEFAULT NULL::text, p_manager_pdf_sharepoint_item_id text DEFAULT NULL::text, p_manager_pdf_file_name text DEFAULT NULL::text, p_manager_pdf_version integer DEFAULT NULL::integer, p_manager_approved_snapshot jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp_id bigint;
  v_role text;
  v_actor_name text;
  v_is_direct_manager boolean := false;
  v_row public.attendance_month_approvals%rowtype;
  v_pdf_url text := nullif(trim(coalesce(p_manager_pdf_sharepoint_url, '')), '');
  v_pdf_item_id text := nullif(trim(coalesce(p_manager_pdf_sharepoint_item_id, '')), '');
  v_pdf_file_name text := nullif(trim(coalesce(p_manager_pdf_file_name, '')), '');
  v_version integer;
  v_unapproved_count integer := 0;
  v_open_travel jsonb;
begin
  if coalesce(trim(p_month_key), '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_key' using errcode = '22023';
  end if;
  if coalesce(trim(p_employee_id), '') !~ '^[0-9]+$' then
    raise exception 'invalid_employee_id' using errcode = '22023';
  end if;
  v_emp_id := trim(p_employee_id)::bigint;

  select
    lower(trim(coalesce(u.role, ''))),
    coalesce(
      nullif(trim(coalesce(p_manager_name, '')), ''),
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
  into v_role, v_actor_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'payroll_attendance_auth_required' using errcode = '42501';
  end if;

  if v_role not in ('admin', 'operation_manager', 'activities_manager', 'manager', 'instructor_manager') then
    raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
  end if;

  if v_role in ('activities_manager', 'manager', 'instructor_manager') then
    select exists (
      select 1
      from public.contacts_instructors ci
      where ci.emp_id = v_emp_id
        and lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_actor_name, '')))
        and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
    ) into v_is_direct_manager;

    if not coalesce(v_is_direct_manager, false) then
      raise exception 'payroll_attendance_permission_denied' using errcode = '42501';
    end if;
  end if;

  if (v_pdf_url is null) <> (v_pdf_file_name is null) then
    raise exception 'manager_pdf_fields_incomplete' using errcode = '22023';
  end if;

  select *
  into v_row
  from public.attendance_month_approvals
  where emp_id = v_emp_id
    and month_key = p_month_key
  limit 1
  for update;

  if not found then
    raise exception 'attendance_month_submission_required' using errcode = '22023';
  end if;

  if coalesce(nullif(trim(v_row.status), ''), 'open') <> 'submitted' then
    raise exception 'attendance_month_not_submitted_for_manager_review' using errcode = '22023';
  end if;

  -- Source attendance rows only. Generated travel-cancellation payables are
  -- gated by av2_month_open_travel_reviews / approved_cancellation_minutes,
  -- not by a second attendance_manager_record_reviews pass.
  select count(*)::integer
  into v_unapproved_count
  from public.attendance_records ar
  where ar.emp_id = v_emp_id
    and to_char(ar.report_date, 'YYYY-MM') = p_month_key
    and ar.generation_kind is null
    and not exists (
      select 1
      from public.attendance_manager_record_reviews review
      where review.record_id = ar.id
        and review.status = 'approved'
        and review.approved_record_updated_at = ar.updated_at
    );

  if coalesce(v_unapproved_count, 0) > 0 then
    raise exception 'attendance_records_not_fully_approved' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.attendance_records ar
    where ar.emp_id=v_emp_id
      and to_char(ar.report_date,'YYYY-MM')=p_month_key
      and ar.report_date >= date '2026-11-04'
      and ar.generation_kind is null
      and ar.activity_type not in ('זום','ביטול זמן')
      and coalesce(ar.training_mode::text,'physical')<>'online'
      and coalesce(ar.operation_meeting_mode,'physical')<>'online'
      and not exists (
        select 1 from public.attendance_daily_travel_reports d
        where d.emp_id=ar.emp_id and d.travel_date=ar.report_date
          and d.review_status in ('approved','corrected')
      )
  ) then
    raise exception 'attendance_daily_travel_reviews_pending' using errcode='22023';
  end if;

  v_open_travel := public.av2_month_open_travel_reviews(v_emp_id, p_month_key);
  if jsonb_array_length(coalesce(v_open_travel, '[]'::jsonb)) > 0 then
    raise exception 'attendance_travel_reviews_pending:%', v_open_travel
      using errcode = '22023';
  end if;

  if v_pdf_url is not null then
    v_version := greatest(coalesce(p_manager_pdf_version, 0), coalesce(v_row.manager_pdf_version, 0) + 1);
  else
    v_version := coalesce(v_row.manager_pdf_version, 0);
  end if;

  update public.attendance_month_approvals
  set
    status = 'locked',
    manager_approved_at = now(),
    manager_approved_by_user_id = auth.uid(),
    manager_approved_by_name = coalesce(v_actor_name, ''),
    manager_pdf_sharepoint_url = coalesce(v_pdf_url, manager_pdf_sharepoint_url),
    manager_pdf_sharepoint_item_id = coalesce(v_pdf_item_id, manager_pdf_sharepoint_item_id),
    manager_pdf_file_name = coalesce(v_pdf_file_name, manager_pdf_file_name),
    manager_pdf_version = v_version,
    manager_approved_snapshot = coalesce(p_manager_approved_snapshot, '{}'::jsonb),
    updated_at = now()
  where emp_id = v_emp_id
    and month_key = p_month_key
  returning *
  into v_row;

  return jsonb_build_object(
    'employee_id', p_employee_id,
    'month_key', p_month_key,
    'status', v_row.status,
    'manager_approved_at', v_row.manager_approved_at,
    'manager_approved_by_name', v_row.manager_approved_by_name,
    'manager_pdf_sharepoint_url', v_row.manager_pdf_sharepoint_url,
    'manager_pdf_sharepoint_item_id', v_row.manager_pdf_sharepoint_item_id,
    'manager_pdf_file_name', v_row.manager_pdf_file_name,
    'manager_pdf_version', v_row.manager_pdf_version
  );
end
$function$
;
