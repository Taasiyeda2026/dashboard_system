-- SharePoint employee-file metadata only. Document contents remain in SharePoint.
-- The type assertion verifies the live schema before the FK is created.
do $$
declare emp_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into emp_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'contacts_instructors'
    and a.attname = 'emp_id' and a.attnum > 0 and not a.attisdropped;
  if emp_id_type is distinct from 'bigint' then
    raise exception 'contacts_instructors.emp_id must be bigint; found %', coalesce(emp_id_type, 'missing');
  end if;
end $$;

create table public.instructor_employee_folders (
  id uuid primary key default gen_random_uuid(),
  emp_id bigint not null references public.contacts_instructors(emp_id) on delete cascade,
  school_year text not null,
  provider text not null default 'sharepoint' check (provider = 'sharepoint'),
  site_id text not null,
  drive_id text not null,
  folder_item_id text not null,
  folder_web_url text not null check (folder_web_url ~ '^https://think365orgil[.]sharepoint[.]com/'),
  folder_name_snapshot text,
  mapping_status text not null default 'mapped' check (mapping_status in ('mapped','manual_review','disabled')),
  mapping_method text not null check (mapping_method in ('manual','exact_seed','provisioned')),
  last_delta_sync_at timestamptz,
  last_sharepoint_modified_at timestamptz,
  last_sync_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_year, emp_id),
  unique (site_id, drive_id, folder_item_id)
);

create table public.instructor_employee_document_status (
  folder_mapping_id uuid not null references public.instructor_employee_folders(id) on delete cascade,
  component_key text not null check (component_key in (
    'signed_agreement','supporting_documents','intro_feedback','midyear_feedback',
    'year_end_feedback','observation_1','observation_2','payroll_reports'
  )),
  present boolean not null default false,
  item_count integer not null default 0 check (item_count >= 0),
  latest_modified_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (folder_mapping_id, component_key)
);

alter table public.instructor_employee_folders enable row level security;
alter table public.instructor_employee_document_status enable row level security;
revoke all on public.instructor_employee_folders from anon, authenticated;
revoke all on public.instructor_employee_document_status from anon, authenticated;

-- Seed the dedicated permission for current users. An explicit value remains authoritative.
update public.users
set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
  'view_employee_files',
  case when role in ('admin','operation_manager','finance','activities_manager','domain_manager','business_development_manager','instructor_manager') then 'yes' else 'no' end
)
where not coalesce(permissions, '{}'::jsonb) ? 'view_employee_files';

create or replace function public.app_can_view_employee_files()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_has_permission('view_employee_files'), false)
$$;
revoke all on function public.app_can_view_employee_files() from public;
grant execute on function public.app_can_view_employee_files() to authenticated;

create or replace function public.get_instructor_employee_file_snapshot(
  p_emp_id bigint,
  p_school_year text default '2027'
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.app_can_view_employee_files() then raise exception 'employee_files_permission_denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.contacts_instructors where emp_id = p_emp_id and lower(trim(coalesce(active::text,''))) not in ('no','false','0')) then
    return jsonb_build_object('mapped', false, 'components', '[]'::jsonb);
  end if;
  select jsonb_build_object(
    'mapped', f.mapping_status = 'mapped',
    'folder_web_url', case when f.mapping_status = 'mapped' then f.folder_web_url else null end,
    'last_delta_sync_at', f.last_delta_sync_at,
    'components', coalesce((select jsonb_agg(jsonb_build_object(
      'component_key', s.component_key, 'present', s.present, 'item_count', s.item_count,
      'latest_modified_at', s.latest_modified_at, 'synced_at', s.synced_at
    ) order by s.component_key) from public.instructor_employee_document_status s where s.folder_mapping_id = f.id), '[]'::jsonb)
  ) into result
  from public.instructor_employee_folders f
  where f.emp_id = p_emp_id and f.school_year = p_school_year and f.mapping_status = 'mapped';
  return coalesce(result, jsonb_build_object('mapped', false, 'components', '[]'::jsonb));
end $$;
revoke all on function public.get_instructor_employee_file_snapshot(bigint,text) from public;
grant execute on function public.get_instructor_employee_file_snapshot(bigint,text) to authenticated;

comment on table public.instructor_employee_folders is 'Stable instructor-to-SharePoint folder mapping; no document content.';
comment on table public.instructor_employee_document_status is 'Eight-component SharePoint metadata snapshot; no filenames or document content.';
