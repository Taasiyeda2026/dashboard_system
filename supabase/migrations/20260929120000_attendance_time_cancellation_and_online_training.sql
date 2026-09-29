-- Focused attendance corrections: persist training mode, exclude online training
-- from travel, and keep generated cancellation dates aligned with their source.

alter table public.attendance_records
  add column if not exists training_mode text,
  add column if not exists training_schedule_id uuid references public.instructor_training_schedule(id) on delete set null;

alter table public.attendance_records
  drop constraint if exists attendance_records_training_mode_check;

alter table public.attendance_records
  add constraint attendance_records_training_mode_check
  check (training_mode is null or training_mode in ('physical', 'online'));

drop policy if exists instructor_training_schedule_read on public.instructor_training_schedule;
create policy instructor_training_schedule_read
on public.instructor_training_schedule
for select
to authenticated
using (
  public.app_current_role() = any (
    array['admin','operation_manager','activities_manager','instructor_manager','finance']::text[]
  )
  or (
    public.app_current_role() = 'instructor'
    and (
      participant_scope = 'open'
      or emp_id = (
        select u.emp_id::bigint
        from public.users u
        where u.auth_user_id = auth.uid() and u.is_active = true
        limit 1
      )
    )
  )
);

create or replace function public.av2_sync_operation_destination_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_address text;
  scheduled_training public.instructor_training_schedule%rowtype;
  normalized_type text;
  normalized_name text;
begin
  if new.generation_kind is not null then return new; end if;

  normalized_type := regexp_replace(lower(btrim(coalesce(new.activity_type, ''))), '\s+', '', 'g');
  normalized_name := regexp_replace(lower(btrim(coalesce(new.activity_name_snapshot, ''))), '\s+', '', 'g');

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
    new.authority_name_snapshot := nullif(btrim(scheduled_training.location_name), '');
    new.school_id := null;
    new.school_name_snapshot := null;
    new.semel_mosad := null;
    new.roundtrip_km := 0;
    new.public_transport := false;
    new.public_transport_cost := 0;
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
    select nullif(btrim(o.address), '') into operation_address
    from public.attendance_operation_options o
    where lower(btrim(o.label)) = lower(btrim(coalesce(new.activity_name_snapshot, '')))
    limit 1;
    new.destination_address_snapshot := operation_address;
  elsif normalized_type = 'הכשרה'
    and normalized_name = regexp_replace(lower('הכשרת בסיס'), '\s+', '', 'g') then
    new.destination_address_snapshot := '6RVR+XM, יקום';
  else
    new.destination_address_snapshot := null;
  end if;
  return new;
end $$;

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
  v_emp bigint;
  instructor_address text;
  destination_address text;
  school_name text;
  valid_school boolean := false;
  fingerprint text;
  excluded_type text;
  normalized_name text;
  destination_key text;
begin
  select u.emp_id::bigint
    into v_emp
  from public.users u
  where u.auth_user_id = p_actor_id
    and u.is_active = true
  limit 1;

  if v_emp is null then
    raise exception 'attendance_auth_required' using errcode = '42501';
  end if;

  select *
    into s
  from public.attendance_records
  where id = p_source_id
    and emp_id = v_emp
    and generation_kind is null;

  if not found then
    raise exception 'attendance_source_not_found' using errcode = '22023';
  end if;

  excluded_type := regexp_replace(lower(btrim(coalesce(s.activity_type, ''))), '\s+', '', 'g');
  normalized_name := regexp_replace(lower(btrim(coalesce(s.activity_name_snapshot, ''))), '\s+', '', 'g');

  if excluded_type in ('זום', 'ביטולזמן')
     or (excluded_type = 'הכשרה' and s.training_mode = 'online') then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  select nullif(btrim(ci.address), '')
    into instructor_address
  from public.contacts_instructors ci
  where ci.emp_id = v_emp
  limit 1;

  if excluded_type = 'תפעול'
     or (excluded_type = 'הכשרה'
       and (s.training_schedule_id is not null
         or normalized_name = regexp_replace(lower('הכשרת בסיס'), '\s+', '', 'g'))) then
    destination_address := nullif(btrim(s.destination_address_snapshot), '');

    if destination_address is null then
      return jsonb_build_object(
        'eligible', false,
        'source_id', s.id,
        'reason', case
          when excluded_type = 'הכשרה' then 'training_destination_missing'
          else 'operation_destination_missing'
        end
      );
    end if;

    destination_key := case
      when excluded_type = 'הכשרה' and s.training_schedule_id is not null
        then 'training_schedule:' || s.training_schedule_id::text
      when excluded_type = 'הכשרה' then 'training:base_training'
      else 'operation:' || lower(btrim(coalesce(s.activity_name_snapshot, '')))
    end;

    fingerprint := encode(
      digest(
        concat_ws('|', v_emp,
          lower(regexp_replace(coalesce(instructor_address, ''), '\s+', ' ', 'g')),
          destination_key,
          lower(regexp_replace(destination_address, '\s+', ' ', 'g')),
          'DRIVE'),
        'sha256'),
      'hex');

    return jsonb_build_object(
      'eligible', true,
      'source_id', s.id,
      'emp_id', v_emp,
      'activity_row_id', null,
      'school_id', s.school_id,
      'school_name', coalesce(s.school_name_snapshot, ''),
      'origin_address', instructor_address,
      'destination_address', destination_address,
      'origin_entity_key', 'instructor:' || v_emp,
      'destination_entity_key', destination_key,
      'fingerprint', fingerprint,
      'report_date', s.report_date,
      'context_error', case
        when instructor_address is null then 'instructor_address_missing'
        else null
      end
    );
  end if;

  -- Other training records do not have a trusted fixed destination.
  if excluded_type = 'הכשרה' then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  if s.activity_row_id is null or s.school_id is null then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  select *
    into a
  from public.activities
  where row_id = s.activity_row_id
  limit 1;

  if not found or not (a.emp_id::text = v_emp::text or a.emp_id_2::text = v_emp::text) then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  valid_school := a.school_id = s.school_id or exists (
    select 1
    from public.activity_schools x
    where x.activity_id::text = a.row_id::text
      and x.school_id = s.school_id
  );
  if not valid_school then
    raise exception 'attendance_destination_invalid' using errcode = '42501';
  end if;

  select coalesce(
           nullif(btrim(cs.address), ''),
           nullif(btrim(sc.institution_address), ''),
           nullif(btrim(sc.mailing_address), '')
         ),
         sc.school_name
    into destination_address, school_name
  from public.schools sc
  left join public.contacts_schools cs on cs.school_id = sc.id
  where sc.id = s.school_id
  limit 1;

  fingerprint := encode(
    digest(
      concat_ws('|', v_emp,
        lower(regexp_replace(coalesce(instructor_address, ''), '\s+', ' ', 'g')),
        a.row_id,
        s.school_id,
        lower(regexp_replace(coalesce(destination_address, ''), '\s+', ' ', 'g')),
        'DRIVE'),
      'sha256'),
    'hex');

  return jsonb_build_object(
    'eligible', true,
    'source_id', s.id,
    'emp_id', v_emp,
    'activity_row_id', a.row_id,
    'school_id', s.school_id,
    'school_name', coalesce(school_name, s.school_name_snapshot, ''),
    'origin_address', instructor_address,
    'destination_address', destination_address,
    'origin_entity_key', 'instructor:' || v_emp,
    'destination_entity_key', 'school_id:' || s.school_id,
    'fingerprint', fingerprint,
    'report_date', s.report_date,
    'context_error', case
      when instructor_address is null then 'instructor_address_missing'
      when destination_address is null then 'destination_address_missing'
      else null
    end
  );
end $$;


create or replace function public.av2_mark_source_travel_pending_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_emp bigint;
  route_context_changed boolean := false;
begin
  if new.generation_kind is not null then return new; end if;
  select emp_id::bigint into actor_emp
  from public.users
  where auth_user_id = auth.uid() and is_active = true
  limit 1;

  if tg_op = 'INSERT' then
    route_context_changed := true;
  else
    route_context_changed := old.activity_type is distinct from new.activity_type
      or old.activity_name_snapshot is distinct from new.activity_name_snapshot
      or old.activity_row_id is distinct from new.activity_row_id
      or old.authority_id is distinct from new.authority_id
      or old.authority_name_snapshot is distinct from new.authority_name_snapshot
      or old.school_id is distinct from new.school_id
      or old.school_name_snapshot is distinct from new.school_name_snapshot
      or old.destination_address_snapshot is distinct from new.destination_address_snapshot
      or old.training_mode is distinct from new.training_mode
      or old.training_schedule_id is distinct from new.training_schedule_id;
  end if;

  if actor_emp = new.emp_id and route_context_changed then
    if tg_op = 'UPDATE' then
      perform set_config('app.av2_compensation_write', '1', true);
      delete from public.attendance_records child
      where child.source_attendance_record_id = new.id
        and child.generation_kind = 'travel_time_cancellation';
      delete from public.attendance_travel_compensations
      where source_attendance_record_id = new.id;
    end if;
    perform public.av2_prepare_attendance_travel(new.id, auth.uid());
  end if;
  return new;
end $$;

create or replace function public.av2_sync_generated_cancellation_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.generation_kind is null and old.report_date is distinct from new.report_date then
    perform set_config('app.av2_compensation_write', '1', true);
    update public.attendance_records child
    set report_date = new.report_date, updated_at = now()
    where child.source_attendance_record_id = new.id
      and child.generation_kind = 'travel_time_cancellation';
  end if;
  return new;
end $$;

drop trigger if exists av2_sync_generated_cancellation_date on public.attendance_records;
create trigger av2_sync_generated_cancellation_date
after update of report_date on public.attendance_records
for each row execute function public.av2_sync_generated_cancellation_date();

update public.attendance_records
set roundtrip_km = 0,
    public_transport = false,
    public_transport_cost = 0,
    authority_id = null,
    authority_name_snapshot = null,
    school_id = null,
    school_name_snapshot = null,
    semel_mosad = null,
    destination_address_snapshot = null,
    updated_at = now()
where generation_kind is null
  and regexp_replace(lower(btrim(coalesce(activity_type, ''))), '\s+', '', 'g') = 'הכשרה'
  and training_mode = 'online';
