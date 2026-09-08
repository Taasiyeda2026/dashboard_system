-- Attendance V2: fixed operation destinations can participate in trusted travel calculations.
-- The destination is snapshotted on the attendance row so historical reports keep the address
-- that applied when the report was created/edited.

alter table public.attendance_operation_options
  add column if not exists address text;

alter table public.attendance_records
  add column if not exists destination_address_snapshot text;

update public.attendance_operation_options
set address = 'המרד 29, תל אביב', updated_at = now()
where lower(btrim(label)) = lower('הרמת כוסית');

create or replace function public.av2_sync_operation_destination_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_address text;
  normalized_type text;
begin
  if new.generation_kind is not null then
    return new;
  end if;

  normalized_type := regexp_replace(lower(btrim(coalesce(new.activity_type, ''))), '\s+', '', 'g');
  if normalized_type <> 'תפעול' then
    new.destination_address_snapshot := null;
    return new;
  end if;

  select nullif(btrim(o.address), '')
    into operation_address
  from public.attendance_operation_options o
  where lower(btrim(o.label)) = lower(btrim(coalesce(new.activity_name_snapshot, '')))
  limit 1;

  new.destination_address_snapshot := operation_address;
  return new;
end $$;

revoke all on function public.av2_sync_operation_destination_address() from public, anon, authenticated;

drop trigger if exists av2_sync_operation_destination_address on public.attendance_records;
create trigger av2_sync_operation_destination_address
before insert or update of activity_type, activity_name_snapshot
on public.attendance_records
for each row execute function public.av2_sync_operation_destination_address();

-- Backfill any existing operation reports that match a managed option.
update public.attendance_records r
set destination_address_snapshot = nullif(btrim(o.address), ''),
    updated_at = r.updated_at
from public.attendance_operation_options o
where r.generation_kind is null
  and regexp_replace(lower(btrim(coalesce(r.activity_type, ''))), '\s+', '', 'g') = 'תפעול'
  and lower(btrim(coalesce(r.activity_name_snapshot, ''))) = lower(btrim(o.label))
  and r.destination_address_snapshot is distinct from nullif(btrim(o.address), '');

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
  if excluded_type in ('זום', 'הכשרה', 'ביטולזמן') then
    return jsonb_build_object('eligible', false, 'source_id', s.id);
  end if;

  select nullif(btrim(ci.address), '')
    into instructor_address
  from public.contacts_instructors ci
  where ci.emp_id = v_emp
  limit 1;

  -- Managed operations may have a fixed destination without an activity/school row.
  if excluded_type = 'תפעול' then
    destination_address := nullif(btrim(s.destination_address_snapshot), '');
    if destination_address is null then
      return jsonb_build_object(
        'eligible', false,
        'source_id', s.id,
        'reason', 'operation_destination_missing'
      );
    end if;

    destination_key := 'operation:' || lower(btrim(coalesce(s.activity_name_snapshot, '')));
    fingerprint := encode(
      digest(
        concat_ws(
          '|',
          v_emp,
          lower(regexp_replace(coalesce(instructor_address, ''), '\s+', ' ', 'g')),
          destination_key,
          lower(regexp_replace(destination_address, '\s+', ' ', 'g')),
          'DRIVE'
        ),
        'sha256'
      ),
      'hex'
    );

    return jsonb_build_object(
      'eligible', true,
      'source_id', s.id,
      'emp_id', v_emp,
      'activity_row_id', null,
      'school_id', null,
      'school_name', '',
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
      concat_ws(
        '|',
        v_emp,
        lower(regexp_replace(coalesce(instructor_address, ''), '\s+', ' ', 'g')),
        a.row_id,
        s.school_id,
        lower(regexp_replace(coalesce(destination_address, ''), '\s+', ' ', 'g')),
        'DRIVE'
      ),
      'sha256'
    ),
    'hex'
  );

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

revoke all on function public.av2_attendance_travel_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.av2_attendance_travel_context(uuid, uuid) to service_role;

create or replace function public.av2_mark_source_travel_pending_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_emp bigint;
begin
  if new.generation_kind is not null then
    return new;
  end if;

  select emp_id::bigint
    into actor_emp
  from public.users
  where auth_user_id = auth.uid()
    and is_active = true
  limit 1;

  if actor_emp = new.emp_id and (
    tg_op = 'INSERT'
    or old.activity_row_id is distinct from new.activity_row_id
    or old.school_id is distinct from new.school_id
    or old.activity_type is distinct from new.activity_type
    or old.activity_name_snapshot is distinct from new.activity_name_snapshot
    or old.destination_address_snapshot is distinct from new.destination_address_snapshot
  ) then
    perform public.av2_prepare_attendance_travel(new.id, auth.uid());
  end if;

  return new;
end $$;
