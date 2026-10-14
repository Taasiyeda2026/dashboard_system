-- New print-kit holdings supplied 15 Oct 2026 may have no known source stockroom
-- or physical delivery date. Do not fabricate either. The replacement of old
-- production data is a separate, guarded, one-time transaction (not a seed).
alter table public.course_print_kit_distributions
  drop constraint if exists course_print_kit_distributions_source_location_check;
alter table public.course_print_kit_distributions
  add constraint course_print_kit_distributions_source_location_check
  check (source_location in ('warehouse', 'hila', 'idan', 'gil', 'unrecorded'));
alter table public.course_print_kit_distributions
  alter column delivered_at drop not null;

create schema if not exists private;
create table if not exists private.course_print_kit_replacement_audit (
  replacement_key text primary key,
  replaced_at timestamptz not null default now(),
  reason text not null,
  old_distributions jsonb not null,
  old_inventory jsonb not null,
  new_distributions jsonb not null
);
revoke all on private.course_print_kit_replacement_audit from public, anon, authenticated;

-- Existing return action must not silently lose a kit whose historical
-- source is unknown. Those holdings use the location-picker RPC below.
do $patch$
declare
  definition text;
  original text := E'  if not found then\n    return;\n  end if;\n\n  insert into public.course_print_kit_inventory';
  replacement text := E'  if not found then\n    return;\n  end if;\n\n  if v_distribution.source_location = ''unrecorded'' then\n    raise exception ''יש לבחור מיקום להחזרת הערכה. מיקום המסירה המקורי לא תועד.'' using errcode = ''22023'';\n  end if;\n\n  insert into public.course_print_kit_inventory';
begin
  select pg_get_functiondef(oid) into definition
  from pg_proc
  where pronamespace='public'::regnamespace and proname='return_course_print_kit'
    and pg_get_function_identity_arguments(oid)='p_course_id uuid, p_instructor_name text';
  if definition is null then
    raise exception 'return_course_print_kit signature not found';
  end if;
  if position(replacement in definition) = 0 then
    if position(original in definition) = 0 then
      raise exception 'return_course_print_kit guard anchor not found';
    end if;
    execute replace(definition, original, replacement);
  end if;
end
$patch$;

create or replace function public.return_course_print_kit_to_location(
  p_course_id uuid,
  p_instructor_name text,
  p_return_location text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_instructor text := btrim(coalesce(p_instructor_name,''));
  v_location text := lower(btrim(coalesce(p_return_location,'')));
  v_distribution public.course_print_kit_distributions%rowtype;
begin
  if not public.app_is_admin_or_operation_manager() then
    raise exception 'אין הרשאה להחזיר ערכות דפוס' using errcode = '42501';
  end if;
  if v_instructor = '' then
    raise exception 'שם המדריך חסר' using errcode = '22023';
  end if;
  if v_location not in ('warehouse','hila','idan','gil') then
    raise exception 'מיקום החזרת הערכה אינו תקין' using errcode = '22023';
  end if;
  select *
  into v_distribution
  from public.course_print_kit_distributions
  where course_id=p_course_id and instructor_name=v_instructor
  for update;
  if not found then return; end if;
  if v_distribution.source_location <> 'unrecorded' then
    raise exception 'מקור המסירה כבר מתועד. יש להשתמש בהחזרה הרגילה.' using errcode='22023';
  end if;
  insert into public.course_print_kit_inventory(course_id)
  values (p_course_id)
  on conflict (course_id) do nothing;
  update public.course_print_kit_inventory
  set warehouse_quantity = warehouse_quantity + case when v_location='warehouse' then 1 else 0 end,
      hila_quantity = hila_quantity + case when v_location='hila' then 1 else 0 end,
      idan_quantity = idan_quantity + case when v_location='idan' then 1 else 0 end,
      gil_quantity = gil_quantity + case when v_location='gil' then 1 else 0 end,
      updated_at=now()
  where course_id=p_course_id;
  delete from public.course_print_kit_distributions where id=v_distribution.id;
end
$fn$;

revoke all on function public.return_course_print_kit_to_location(uuid,text,text) from public, anon;
grant execute on function public.return_course_print_kit_to_location(uuid,text,text) to authenticated;
