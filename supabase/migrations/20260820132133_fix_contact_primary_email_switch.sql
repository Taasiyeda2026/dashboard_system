-- Fix switching the primary contact email when contacts_schools.email is updated.
--
-- The contacts_schools -> contact_emails sync used to demote the old primary
-- through a nested contact_emails write. The contact_emails AFTER trigger then
-- immediately promoted the old row again before the new primary row was
-- inserted, causing contact_emails_one_active_primary_key (409 Conflict).
--
-- Keep the one-active-primary invariant, but make the bridge operation atomic:
-- temporarily suppress fallback primary repair while demoting the old primary
-- and promoting/upserting the new one.

create or replace function public.sync_contact_primary_email_from_contact_emails()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_contact_id bigint;
  v_primary_email text;
begin
  if coalesce(current_setting('app.skip_contact_primary_email_repair', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_contact_id := old.contact_id;
  else
    v_contact_id := new.contact_id;
  end if;

  if not exists (
    select 1
    from public.contact_emails ce
    where ce.contact_id = v_contact_id
      and ce.active
      and ce.is_primary
  ) then
    update public.contact_emails
    set is_primary = true,
        updated_at = now()
    where id = (
      select ce.id
      from public.contact_emails ce
      where ce.contact_id = v_contact_id
        and ce.active
      order by ce.created_at, ce.id
      limit 1
    );
  end if;

  select ce.email
  into v_primary_email
  from public.contact_emails ce
  where ce.contact_id = v_contact_id
    and ce.active
    and ce.is_primary
  order by ce.id
  limit 1;

  update public.contacts_schools cs
  set email = nullif(v_primary_email, '')
  where cs.id = v_contact_id
    and public.normalize_contact_email(cs.email)
        is distinct from public.normalize_contact_email(v_primary_email);

  return null;
end;
$$;

create or replace function public.sync_contact_email_to_contact_emails()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_email := public.normalize_contact_email(new.email);

  if tg_op = 'INSERT'
     or public.normalize_contact_email(old.email) is distinct from v_email then
    if v_email <> '' then
      perform set_config('app.skip_contact_primary_email_repair', 'on', true);

      update public.contact_emails
      set is_primary = false,
          updated_at = now()
      where contact_id = new.id
        and active
        and is_primary
        and public.normalize_contact_email(email) <> v_email;

      insert into public.contact_emails (
        contact_id,
        email,
        is_primary,
        source,
        active
      )
      values (
        new.id,
        v_email,
        true,
        'contacts_schools.email',
        true
      )
      on conflict (contact_id, lower(btrim(email)))
      do update set
        is_primary = true,
        active = true,
        updated_at = now();

      perform set_config('app.skip_contact_primary_email_repair', 'off', true);
    end if;
  end if;

  return new;
exception
  when others then
    perform set_config('app.skip_contact_primary_email_repair', 'off', true);
    raise;
end;
$$;
