-- IDs are the source of truth. Repair only textual snapshots for rows whose
-- existing authority_id/school_id relationship is already valid.
drop trigger if exists activities_school_and_instructor_guard on public.activities;

update public.activities activity
set authority = authority.authority_name,
    school = school.school_name
from public.schools school
join public.authorities authority on authority.id = school.authority_id
where activity.school_id = school.id
  and activity.authority_id = school.authority_id
  and (
    activity.authority is distinct from authority.authority_name or
    activity.school is distinct from school.school_name
  );

-- Mismatched historical IDs are deliberately audit-only. This view remains
-- current without modifying the invalid activity IDs.
create or replace view public.activity_school_authority_mismatch_audit
with (security_invoker = true)
as
select
  activity.row_id,
  activity.authority_id as activity_authority_id,
  activity.school_id,
  school.authority_id as school_authority_id,
  activity.authority as activity_authority_snapshot,
  activity.school as activity_school_snapshot,
  authority.authority_name as school_authority_name,
  school.school_name
from public.activities activity
left join public.schools school on school.id = activity.school_id
left join public.authorities authority on authority.id = school.authority_id
where activity.school_id is not null
  and (school.id is null or school.authority_id is distinct from activity.authority_id);

revoke all on public.activity_school_authority_mismatch_audit from public, anon;
grant select on public.activity_school_authority_mismatch_audit to authenticated, service_role;

create or replace function public.guard_activity_school_and_instructors()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  school_authority_id bigint;
  canonical_authority_name text;
  canonical_school_name text;
  is_tamir_workshop boolean := false;
begin
  if new.school_id is not null then
    if new.authority_id is null then
      raise exception 'בית הספר שנבחר מחייב authority_id תואם (activity_school_authority_mismatch)'
        using errcode = '23514';
    end if;

    select school.authority_id, school.school_name, authority.authority_name
      into school_authority_id, canonical_school_name, canonical_authority_name
    from public.schools school
    join public.authorities authority on authority.id = school.authority_id
    where school.id = new.school_id;

    if not found then
      raise exception 'school_id % אינו קיים בקטלוג בתי הספר', new.school_id
        using errcode = '23514';
    end if;
    if school_authority_id is distinct from new.authority_id then
      raise exception 'בית הספר % שייך לרשות % ולא לרשות % (activity_school_authority_mismatch)',
        new.school_id, school_authority_id, new.authority_id
        using errcode = '23514';
    end if;

    new.authority := canonical_authority_name;
    new.school := canonical_school_name;
  elsif new.authority_id is not null then
    select authority.authority_name into canonical_authority_name
    from public.authorities authority
    where authority.id = new.authority_id;
    if not found then
      raise exception 'authority_id % אינו קיים בקטלוג הרשויות', new.authority_id
        using errcode = '23514';
    end if;
    new.authority := canonical_authority_name;
  end if;

  if tg_op = 'INSERT' and (
    new.emp_id is not null or nullif(btrim(new.instructor_name), '') is not null or
    new.emp_id_2 is not null or nullif(btrim(new.instructor_name_2), '') is not null
  ) then
    raise exception 'new_activity_instructors_must_use_scheduling' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and (
    new.emp_id_2 is distinct from old.emp_id_2 or
    new.instructor_name_2 is distinct from old.instructor_name_2
  ) and (new.emp_id_2 is not null or nullif(btrim(new.instructor_name_2), '') is not null) then
    select exists (
      select 1
      from public.proposal_activity_pricing pricing
      where new.activity_no is not null
        and pricing.activity_no::text = new.activity_no::text
        and pricing.activity_name ilike '%תמיר%'
    ) and lower(coalesce(new.activity_type, new.item_type, '')) in ('workshop', 'סדנה')
    into is_tamir_workshop;
    if not is_tamir_workshop then
      raise exception 'second_instructor_requires_tamir_workshop' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger activities_school_and_instructor_guard
before insert or update
on public.activities
for each row execute function public.guard_activity_school_and_instructors();
