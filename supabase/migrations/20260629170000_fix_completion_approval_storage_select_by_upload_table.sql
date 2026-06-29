-- Fix completion approval Storage reads to use the upload ownership table.
-- Historical objects can live under a different folder prefix than the
-- assigned instructor's emp_id, so SELECT must be granted by matching
-- storage.objects.name to activity_completion_approval_uploads.file_path.
-- Do not rewrite file_path values or move Storage objects here.

create or replace function public.can_select_completion_approval_storage_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select exists (
    select 1
    from public.users current_user_record
    where current_user_record.auth_user_id = auth.uid()
      and current_user_record.role in ('admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager')
  )
  or exists (
    select 1
    from public.activity_completion_approval_uploads uploads
    join public.users current_user_record
      on current_user_record.auth_user_id = auth.uid()
     and nullif(trim(current_user_record.emp_id::text), '') is not null
    where uploads.file_path = object_name
      and uploads.instructor_emp_id = current_user_record.emp_id::text
  );
$$;

grant execute on function public.can_select_completion_approval_storage_object(text) to authenticated;

drop policy if exists completion_approvals_storage_select_own_or_ops on storage.objects;
create policy completion_approvals_storage_select_own_or_ops
on storage.objects
for select
using (
  bucket_id = 'completion-approvals'
  and public.can_select_completion_approval_storage_object(name)
);

-- Production verification queries after applying this migration:
-- 1. As instructor emp_id 1500, the object is selectable when an upload row has
--    instructor_emp_id = '1500' and file_path = storage.objects.name, even if
--    split_part(storage.objects.name, '/', 1) = '8000'.
-- 2. As instructor emp_id 1503, the object is selectable when an upload row has
--    instructor_emp_id = '1503' and file_path = storage.objects.name, even if
--    split_part(storage.objects.name, '/', 1) = '6000'.
-- 3. As any other instructor, the object is not selectable unless that upload row
--    has their emp_id in activity_completion_approval_uploads.instructor_emp_id.
-- 4. Users with admin, operation_manager, domain_manager, activities_manager, or
--    instructor_manager role can select every object in completion-approvals.
