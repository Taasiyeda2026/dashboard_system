alter table public.contacts_instructors
  add column if not exists birth_date date;

create or replace function private.sync_instructor_birthday()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_slug text;
  v_is_active boolean;
begin
  if tg_op = 'DELETE' then
    delete from public.employee_birthdays
    where employee_slug = 'instructor-' || old.emp_id::text;
    return old;
  end if;

  v_slug := 'instructor-' || new.emp_id::text;
  v_is_active := lower(coalesce(new.active, 'yes')) not in ('no', 'false', '0')
    and new.birth_date is not null;

  if new.birth_date is null then
    delete from public.employee_birthdays
    where employee_slug = v_slug;
    return new;
  end if;

  insert into public.employee_birthdays
    (employee_name, employee_slug, birth_day, birth_month, image_path, is_active, display_order)
  values
    (
      coalesce(nullif(trim(new.full_name), ''), new.emp_id::text),
      v_slug,
      extract(day from new.birth_date)::smallint,
      extract(month from new.birth_date)::smallint,
      '/birthdays/instructors.png',
      v_is_active,
      1
    )
  on conflict (employee_slug) do update
  set
    employee_name = excluded.employee_name,
    birth_day = excluded.birth_day,
    birth_month = excluded.birth_month,
    image_path = excluded.image_path,
    is_active = excluded.is_active,
    display_order = excluded.display_order,
    updated_at = now();

  return new;
end
$$;

revoke all on function private.sync_instructor_birthday() from public, anon, authenticated;

drop trigger if exists sync_instructor_birthday_from_contacts on public.contacts_instructors;
create trigger sync_instructor_birthday_from_contacts
after insert or update or delete on public.contacts_instructors
for each row execute function private.sync_instructor_birthday();
