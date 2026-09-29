-- Focused attendance corrections: persist training mode, exclude online training
-- from travel, and keep generated cancellation dates aligned with their source.

alter table public.attendance_records
  add column if not exists training_mode text;

alter table public.attendance_records
  drop constraint if exists attendance_records_training_mode_check;

alter table public.attendance_records
  add constraint attendance_records_training_mode_check
  check (training_mode is null or training_mode in ('physical', 'online'));

create or replace function public.av2_sync_operation_destination_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_address text;
  normalized_type text;
  normalized_name text;
begin
  if new.generation_kind is not null then return new; end if;

  normalized_type := regexp_replace(lower(btrim(coalesce(new.activity_type, ''))), '\s+', '', 'g');
  normalized_name := regexp_replace(lower(btrim(coalesce(new.activity_name_snapshot, ''))), '\s+', '', 'g');

  if normalized_type = 'הכשרה' and new.training_mode = 'online' then
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
