-- Allow managers to upload signed completion approvals for the instructor on the approval.
-- Also repair historical rows that were saved under the uploading manager's employee id.

alter table public.activity_completion_approval_uploads enable row level security;

drop policy if exists activity_completion_approval_uploads_select_own_or_ops on public.activity_completion_approval_uploads;
create policy activity_completion_approval_uploads_select_own_or_ops
on public.activity_completion_approval_uploads
for select
using (
  instructor_emp_id = (select emp_id from public.users where auth_user_id = auth.uid() limit 1)
  or exists (
    select 1 from public.users
    where auth_user_id = auth.uid()
      and role in ('admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager')
  )
);

drop policy if exists activity_completion_approval_uploads_insert_own on public.activity_completion_approval_uploads;
drop policy if exists activity_completion_approval_uploads_insert_own_or_manager_for_instructor on public.activity_completion_approval_uploads;
create policy activity_completion_approval_uploads_insert_own_or_manager_for_instructor
on public.activity_completion_approval_uploads
for insert
with check (
  instructor_emp_id = (select emp_id from public.users where auth_user_id = auth.uid() limit 1)
  or exists (
    select 1 from public.users
    where auth_user_id = auth.uid()
      and role in ('admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager')
  )
);

drop policy if exists completion_approvals_storage_insert_own on storage.objects;
drop policy if exists completion_approvals_storage_insert_own_or_manager on storage.objects;
create policy completion_approvals_storage_insert_own_or_manager
on storage.objects
for insert
with check (
  bucket_id = 'completion-approvals'
  and (
    split_part(name, '/', 1) = (select emp_id from public.users where auth_user_id = auth.uid() limit 1)
    or exists (
      select 1 from public.users
      where auth_user_id = auth.uid()
        and role in ('admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager')
    )
  )
);

drop policy if exists completion_approvals_storage_select_own_or_ops on storage.objects;
create policy completion_approvals_storage_select_own_or_ops
on storage.objects
for select
using (
  bucket_id = 'completion-approvals'
  and (
    split_part(name, '/', 1) = (select emp_id from public.users where auth_user_id = auth.uid() limit 1)
    or exists (
      select 1 from public.users
      where auth_user_id = auth.uid()
        and role in ('admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager')
    )
  )
);

with instructor_directory as (
  select distinct on (normalized_name)
    normalized_name,
    emp_id
  from (
    select lower(regexp_replace(trim(coalesce(full_name, name, username, '')), '\s+', ' ', 'g')) as normalized_name,
           nullif(trim(emp_id), '') as emp_id
    from public.users
    where nullif(trim(emp_id), '') is not null
    union all
    select lower(regexp_replace(trim(coalesce(full_name, '')), '\s+', ' ', 'g')) as normalized_name,
           nullif(trim(emp_id), '') as emp_id
    from public.contacts_instructors
    where nullif(trim(emp_id), '') is not null
  ) candidates
  where normalized_name <> '' and emp_id is not null
  order by normalized_name, emp_id
)
update public.activity_completion_approval_uploads uploads
set instructor_emp_id = directory.emp_id
from instructor_directory directory
where lower(regexp_replace(trim(coalesce(uploads.instructor_name, '')), '\s+', ' ', 'g')) = directory.normalized_name
  and uploads.instructor_emp_id is distinct from directory.emp_id;

-- Explicit known corrections from the production incident, kept idempotent.
update public.activity_completion_approval_uploads
set instructor_emp_id = case
  when trim(instructor_name) = 'הילה רוזן' then '1500'
  when trim(instructor_name) = 'הנאא אבו אמזה' then '1503'
  else instructor_emp_id
end
where trim(instructor_name) in ('הילה רוזן', 'הנאא אבו אמזה')
  and instructor_emp_id is distinct from case
    when trim(instructor_name) = 'הילה רוזן' then '1500'
    when trim(instructor_name) = 'הנאא אבו אמזה' then '1503'
    else instructor_emp_id
  end;
