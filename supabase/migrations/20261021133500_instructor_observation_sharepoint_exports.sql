-- Separate upload receipt from immutable observation content.
-- Only the Edge Function's service role may write verified SharePoint receipts.
create table if not exists public.instructor_observation_sharepoint_exports (
  observation_id uuid primary key references public.instructor_observations(id) on delete restrict,
  emp_id bigint not null,
  observation_slot smallint not null check (observation_slot in (1,2)),
  file_name text not null,
  sp_drive_id text not null,
  sp_item_id text not null,
  sp_web_url text not null,
  uploaded_at timestamptz not null default now()
);
create index if not exists instructor_observation_sharepoint_exports_emp_idx
  on public.instructor_observation_sharepoint_exports (emp_id,observation_slot,uploaded_at desc);
alter table public.instructor_observation_sharepoint_exports enable row level security;
revoke all on public.instructor_observation_sharepoint_exports from public,anon,authenticated;
grant select on public.instructor_observation_sharepoint_exports to authenticated;
drop policy if exists instructor_observation_sharepoint_exports_read on public.instructor_observation_sharepoint_exports;
create policy instructor_observation_sharepoint_exports_read
on public.instructor_observation_sharepoint_exports for select to authenticated
using (exists (
 select 1 from public.instructor_observations obs where obs.id=observation_id
 and public.can_manage_instructor_observations()
 and (obs.created_by=auth.uid() or public.app_current_role()='admin')
));
comment on table public.instructor_observation_sharepoint_exports is
'Immutable verified SharePoint PDF upload references; observation content stays locked.';
