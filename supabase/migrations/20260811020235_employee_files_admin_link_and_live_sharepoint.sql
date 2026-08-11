create or replace function public.app_is_employee_files_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.role = 'admin'
      and u.is_active = true
  )
$$;

revoke all on function public.app_is_employee_files_admin() from public, anon;
grant execute on function public.app_is_employee_files_admin() to authenticated;

create or replace function public.get_instructor_employee_file_snapshot(
  p_emp_id bigint,
  p_school_year text default '2027'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not public.app_can_view_employee_files() then
    raise exception 'employee_files_permission_denied' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.contacts_instructors
    where emp_id = p_emp_id
      and lower(trim(coalesce(active::text,''))) not in ('no','false','0')
  ) then
    return jsonb_build_object(
      'mapped', false,
      'components', '[]'::jsonb,
      'can_edit_folder_url', public.app_is_employee_files_admin()
    );
  end if;

  select jsonb_build_object(
    'mapped', true,
    'folder_web_url', f.folder_web_url,
    'can_edit_folder_url', public.app_is_employee_files_admin(),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
        'component_key', s.component_key,
        'completed', s.completed,
        'item_count', s.item_count,
        'updated_at', s.updated_at
      ) order by s.component_key)
      from public.instructor_employee_document_status s
      where s.folder_mapping_id = f.id
    ), '[]'::jsonb)
  ) into result
  from public.instructor_employee_folders f
  where f.emp_id = p_emp_id and f.school_year = p_school_year;

  return coalesce(
    result,
    jsonb_build_object(
      'mapped', false,
      'components', '[]'::jsonb,
      'can_edit_folder_url', public.app_is_employee_files_admin()
    )
  );
end
$$;

create or replace function public.update_instructor_employee_folder_url(
  p_emp_id bigint,
  p_school_year text,
  p_folder_web_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  mapping_id uuid;
  clean_url text := nullif(trim(coalesce(p_folder_web_url,'')), '');
begin
  if not public.app_is_employee_files_admin() then
    raise exception 'employee_files_admin_required' using errcode = '42501';
  end if;
  if clean_url is not null and clean_url !~ '^https://think365orgil[.]sharepoint[.]com/' then
    raise exception 'employee_files_invalid_sharepoint_url' using errcode = '22023';
  end if;
  mapping_id := public.employee_file_active_mapping(p_emp_id, p_school_year);
  update public.instructor_employee_folders
  set folder_web_url = clean_url, updated_at = now()
  where id = mapping_id;
  return jsonb_build_object('folder_web_url', clean_url);
end
$$;

revoke all on function public.update_instructor_employee_folder_url(bigint,text,text) from public, anon, authenticated;
grant execute on function public.update_instructor_employee_folder_url(bigint,text,text) to authenticated;

-- Status is now intended to come from SharePoint live reads, not manual dashboard edits.
revoke execute on function public.update_instructor_employee_file_component(bigint,text,text,boolean,integer) from authenticated;
