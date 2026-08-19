-- Repair three school_2027 activities whose activity_type/item_type were corrupted to
-- the legacy proposal label "תוכנית", and harden the activities table against repeats.
--
-- Verification query (must return 0 after this migration):
--   select count(*) from public.activities
--   where trim(coalesce(activity_type, '')) = 'תוכנית'
--      or trim(coalesce(item_type, '')) = 'תוכנית';

create or replace function public.normalize_activities_type_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_legacy_course constant text[] := array['תוכנית', 'תכנית', 'program', 'programs', 'קורס', 'קורסים'];
begin
  if trim(coalesce(new.activity_type, '')) = any (v_legacy_course) then
    new.activity_type := 'course';
  end if;

  if trim(coalesce(new.item_type, '')) = any (v_legacy_course) then
    new.item_type := 'course';
  end if;

  if new.activity_type is not null
    and new.item_type is not null
    and new.item_type is distinct from new.activity_type then
    new.item_type := new.activity_type;
  end if;

  return new;
end;
$function$;

revoke all on function public.normalize_activities_type_fields() from public;
grant execute on function public.normalize_activities_type_fields() to authenticated;
grant execute on function public.normalize_activities_type_fields() to service_role;

drop trigger if exists aab_activities_normalize_type_fields on public.activities;
create trigger aab_activities_normalize_type_fields
before insert or update of activity_type, item_type
on public.activities
for each row
execute function public.normalize_activities_type_fields();

do $repair$
declare
  v_target_row_ids constant text[] := array[
    'school_2027_101',
    'PAI-290c948a-6e3c-485b-879f-2a570ae87255',
    'PAI-d2ad05ca-a437-4630-8feb-eeeb45309420'
  ];
  v_corrupted_count integer;
  v_row record;
  v_has_course_history boolean;
begin
  select count(*)
  into v_corrupted_count
  from public.activities a
  where a.row_id = any (v_target_row_ids)
    and trim(coalesce(a.activity_type, '')) = 'תוכנית'
    and trim(coalesce(a.item_type, '')) = 'תוכנית';

  if v_corrupted_count = 0 then
    -- Idempotent: nothing to repair.
    return;
  end if;

  if v_corrupted_count <> 3 then
    raise exception 'expected exactly 3 corrupted rows, found %', v_corrupted_count;
  end if;

  for v_row in
    select a.id, a.row_id
    from public.activities a
    where a.row_id = any (v_target_row_ids)
  loop
    select exists (
      select 1
      from public.activities_audit_log l
      where l.activity_id = v_row.id
        and (
          position('course' in lower(coalesce(to_jsonb(l)::text, ''))) > 0
          or position('קורס' in coalesce(to_jsonb(l)::text, '')) > 0
        )
    )
    into v_has_course_history;

    if not v_has_course_history then
      raise exception 'audit verification failed for %: no prior course history found', v_row.row_id;
    end if;
  end loop;

  update public.activities a
  set activity_type = 'course',
      item_type = 'course',
      updated_at = now()
  where a.row_id = any (v_target_row_ids)
    and trim(coalesce(a.activity_type, '')) = 'תוכנית'
    and trim(coalesce(a.item_type, '')) = 'תוכנית';
end;
$repair$;

comment on function public.normalize_activities_type_fields() is
  'Maps legacy proposal/catalog course labels (תוכנית/program/קורס) to canonical activity_type course before persist.';
