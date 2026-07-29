alter table public.israa_program_tracking
  add column if not exists ownership text,
  add column if not exists manager_name text,
  add column if not exists manager_phone text,
  add column if not exists manager_email text,
  add column if not exists additional_contact text,
  add column if not exists expected_program text,
  add column if not exists grade text,
  add column if not exists participants_groups text;

update public.israa_program_tracking
set
  manager_name = coalesce(nullif(btrim(manager_name), ''), nullif(btrim(contact_person), '')),
  manager_phone = coalesce(nullif(btrim(manager_phone), ''), nullif(btrim(phone), '')),
  manager_email = coalesce(nullif(btrim(manager_email), ''), nullif(btrim(email), '')),
  expected_program = coalesce(
    nullif(btrim(expected_program), ''),
    nullif(btrim(substring(notes from 'תוכנית צפויה / נבחרת:[[:space:]]*([^|]+)')), '')
  ),
  grade = coalesce(
    nullif(btrim(grade), ''),
    nullif(btrim(substring(notes from '[|][[:space:]]*שכבה:[[:space:]]*([^|]+)')), '')
  ),
  participants_groups = coalesce(
    nullif(btrim(participants_groups), ''),
    nullif(btrim(substring(notes from '[|][[:space:]]*תלמידים / קבוצות:[[:space:]]*([^|]+)')), '')
  )
where true;

update public.israa_program_tracking
set notes = nullif(
  btrim(
    regexp_replace(
      notes,
      '^תוכנית צפויה / נבחרת:[[:space:]]*[^|]*[|][[:space:]]*שכבה:[[:space:]]*[^|]*[|][[:space:]]*תלמידים / קבוצות:[[:space:]]*[^|]*[|][[:space:]]*',
      ''
    )
  ),
  ''
)
where notes ~ '^תוכנית צפויה / נבחרת:';

create or replace function public.sync_israa_exact_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  new.manager_name := coalesce(nullif(btrim(new.manager_name), ''), nullif(btrim(new.contact_person), ''));
  new.manager_phone := coalesce(nullif(btrim(new.manager_phone), ''), nullif(btrim(new.phone), ''));
  new.manager_email := coalesce(nullif(btrim(new.manager_email), ''), nullif(btrim(new.email), ''));

  new.contact_person := coalesce(nullif(btrim(new.manager_name), ''), nullif(btrim(new.contact_person), ''));
  new.phone := coalesce(nullif(btrim(new.manager_phone), ''), nullif(btrim(new.phone), ''));
  new.email := coalesce(nullif(btrim(new.manager_email), ''), nullif(btrim(new.email), ''));

  if new.notes ~ '^תוכנית צפויה / נבחרת:' then
    new.expected_program := coalesce(
      nullif(btrim(new.expected_program), ''),
      nullif(btrim(substring(new.notes from 'תוכנית צפויה / נבחרת:[[:space:]]*([^|]+)')), '')
    );
    new.grade := coalesce(
      nullif(btrim(new.grade), ''),
      nullif(btrim(substring(new.notes from '[|][[:space:]]*שכבה:[[:space:]]*([^|]+)')), '')
    );
    new.participants_groups := coalesce(
      nullif(btrim(new.participants_groups), ''),
      nullif(btrim(substring(new.notes from '[|][[:space:]]*תלמידים / קבוצות:[[:space:]]*([^|]+)')), '')
    );
    new.notes := nullif(
      btrim(
        regexp_replace(
          new.notes,
          '^תוכנית צפויה / נבחרת:[[:space:]]*[^|]*[|][[:space:]]*שכבה:[[:space:]]*[^|]*[|][[:space:]]*תלמידים / קבוצות:[[:space:]]*[^|]*[|][[:space:]]*',
          ''
        )
      ),
      ''
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_sync_israa_exact_columns on public.israa_program_tracking;
create trigger trg_sync_israa_exact_columns
before insert or update on public.israa_program_tracking
for each row execute function public.sync_israa_exact_columns();

comment on column public.israa_program_tracking.ownership is 'בעלות';
comment on column public.israa_program_tracking.manager_name is 'שם מנהל/ת';
comment on column public.israa_program_tracking.manager_phone is 'נייד מנהל/ת';
comment on column public.israa_program_tracking.manager_email is 'מייל מנהל/ת';
comment on column public.israa_program_tracking.additional_contact is 'איש/ת קשר נוסף';
comment on column public.israa_program_tracking.expected_program is 'התוכנית הצפויה';
comment on column public.israa_program_tracking.grade is 'שכבה';
comment on column public.israa_program_tracking.participants_groups is 'קבוצות / מס'' משתתפים';
