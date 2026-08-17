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
  clean_url text := nullif(trim(coalesce(p_folder_web_url, '')), '');
  previous_url text;
  did_change boolean;
begin
  if not public.app_is_employee_files_admin() then
    raise exception 'employee_files_admin_required' using errcode = '42501';
  end if;
  if clean_url is not null and clean_url !~ '^https://think365orgil[.]sharepoint[.]com/' then
    raise exception 'employee_files_invalid_sharepoint_url' using errcode = '22023';
  end if;

  mapping_id := public.employee_file_active_mapping(p_emp_id, p_school_year);
  select folder_web_url into previous_url
  from public.instructor_employee_folders
  where id = mapping_id;
  did_change := previous_url is distinct from clean_url;

  if did_change then
    update public.instructor_employee_folders
    set folder_web_url = clean_url, updated_at = now()
    where id = mapping_id;
  end if;

  return jsonb_build_object('folder_web_url', clean_url, 'changed', did_change);
end
$$;

revoke all on function public.update_instructor_employee_folder_url(bigint,text,text) from public, anon, authenticated;
grant execute on function public.update_instructor_employee_folder_url(bigint,text,text) to authenticated;
