-- Keep proposal client identity self-contained even if a UI contact selection omits
-- one of the snapshot identifiers. This runs inside the same proposal write and
-- does not add any frontend/network read.

alter table public.proposals_agreements
  disable trigger proposals_agreements_explicit_permissions;

update public.proposals_agreements pa
set
  client_name = coalesce(
    nullif(btrim(pa.client_name), ''),
    case
      when pa.client_type = 'school' then nullif(btrim(pa.school_framework), '')
      when pa.client_type = 'authority' then nullif(btrim(pa.client_authority), '')
      else nullif(btrim(pa.school_framework), '')
    end
  ),
  authority_code = coalesce(
    pa.authority_code,
    (select a.authority_code from public.authorities a where a.id = pa.authority_id)
  ),
  semel_mosad = case
    when pa.client_type = 'school' then coalesce(
      pa.semel_mosad,
      (select s.semel_mosad from public.schools s where s.id = pa.school_id),
      (select cs.semel_mosad from public.contacts_schools cs where cs.id = pa.contact_school_id)
    )
    else pa.semel_mosad
  end
where
  nullif(btrim(pa.client_name), '') is null
  or pa.authority_code is null
  or (pa.client_type = 'school' and pa.semel_mosad is null);

alter table public.proposals_agreements
  enable trigger proposals_agreements_explicit_permissions;

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
  end if;

  if new.client_type is null then
    new.client_type := case
      when linked_contact.client_type in ('school', 'authority', 'other') then linked_contact.client_type
      when new.school_id is not null then 'school'
      when new.authority_id is not null or nullif(btrim(new.client_authority), '') is not null then 'authority'
      else 'other'
    end;
  end if;

  -- Proposal row is the document source of truth. Fill only missing snapshot
  -- identity during this same write; never overwrite an already-saved value.
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
  'Proposal snapshot write-boundary safety net: fills only missing client identity inside the same insert/update; no frontend enrichment or extra request.';
