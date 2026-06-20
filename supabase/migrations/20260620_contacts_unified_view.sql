-- Unified read-only view for general contacts (authorities, schools, school contacts).
-- Instructors remain in contacts_instructors and are NOT included here.

drop view if exists public.contacts_unified_view;

create view public.contacts_unified_view as
select
  case
    when lower(coalesce(cs.client_type, '')) = 'school'
      or (nullif(trim(coalesce(cs.school, '')), '') is not null and lower(coalesce(cs.client_type, '')) <> 'authority')
      then 'school'
    when lower(coalesce(cs.client_type, '')) = 'authority' then 'authority'
    else 'other'
  end as contact_domain,
  cs.client_type,
  cs.client_name,
  cs.authority_id,
  cs.school_id,
  cs.semel_mosad,
  coalesce(a.authority_name, cs.authority) as authority_name,
  cs.authority,
  coalesce(s.school_name, cs.school) as school_name,
  cs.school,
  cs.contact_name,
  cs.contact_role,
  cs.phone,
  cs.mobile,
  cs.email,
  cs.address,
  cs.notes,
  a.authority_code,
  coalesce(s.district, a.district) as district,
  s.city,
  'contacts_schools'::text as source_table,
  cs.id::text as source_id
from public.contacts_schools cs
left join public.authorities a on a.id = cs.authority_id
left join public.schools s on s.id = cs.school_id
where coalesce(lower(trim(cs.active::text)), 'yes') not in ('no', '0', 'false')

union all

select
  'school'::text as contact_domain,
  'school'::text as client_type,
  sch.school_name as client_name,
  sch.authority_id,
  sch.id as school_id,
  sch.semel_mosad,
  coalesce(a.authority_name, sch.authority) as authority_name,
  sch.authority,
  sch.school_name,
  sch.school_name as school,
  nullif(trim(coalesce(sch.principal_name, '')), '') as contact_name,
  case
    when nullif(trim(coalesce(sch.principal_name, '')), '') is not null then 'מנהל/ת בית ספר'
    else null
  end as contact_role,
  nullif(trim(coalesce(sch.school_phone, '')), '') as phone,
  null::text as mobile,
  null::text as email,
  nullif(trim(coalesce(sch.institution_address, '')), '') as address,
  null::text as notes,
  a.authority_code,
  coalesce(sch.district, a.district) as district,
  sch.city,
  'schools'::text as source_table,
  sch.id::text as source_id
from public.schools sch
left join public.authorities a on a.id = sch.authority_id
where coalesce(lower(trim(sch.active::text)), 'yes') not in ('no', '0', 'false')
  and nullif(trim(coalesce(sch.school_name, '')), '') is not null
  and (
    nullif(trim(coalesce(sch.principal_name, '')), '') is not null
    or nullif(trim(coalesce(sch.school_phone, '')), '') is not null
    or nullif(trim(coalesce(sch.institution_address, '')), '') is not null
  );

grant select on public.contacts_unified_view to anon, authenticated;
