-- Allow the same employees who are authorized for instructor onboarding to persist
-- the automatically created SharePoint folder mapping, without broadening the
-- existing admin-only manual folder URL editor.
create or replace function public.update_instructor_onboarding_folder_url(
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
begin
  if not public.app_can_view_employee_files() then
    raise exception 'employee_files_permission_denied' using errcode = '42501';
  end if;

  if clean_url is not null and clean_url !~ '^https://think365orgil[.]sharepoint[.]com/' then
    raise exception 'employee_files_invalid_sharepoint_url' using errcode = '22023';
  end if;

  mapping_id := public.employee_file_active_mapping(p_emp_id, p_school_year);

  update public.instructor_employee_folders
  set folder_web_url = clean_url,
      updated_at = now()
  where id = mapping_id;

  return jsonb_build_object('folder_web_url', clean_url);
end;
$$;

revoke execute on function public.update_instructor_onboarding_folder_url(bigint, text, text) from public;
revoke execute on function public.update_instructor_onboarding_folder_url(bigint, text, text) from anon;
grant execute on function public.update_instructor_onboarding_folder_url(bigint, text, text) to authenticated;
