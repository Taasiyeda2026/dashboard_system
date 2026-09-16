-- Attendance travel cancellation audit: expose route endpoints and calculate each
-- cancellation from the instructor's actual physical attendance sequence for the day.

alter table public.attendance_travel_compensations
  add column if not exists route_origin_label text,
  add column if not exists route_origin_address text,
  add column if not exists route_destination_label text,
  add column if not exists route_destination_address text,
  add column if not exists return_to_home boolean not null default false,
  add column if not exists return_destination_label text,
  add column if not exists return_destination_address text,
  add column if not exists route_context_stale boolean not null default false;

create or replace function public.av2_attendance_route_point(p_record_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.attendance_records%rowtype;
  normalized_type text;
  point_address text;
  point_label text;
begin
  select * into r from public.attendance_records where id = p_record_id;
  if not found or r.generation_kind is not null then
    return jsonb_build_object('eligible', false);
  end if;

  normalized_type := regexp_replace(lower(btrim(coalesce(r.activity_type, ''))), '\s+', '', 'g');
  if normalized_type in ('זום', 'הכשרה', 'ביטולזמן') then
    return jsonb_build_object('eligible', false);
  end if;

  if normalized_type = 'תפעול' then
    point_address := nullif(btrim(r.destination_address_snapshot), '');
    if point_address is null then return jsonb_build_object('eligible', false); end if;
    point_label := coalesce(nullif(btrim(r.activity_name_snapshot), ''), 'תפעול');
    return jsonb_build_object(
      'eligible', true,
      'entity_key', 'operation:' || lower(point_label),
      'label', point_label,
      'address', point_address
    );
  end if;

  if r.school_id is null then return jsonb_build_object('eligible', false); end if;

  select coalesce(
           nullif(btrim(cs.address), ''),
           nullif(btrim(sc.institution_address), ''),
           nullif(btrim(sc.mailing_address), '')
         ),
         coalesce(nullif(btrim(r.school_name_snapshot), ''), nullif(btrim(sc.school_name), ''), nullif(btrim(r.activity_name_snapshot), ''), 'בית ספר')
    into point_address, point_label
  from public.schools sc
  left join public.contacts_schools cs on cs.school_id = sc.id
  where sc.id = r.school_id
  limit 1;

  if point_address is null then return jsonb_build_object('eligible', false); end if;
  return jsonb_build_object(
    'eligible', true,
    'entity_key', 'school_id:' || r.school_id,
    'label', point_label,
    'address', point_address
  );
end $$;

revoke all on function public.av2_attendance_route_point(uuid) from public, anon, authenticated;
grant execute on function public.av2_attendance_route_point(uuid) to service_role;

create or replace function public.av2_attendance_travel_context(p_source_id uuid, p_actor_id uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  s public.attendance_records%rowtype;
  a public.activities%rowtype;
  candidate record;
  v_emp bigint;
  instructor_address text;
  normalized_type text;
  valid_school boolean := false;
  current_point jsonb;
  previous_point jsonb := null;
  next_point jsonb := null;
  last_point jsonb := null;
  candidate_point jsonb;
  found_source boolean := false;
  origin_key text;
  origin_label text;
  origin_address text;
  destination_key text;
  destination_label text;
  destination_address text;
  return_to_home boolean := false;
  fingerprint text;
begin
  select u.emp_id::bigint into v_emp
  from public.users u
  where u.auth_user_id = p_actor_id and u.is_active = true
  limit 1;
  if v_emp is null then raise exception 'attendance_auth_required' using errcode = '42501'; end if;

  select * into s
  from public.attendance_records
  where id = p_source_id and emp_id = v_emp and generation_kind is null;
  if not found then raise exception 'attendance_source_not_found' using errcode = '22023'; end if;

  normalized_type := regexp_replace(lower(btrim(coalesce(s.activity_type, ''))), '\s+', '', 'g');
  if normalized_type in ('זום', 'הכשרה', 'ביטולזמן') then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  current_point := public.av2_attendance_route_point(s.id);
  if not coalesce((current_point->>'eligible')::boolean, false) then
    return jsonb_build_object('eligible', false, 'source_id', s.id, 'reason', 'destination_missing');
  end if;

  -- Preserve the existing trusted activity/school validation for ordinary activities.
  if normalized_type <> 'תפעול' then
    if s.activity_row_id is null or s.school_id is null then
      return jsonb_build_object('eligible', false, 'source_id', s.id);
    end if;
    select * into a from public.activities where row_id = s.activity_row_id limit 1;
    if not found or not (a.emp_id::text = v_emp::text or a.emp_id_2::text = v_emp::text) then
      return jsonb_build_object('eligible', false, 'source_id', s.id);
    end if;
    valid_school := a.school_id = s.school_id or exists (
      select 1 from public.activity_schools x
      where x.activity_id::text = a.row_id::text and x.school_id = s.school_id
    );
    if not valid_school then raise exception 'attendance_destination_invalid' using errcode = '42501'; end if;
  end if;

  select nullif(btrim(ci.address), '') into instructor_address
  from public.contacts_instructors ci where ci.emp_id = v_emp limit 1;

  -- Build the real physical sequence for the attendance report date.
  for candidate in
    select r.id
    from public.attendance_records r
    where r.emp_id = v_emp
      and r.report_date = s.report_date
      and r.generation_kind is null
    order by r.start_time nulls last, r.end_time nulls last, r.id
  loop
    candidate_point := public.av2_attendance_route_point(candidate.id);
    if not coalesce((candidate_point->>'eligible')::boolean, false) then continue; end if;

    if candidate.id = s.id then
      previous_point := last_point;
      found_source := true;
    elsif found_source then
      next_point := candidate_point;
      exit;
    end if;
    last_point := candidate_point;
  end loop;

  if not found_source then return jsonb_build_object('eligible', false, 'source_id', s.id); end if;

  if previous_point is null then
    origin_key := 'instructor:' || v_emp;
    origin_label := 'בית המדריך';
    origin_address := instructor_address;
  else
    origin_key := previous_point->>'entity_key';
    origin_label := previous_point->>'label';
    origin_address := previous_point->>'address';
  end if;

  destination_key := current_point->>'entity_key';
  destination_label := current_point->>'label';
  destination_address := current_point->>'address';
  return_to_home := next_point is null;

  -- Keep old single-activity fingerprints stable so historical single-stop calculations
  -- remain valid; sequence-aware days get a v2 fingerprint and are lazily recalculated.
  if previous_point is null and next_point is null then
    if normalized_type = 'תפעול' then
      fingerprint := encode(digest(concat_ws('|', v_emp,
        lower(regexp_replace(coalesce(instructor_address, ''), '\s+', ' ', 'g')),
        destination_key,
        lower(regexp_replace(coalesce(destination_address, ''), '\s+', ' ', 'g')),
        'DRIVE'), 'sha256'), 'hex');
    else
      fingerprint := encode(digest(concat_ws('|', v_emp,
        lower(regexp_replace(coalesce(instructor_address, ''), '\s+', ' ', 'g')),
        a.row_id, s.school_id,
        lower(regexp_replace(coalesce(destination_address, ''), '\s+', ' ', 'g')),
        'DRIVE'), 'sha256'), 'hex');
    end if;
  else
    fingerprint := encode(digest(concat_ws('|', 'DAILY_SEQUENCE_V2', v_emp, s.report_date,
      origin_key, lower(regexp_replace(coalesce(origin_address, ''), '\s+', ' ', 'g')),
      destination_key, lower(regexp_replace(coalesce(destination_address, ''), '\s+', ' ', 'g')),
      return_to_home::text,
      case when return_to_home then lower(regexp_replace(coalesce(instructor_address, ''), '\s+', ' ', 'g')) else '' end,
      'DRIVE'), 'sha256'), 'hex');
  end if;

  return jsonb_build_object(
    'eligible', true,
    'source_id', s.id,
    'emp_id', v_emp,
    'activity_row_id', s.activity_row_id,
    'school_id', s.school_id,
    'school_name', coalesce(s.school_name_snapshot, destination_label, ''),
    'origin_address', origin_address,
    'destination_address', destination_address,
    'origin_entity_key', origin_key,
    'destination_entity_key', destination_key,
    'origin_label', origin_label,
    'destination_label', destination_label,
    'return_to_home', return_to_home,
    'return_destination_label', case when return_to_home then 'בית המדריך' else null end,
    'return_destination_address', case when return_to_home then instructor_address else null end,
    'fingerprint', fingerprint,
    'report_date', s.report_date,
    'context_error', case
      when origin_address is null then 'origin_address_missing'
      when destination_address is null then 'destination_address_missing'
      when return_to_home and instructor_address is null then 'instructor_address_missing'
      else null end
  );
end $$;

revoke all on function public.av2_attendance_travel_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.av2_attendance_travel_context(uuid, uuid) to service_role;

create or replace function public.av2_prepare_attendance_travel(p_source_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx jsonb;
  old public.attendance_travel_compensations%rowtype;
  changed boolean;
begin
  ctx := public.av2_attendance_travel_context(p_source_id, p_actor_id);
  if not coalesce((ctx->>'eligible')::boolean, false) then
    delete from public.attendance_travel_compensations where source_attendance_record_id = p_source_id;
    return ctx;
  end if;

  select * into old from public.attendance_travel_compensations
  where source_attendance_record_id = p_source_id for update;
  changed := not found or old.route_context_fingerprint is distinct from ctx->>'fingerprint';

  if changed then
    if old.generated_attendance_record_id is not null then
      delete from public.attendance_records where id = old.generated_attendance_record_id;
    end if;
    insert into public.attendance_travel_compensations(
      source_attendance_record_id, emp_id, calculation_status, route_context_fingerprint,
      origin_entity_key, destination_entity_key,
      route_origin_label, route_origin_address, route_destination_label, route_destination_address,
      return_to_home, return_destination_label, return_destination_address,
      route_context_stale, manually_overridden, override_by, override_at,
      generated_attendance_record_id, failure_code, updated_at
    ) values (
      p_source_id, (ctx->>'emp_id')::bigint, 'pending', ctx->>'fingerprint',
      ctx->>'origin_entity_key', ctx->>'destination_entity_key',
      ctx->>'origin_label', ctx->>'origin_address', ctx->>'destination_label', ctx->>'destination_address',
      coalesce((ctx->>'return_to_home')::boolean, false), ctx->>'return_destination_label', ctx->>'return_destination_address',
      false, false, null, null, null, null, now()
    )
    on conflict(source_attendance_record_id) do update set
      calculation_status = 'pending', route_context_fingerprint = excluded.route_context_fingerprint,
      origin_entity_key = excluded.origin_entity_key, destination_entity_key = excluded.destination_entity_key,
      route_origin_label = excluded.route_origin_label, route_origin_address = excluded.route_origin_address,
      route_destination_label = excluded.route_destination_label, route_destination_address = excluded.route_destination_address,
      return_to_home = excluded.return_to_home, return_destination_label = excluded.return_destination_label,
      return_destination_address = excluded.return_destination_address, route_context_stale = false,
      outbound_travel_minutes = null, return_travel_minutes = null,
      calculated_cancellation_minutes = null, final_cancellation_minutes = null,
      manually_overridden = false, override_by = null, override_at = null,
      generated_attendance_record_id = null, failure_code = null, updated_at = now();
    return ctx || jsonb_build_object('context_changed', true, 'calculation_status', 'pending');
  end if;

  update public.attendance_travel_compensations set
    route_origin_label = ctx->>'origin_label', route_origin_address = ctx->>'origin_address',
    route_destination_label = ctx->>'destination_label', route_destination_address = ctx->>'destination_address',
    return_to_home = coalesce((ctx->>'return_to_home')::boolean, false),
    return_destination_label = ctx->>'return_destination_label', return_destination_address = ctx->>'return_destination_address',
    route_context_stale = false, updated_at = updated_at
  where source_attendance_record_id = p_source_id
  returning * into old;

  return ctx || (to_jsonb(old) - 'source_attendance_record_id' - 'emp_id') || jsonb_build_object('context_changed', false);
end $$;

revoke all on function public.av2_prepare_attendance_travel(uuid, uuid) from public, anon, authenticated;
grant execute on function public.av2_prepare_attendance_travel(uuid, uuid) to service_role;

-- Backfill audit labels for existing calculations without altering the approved minutes.
-- Multi-stop days are flagged stale until the instructor-side lazy reconciliation runs.
do $$
declare
  item record;
  ctx jsonb;
begin
  for item in
    select c.source_attendance_record_id, c.route_context_fingerprint, u.auth_user_id
    from public.attendance_travel_compensations c
    join public.attendance_records r on r.id = c.source_attendance_record_id
    join public.users u on u.emp_id::bigint = r.emp_id and u.is_active = true
    where u.auth_user_id is not null
  loop
    begin
      ctx := public.av2_attendance_travel_context(item.source_attendance_record_id, item.auth_user_id);
      if coalesce((ctx->>'eligible')::boolean, false) then
        update public.attendance_travel_compensations set
          route_origin_label = ctx->>'origin_label', route_origin_address = ctx->>'origin_address',
          route_destination_label = ctx->>'destination_label', route_destination_address = ctx->>'destination_address',
          return_to_home = coalesce((ctx->>'return_to_home')::boolean, false),
          return_destination_label = ctx->>'return_destination_label', return_destination_address = ctx->>'return_destination_address',
          route_context_stale = route_context_fingerprint is distinct from ctx->>'fingerprint'
        where source_attendance_record_id = item.source_attendance_record_id;
      end if;
    exception when others then
      null;
    end;
  end loop;
end $$;

-- Expose the route snapshot to manager attendance control.
drop function if exists public.get_payroll_attendance_travel_compensations(bigint[], date, date);
create function public.get_payroll_attendance_travel_compensations(
  p_employee_ids bigint[] default null, p_from_date date default null, p_to_date date default null
)
returns table(
  generated_record_id uuid,
  source_record_id uuid,
  origin_entity_key text,
  destination_entity_key text,
  route_origin_label text,
  route_origin_address text,
  route_destination_label text,
  route_destination_address text,
  return_to_home boolean,
  return_destination_label text,
  return_destination_address text,
  route_context_stale boolean,
  outbound_travel_minutes integer,
  return_travel_minutes integer,
  calculated_cancellation_minutes integer,
  final_cancellation_minutes integer,
  manually_overridden boolean,
  override_by_name text,
  override_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    select record_id from public.get_payroll_attendance_records(p_employee_ids, p_from_date, p_to_date)
  )
  select c.generated_attendance_record_id, c.source_attendance_record_id,
    c.origin_entity_key, c.destination_entity_key,
    c.route_origin_label, c.route_origin_address, c.route_destination_label, c.route_destination_address,
    c.return_to_home, c.return_destination_label, c.return_destination_address, c.route_context_stale,
    c.outbound_travel_minutes, c.return_travel_minutes,
    c.calculated_cancellation_minutes, c.final_cancellation_minutes, c.manually_overridden,
    coalesce(nullif(btrim(u.full_name), ''), nullif(btrim(u.name), ''), nullif(btrim(u.username), ''), ''),
    c.override_at
  from public.attendance_travel_compensations c
  join visible v on v.record_id = c.generated_attendance_record_id
  left join public.users u on u.auth_user_id = c.override_by
$$;

revoke all on function public.get_payroll_attendance_travel_compensations(bigint[], date, date) from public, anon;
grant execute on function public.get_payroll_attendance_travel_compensations(bigint[], date, date) to authenticated;
