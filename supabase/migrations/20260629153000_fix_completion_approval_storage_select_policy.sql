-- Allow signed completion approval files to be opened by the assigned instructor
-- based on the upload record's saved file_path, not on the storage path prefix.
-- This keeps historical file_path values unchanged while allowing corrected
-- instructor ownership rows to grant access to their existing storage object.

alter table public.activity_completion_approval_uploads enable row level security;

drop policy if exists completion_approvals_storage_select_own_or_ops on storage.objects;
create policy completion_approvals_storage_select_own_or_ops
on storage.objects
for select
using (
  bucket_id = 'completion-approvals'
  and (
    exists (
      select 1
      from public.users current_user_record
      where current_user_record.auth_user_id = auth.uid()
        and current_user_record.role in ('admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager')
    )
    or exists (
      select 1
      from public.activity_completion_approval_uploads uploads
      where uploads.file_path = storage.objects.name
        and uploads.instructor_emp_id in (
          select identity_value
          from (
            select nullif(trim(current_user_record.emp_id::text), '') as identity_value
            from public.users current_user_record
            where current_user_record.auth_user_id = auth.uid()
            union
            select nullif(trim(current_user_record.user_id::text), '') as identity_value
            from public.users current_user_record
            where current_user_record.auth_user_id = auth.uid()
            union
            select nullif(trim(current_user_record.username::text), '') as identity_value
            from public.users current_user_record
            where current_user_record.auth_user_id = auth.uid()
          ) user_identity_values
          where identity_value is not null
        )
    )
  )
);

-- Diagnostic query for production checks: upload rows whose saved path has no
-- matching object in the completion-approvals bucket. Do not update file_path
-- unless the storage object is also copied/moved to that exact path.
--
-- select
--   u.id,
--   u.instructor_emp_id,
--   u.instructor_name,
--   u.file_name,
--   u.file_path,
--   o.name as storage_object_name
-- from public.activity_completion_approval_uploads u
-- left join storage.objects o
--   on o.bucket_id = 'completion-approvals'
--  and o.name = u.file_path
-- where o.id is null;
