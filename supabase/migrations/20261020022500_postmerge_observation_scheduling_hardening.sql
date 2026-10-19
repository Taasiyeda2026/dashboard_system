-- Post-merge performance hardening for manager instructor observations and
-- explicit permanent scheduling availability approvals (no activity mutations).

-- Cover both new foreign keys so approval/substitution lookups scale.
create index if not exists course_meeting_instructor_history_availability_approval_idx
  on public.course_meeting_instructor_history (availability_approval_id);
create index if not exists scheduling_permanent_availability_approvals_emp_id_idx
  on public.scheduling_permanent_availability_approvals (emp_id);

-- Keep the same authorization contract while using per-statement initPlans
-- for stable authenticated identity/permission checks.
drop policy if exists instructor_observations_read on public.instructor_observations;
create policy instructor_observations_read on public.instructor_observations
  for select to authenticated using (
    (select public.can_manage_instructor_observations())
    and (created_by = (select auth.uid()) or (select public.app_current_role()) = 'admin')
  );
drop policy if exists instructor_observations_insert on public.instructor_observations;
create policy instructor_observations_insert on public.instructor_observations
  for insert to authenticated with check (
    (select public.can_manage_instructor_observations())
    and created_by = (select auth.uid())
    and status = 'draft'
  );
drop policy if exists instructor_observations_update on public.instructor_observations;
create policy instructor_observations_update on public.instructor_observations
  for update to authenticated
  using (
    (select public.can_manage_instructor_observations())
    and created_by = (select auth.uid())
    and status = 'draft'
  )
  with check (
    (select public.can_manage_instructor_observations())
    and created_by = (select auth.uid())
    and status in ('draft','completed')
  );

-- Scheduling approvals intentionally have RLS with zero browser policies
-- and zero authenticated table privileges. Access only via vetted RPC.
