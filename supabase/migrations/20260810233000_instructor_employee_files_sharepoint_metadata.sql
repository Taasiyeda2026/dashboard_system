-- Manual employee-file checklist. Files remain in SharePoint; only the direct
-- folder link and dashboard-managed checklist/count are stored here.
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
  folder_web_url text check (folder_web_url is null or folder_web_url ~ '^https://think365orgil[.]sharepoint[.]com/'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_year, emp_id)
);

create table public.instructor_employee_document_status (
  folder_mapping_id uuid not null references public.instructor_employee_folders(id) on delete cascade,
  component_key text not null check (component_key in (
    'signed_agreement','supporting_documents','intro_feedback','midyear_feedback',
    'year_end_feedback','observation_1','observation_2','payroll_reports'
  )),
  completed boolean not null default false,
  item_count integer not null default 0 check (item_count >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (folder_mapping_id, component_key)
);

alter table public.instructor_employee_folders enable row level security;
alter table public.instructor_employee_document_status enable row level security;
revoke all on public.instructor_employee_folders from anon, authenticated;
revoke all on public.instructor_employee_document_status from anon, authenticated;

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

create or replace function public.employee_file_active_mapping(p_emp_id bigint, p_school_year text)
returns uuid language plpgsql security definer set search_path = public as $$
declare mapping_id uuid;
begin
  if not public.app_can_view_employee_files() then raise exception 'employee_files_permission_denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.contacts_instructors where emp_id = p_emp_id and lower(trim(coalesce(active::text,''))) not in ('no','false','0')) then
    raise exception 'employee_files_active_instructor_required' using errcode = '22023';
  end if;
  insert into public.instructor_employee_folders (emp_id, school_year)
  values (p_emp_id, p_school_year)
  on conflict (school_year, emp_id) do update set updated_at = now()
  returning id into mapping_id;
  return mapping_id;
end $$;
revoke all on function public.employee_file_active_mapping(bigint,text) from public;

create or replace function public.get_instructor_employee_file_snapshot(p_emp_id bigint, p_school_year text default '2027')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.app_can_view_employee_files() then raise exception 'employee_files_permission_denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.contacts_instructors where emp_id = p_emp_id and lower(trim(coalesce(active::text,''))) not in ('no','false','0')) then
    return jsonb_build_object('mapped', false, 'components', '[]'::jsonb);
  end if;
  select jsonb_build_object(
    'mapped', true,
    'folder_web_url', f.folder_web_url,
    'components', coalesce((select jsonb_agg(jsonb_build_object(
      'component_key', s.component_key, 'completed', s.completed, 'item_count', s.item_count,
      'updated_at', s.updated_at
    ) order by s.component_key) from public.instructor_employee_document_status s where s.folder_mapping_id = f.id), '[]'::jsonb)
  ) into result
  from public.instructor_employee_folders f where f.emp_id = p_emp_id and f.school_year = p_school_year;
  return coalesce(result, jsonb_build_object('mapped', false, 'components', '[]'::jsonb));
end $$;

create or replace function public.update_instructor_employee_file_component(
  p_emp_id bigint, p_school_year text, p_component_key text, p_completed boolean, p_item_count integer default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare mapping_id uuid; saved public.instructor_employee_document_status;
begin
  if p_component_key not in ('signed_agreement','supporting_documents','intro_feedback','midyear_feedback','year_end_feedback','observation_1','observation_2','payroll_reports') then
    raise exception 'employee_files_invalid_component' using errcode = '22023';
  end if;
  if p_item_count < 0 then raise exception 'employee_files_negative_item_count' using errcode = '22023'; end if;
  mapping_id := public.employee_file_active_mapping(p_emp_id, p_school_year);
  insert into public.instructor_employee_document_status (folder_mapping_id, component_key, completed, item_count, updated_at, updated_by)
  values (mapping_id, p_component_key, coalesce(p_completed,false), case when p_component_key='payroll_reports' then p_item_count else 0 end, now(), auth.uid())
  on conflict (folder_mapping_id, component_key) do update set completed=excluded.completed, item_count=excluded.item_count, updated_at=now(), updated_by=auth.uid()
  returning * into saved;
  return jsonb_build_object('component_key',saved.component_key,'completed',saved.completed,'item_count',saved.item_count,'updated_at',saved.updated_at);
end $$;

create or replace function public.update_instructor_employee_folder_url(p_emp_id bigint, p_school_year text, p_folder_web_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare mapping_id uuid; clean_url text := nullif(trim(coalesce(p_folder_web_url,'')),'');
begin
  if clean_url is not null and clean_url !~ '^https://think365orgil[.]sharepoint[.]com/' then
    raise exception 'employee_files_invalid_sharepoint_url' using errcode = '22023';
  end if;
  mapping_id := public.employee_file_active_mapping(p_emp_id, p_school_year);
  update public.instructor_employee_folders set folder_web_url=clean_url, updated_at=now() where id=mapping_id;
  return jsonb_build_object('folder_web_url',clean_url);
end $$;

revoke all on function public.get_instructor_employee_file_snapshot(bigint,text) from public;
revoke all on function public.update_instructor_employee_file_component(bigint,text,text,boolean,integer) from public;
revoke all on function public.update_instructor_employee_folder_url(bigint,text,text) from public;
grant execute on function public.get_instructor_employee_file_snapshot(bigint,text) to authenticated;
grant execute on function public.update_instructor_employee_file_component(bigint,text,text,boolean,integer) to authenticated;
grant execute on function public.update_instructor_employee_folder_url(bigint,text,text) to authenticated;

comment on table public.instructor_employee_folders is 'Manual instructor-to-SharePoint folder link; no document content.';
comment on table public.instructor_employee_document_status is 'Dashboard-managed eight-component checklist and payroll count.';
