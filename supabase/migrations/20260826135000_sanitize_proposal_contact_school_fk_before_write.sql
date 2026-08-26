-- Harden proposal writes against stale/legacy clients that accidentally send a
-- school/authority catalogue id as proposals_agreements.contact_school_id.
-- The FK must always point to contacts_schools.id. Invalid or clearly mismatched
-- values are cleared before FK validation; authority_id/school_id and document
-- snapshot identity remain intact.

create or replace function public.bridge_legacy_proposal_client_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_contact public.contacts_schools%rowtype;
  linked_authority_code bigint;
  linked_semel_mosad bigint;
begin
  if new.contact_school_id is not null then
    select * into linked_contact
    from public.contacts_schools
    where id = new.contact_school_id;

    if not found
      or (
        new.authority_id is not null
        and linked_contact.authority_id is not null
        and linked_contact.authority_id is distinct from new.authority_id
      )
      or (
        new.school_id is not null
        and linked_contact.school_id is not null
        and linked_contact.school_id is distinct from new.school_id
      )
    then
      new.contact_school_id := null;
      linked_contact := null;
    end if;
  end if;

  if new.client_type is null then
    new.client_type := case
      when linked_contact.client_type in ('school', 'authority', 'other') then linked_contact.client_type
      when new.school_id is not null then 'school'
      when new.authority_id is not null or nullif(btrim(new.client_authority), '') is not null then 'authority'
      else 'other'
    end;
  end if;

  if nullif(btrim(new.client_name), '') is null then
    new.client_name := coalesce(
      nullif(btrim(linked_contact.client_name), ''),
      case
        when new.client_type = 'school' then nullif(btrim(new.school_framework), '')
        when new.client_type = 'authority' then nullif(btrim(new.client_authority), '')
        else nullif(btrim(new.school_framework), '')
      end
    );
  end if;

  if new.authority_code is null and new.authority_id is not null then
    select authority_code into linked_authority_code
    from public.authorities
    where id = new.authority_id;
    new.authority_code := linked_authority_code;
  end if;

  if new.client_type = 'school' and new.semel_mosad is null then
    if new.school_id is not null then
      select semel_mosad into linked_semel_mosad
      from public.schools
      where id = new.school_id;
    end if;
    new.semel_mosad := coalesce(linked_semel_mosad, linked_contact.semel_mosad);
  end if;

  return new;
end;
$$;

comment on function public.bridge_legacy_proposal_client_snapshot() is
  'Proposal snapshot write-boundary safety net: clears invalid contact_school_id links and fills only missing client identity inside the same write.';
