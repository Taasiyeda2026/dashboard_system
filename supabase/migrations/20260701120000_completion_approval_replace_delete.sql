-- Allow safe replacement/deletion of completion approval uploads and their Storage objects.

alter table public.activity_completion_approval_uploads enable row level security;

-- Instructors may update/delete only their own upload rows; operational roles may update/delete any row.
drop policy if exists activity_completion_approval_uploads_update_own_or_manager on public.activity_completion_approval_uploads;
create policy activity_completion_approval_uploads_update_own_or_manager
on public.activity_completion_approval_uploads
for update
using (
  instructor_emp_id = (select emp_id::text from public.users where auth_user_id = auth.uid() limit 1)
  or exists (
    select 1 from public.users
    where auth_user_id = auth.uid()
      and role in ('admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager')
  )
)
with check (
  instructor_emp_id = (select emp_id::text from public.users where auth_user_id = auth.uid() limit 1)
  or exists (
    select 1 from public.users
    where auth_user_id = auth.uid()
      and role in ('admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager')
  )
);

drop policy if exists activity_completion_approval_uploads_delete_own_or_manager on public.activity_completion_approval_uploads;
create policy activity_completion_approval_uploads_delete_own_or_manager
on public.activity_completion_approval_uploads
for delete
using (
  instructor_emp_id = (select emp_id::text from public.users where auth_user_id = auth.uid() limit 1)
  or exists (
    select 1 from public.users
    where auth_user_id = auth.uid()
      and role in ('admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager')
  )
);

-- Storage deletion is restricted to the owning instructor folder or operational roles.
drop policy if exists completion_approvals_storage_delete_own_or_manager on storage.objects;
create policy completion_approvals_storage_delete_own_or_manager
on storage.objects
for delete
using (
  bucket_id = 'completion-approvals'
  and (
    split_part(name, '/', 1) = (select emp_id::text from public.users where auth_user_id = auth.uid() limit 1)
    or exists (
      select 1 from public.users
      where auth_user_id = auth.uid()
        and role in ('admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager')
    )
  )
);
