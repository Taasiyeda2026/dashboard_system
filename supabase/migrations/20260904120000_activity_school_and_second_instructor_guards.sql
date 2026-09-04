-- Guard new/changed links without rewriting historical rows.
create or replace function public.guard_activity_school_and_instructors()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  school_authority_id bigint;
  is_tamir_workshop boolean := false;
begin
  if tg_op = 'INSERT' or new.school_id is distinct from old.school_id or new.authority_id is distinct from old.authority_id then
    if new.school_id is not null then
      if new.authority_id is null then
        raise exception 'activity_school_authority_mismatch' using errcode = '23514';
      end if;
      select s.authority_id into school_authority_id from public.schools s where s.id = new.school_id;
      if school_authority_id is null or school_authority_id is distinct from new.authority_id then
        raise exception 'activity_school_authority_mismatch' using errcode = '23514';
      end if;
    end if;
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

drop trigger if exists activities_school_and_instructor_guard on public.activities;
create trigger activities_school_and_instructor_guard
before insert or update of school_id, authority_id, emp_id_2, instructor_name_2
on public.activities
for each row execute function public.guard_activity_school_and_instructors();
