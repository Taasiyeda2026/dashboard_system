-- Align sensitive DB predicates with the explicit permissions managed in the
-- Admin permissions workspace. Roles remain templates for future UI actions;
-- this migration only materializes access that the legacy runtime already gave.

-- Snapshot of legacy effective route/action access. This is deliberately not
-- ROLE_PERMISSION_TEMPLATES: adding a permission to a future role template must
-- never change this compatibility migration. Existing JSON values (including
-- explicit "no") and canonical proposal columns always win.
with legacy_effective_permissions(role, defaults) as (values
  ('operation_manager', jsonb_build_object(
    'view_dashboard','yes','view_activities','yes','view_activity_calendar','yes',
    'view_activity_exceptions','yes','view_activity_end_dates','yes','view_activity_archive','yes',
    'view_contacts','yes','view_instructors','yes','view_instructor_list','yes',
    'view_instructor_contacts','yes','view_certificates','yes','view_catalog','yes','view_orders','yes',
    'view_proposals_agreements','yes','manage_proposals_agreements','yes',
    'view_operations_management','yes','view_operations_scheduling','yes',
    'view_attendance_control','yes','view_activity_approvals','yes','view_workshop_stock','yes',
    'view_workshop_stock_distributions','yes','can_add_activity','yes','can_edit_direct','yes',
    'can_request_edit','yes','can_review_requests','yes')),
  ('activities_manager', jsonb_build_object(
    'view_dashboard','yes','view_activities','yes','view_activity_calendar','yes',
    'view_activity_exceptions','yes','view_activity_end_dates','yes','view_activity_archive','yes',
    'view_contacts','yes','view_instructors','yes','view_instructor_list','yes',
    'view_instructor_contacts','yes','view_certificates','yes','view_catalog','yes','view_orders','yes',
    'view_operations_management','yes','can_add_activity','yes','can_request_edit','yes')),
  ('finance', jsonb_build_object(
    'view_dashboard','yes','view_activities','yes','view_activity_calendar','yes',
    'view_activity_exceptions','yes','view_activity_end_dates','yes','view_activity_archive','yes',
    'view_contacts','yes','view_instructors','yes','view_instructor_list','yes',
    'view_instructor_contacts','yes','view_certificates','yes','view_catalog','yes','view_orders','yes')),
  ('domain_manager', jsonb_build_object(
    'view_dashboard','yes','view_activities','yes','view_activity_calendar','yes',
    'view_activity_exceptions','yes','view_activity_end_dates','yes','view_activity_archive','yes',
    'view_contacts','yes','view_instructors','yes','view_instructor_list','yes',
    'view_instructor_contacts','yes','view_certificates','yes','view_catalog','yes','view_orders','yes',
    'view_proposals_agreements','yes','manage_proposals_agreements','yes')),
  ('business_development_manager', jsonb_build_object(
    'view_dashboard','yes','view_activities','yes','view_activity_calendar','yes',
    'view_activity_exceptions','yes','view_activity_end_dates','yes','view_activity_archive','yes',
    'view_contacts','yes','view_instructors','yes','view_instructor_list','yes',
    'view_instructor_contacts','yes','view_certificates','yes','view_catalog','yes','view_orders','yes',
    'view_proposals_agreements','yes','can_add_activity','yes','can_request_edit','yes')),
  ('instructor_manager', jsonb_build_object(
    'view_dashboard','yes','view_activities','yes','view_activity_calendar','yes',
    'view_activity_exceptions','yes','view_activity_end_dates','yes','view_activity_archive','yes',
    'view_contacts','yes','view_instructors','yes','view_instructor_list','yes',
    'view_instructor_contacts','yes','view_certificates','yes','view_catalog','yes','view_orders','yes',
    'can_add_activity','yes','can_request_edit','yes')),
  ('authorized_user', jsonb_build_object(
    'view_dashboard','yes','view_activities','yes','view_activity_calendar','yes',
    'view_activity_exceptions','yes','view_activity_end_dates','yes','view_activity_archive','yes',
    'view_contacts','yes','view_instructors','yes','view_instructor_list','yes',
    'view_instructor_contacts','yes','view_certificates','yes','can_add_activity','yes','can_request_edit','yes')),
  ('instructor', jsonb_build_object(
    'view_instructor_portal','yes','view_instructor_calendar','yes','view_instructor_data','yes',
    'view_instructor_completion_approvals','yes','view_instructor_guidelines','yes'))
)
update public.users u
set permissions = lep.defaults || jsonb_strip_nulls(jsonb_build_object(
      'view_proposals_agreements', u.view_proposals_agreements,
      'manage_proposals_agreements', u.manage_proposals_agreements,
      'approve_proposals_agreements', u.approve_proposals_agreements))
    || coalesce(u.permissions, '{}'::jsonb),
    updated_at = now()
from legacy_effective_permissions lep
where u.role = lep.role
  and coalesce(u.permissions, '{}'::jsonb) is distinct from
    (lep.defaults || jsonb_strip_nulls(jsonb_build_object(
        'view_proposals_agreements', u.view_proposals_agreements,
        'manage_proposals_agreements', u.manage_proposals_agreements,
        'approve_proposals_agreements', u.approve_proposals_agreements))
      || coalesce(u.permissions, '{}'::jsonb));

-- Legacy view_proposals is intentionally not promoted to the canonical
-- proposals/agreement permission. The old SPA flag could expose a route while
-- database RLS still denied access, so promoting it here would widen access.

create or replace function public.app_can_edit_direct()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin' or public.app_has_permission('can_edit_direct'), false)
$$;

create or replace function public.app_can_add_activity()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin' or public.app_has_permission('can_add_activity'), false)
$$;

create or replace function public.app_can_use_proposals_agreements()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin'
    or public.app_has_permission('view_proposals_agreements'), false)
$$;

create or replace function public.app_can_manage_proposals_agreements()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin'
    or (
      public.app_has_permission('view_proposals_agreements')
      and public.app_has_permission('manage_proposals_agreements')
    ), false)
$$;

create or replace function public.app_can_view_proposals_agreements()
returns boolean language sql stable security definer set search_path = public as $$
  select public.app_can_use_proposals_agreements()
$$;

create or replace function public.app_can_approve_proposals_agreements()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin', false)
$$;

-- Read compatibility is intentionally limited to SELECT. No legacy view flag
-- participates in a write predicate.
drop policy if exists proposals_agreements_select_allowed_roles on public.proposals_agreements;
drop policy if exists proposals_agreements_insert_allowed_roles on public.proposals_agreements;
drop policy if exists proposals_agreements_update_allowed_roles on public.proposals_agreements;
drop policy if exists proposals_agreements_delete_explicit_manage on public.proposals_agreements;
create policy proposals_agreements_select_allowed_roles on public.proposals_agreements
  for select to authenticated using (public.app_can_use_proposals_agreements());
create policy proposals_agreements_insert_allowed_roles on public.proposals_agreements
  for insert to authenticated with check (public.app_can_manage_proposals_agreements());
create policy proposals_agreements_update_allowed_roles on public.proposals_agreements
  for update to authenticated
  using (public.app_can_manage_proposals_agreements())
  with check (public.app_can_manage_proposals_agreements());
create policy proposals_agreements_delete_explicit_manage on public.proposals_agreements
  for delete to authenticated using (public.app_can_manage_proposals_agreements());
grant select, insert, update, delete on public.proposals_agreements to authenticated;
alter view public.proposals_agreements_directory_view set (security_invoker = true);

drop policy if exists proposal_agreement_items_select on public.proposal_agreement_items;
drop policy if exists proposal_agreement_items_insert on public.proposal_agreement_items;
drop policy if exists proposal_agreement_items_update on public.proposal_agreement_items;
drop policy if exists proposal_agreement_items_delete on public.proposal_agreement_items;
create policy proposal_agreement_items_select on public.proposal_agreement_items
  for select to authenticated using (public.app_can_use_proposals_agreements());
create policy proposal_agreement_items_insert on public.proposal_agreement_items
  for insert to authenticated with check (public.app_can_manage_proposals_agreements());
create policy proposal_agreement_items_update on public.proposal_agreement_items
  for update to authenticated using (public.app_can_manage_proposals_agreements())
  with check (public.app_can_manage_proposals_agreements());
create policy proposal_agreement_items_delete on public.proposal_agreement_items
  for delete to authenticated using (public.app_can_manage_proposals_agreements());
grant select, insert, update, delete on public.proposal_agreement_items to authenticated;

create or replace function public.guard_proposals_agreements_explicit_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.app_current_role() = 'admin' then return new; end if;
  if public.app_can_manage_proposals_agreements() then
    if (new.status = 'approved' and new.status is distinct from old.status)
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
      or new.signature_meta is distinct from old.signature_meta then
      if not public.app_can_approve_proposals_agreements() then
        raise exception 'proposals_agreements_approval_forbidden' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  raise exception 'proposals_agreements_manage_forbidden' using errcode = '42501';
end;
$$;
drop trigger if exists proposals_agreements_explicit_permissions on public.proposals_agreements;
create trigger proposals_agreements_explicit_permissions before update on public.proposals_agreements
  for each row execute function public.guard_proposals_agreements_explicit_permissions();

alter function public.save_proposal_agreement_items_atomic(uuid, jsonb)
  rename to save_proposal_agreement_items_atomic_legacy_impl;
revoke all on function public.save_proposal_agreement_items_atomic_legacy_impl(uuid, jsonb)
  from public, anon, authenticated;
create function public.save_proposal_agreement_items_atomic(
  p_proposal_id uuid, p_items jsonb default '[]'::jsonb
) returns table(id uuid, item_name text, sort_order integer)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.app_can_manage_proposals_agreements() then
    raise exception 'proposal_agreement_items_forbidden' using errcode = '42501';
  end if;
  return query select * from public.save_proposal_agreement_items_atomic_legacy_impl(p_proposal_id, p_items);
end;
$$;
grant execute on function public.save_proposal_agreement_items_atomic(uuid, jsonb) to authenticated;

drop policy if exists "proposal_final_pdfs_storage_insert" on storage.objects;
create policy "proposal_final_pdfs_storage_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'proposal-final-pdfs' and public.app_can_manage_proposals_agreements()
  );

create or replace function public.app_can_access_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin'
    or public.app_has_permission('finance_access')
    or public.app_has_permission('view_finance'), false)
$$;

create or replace function public.app_can_access_operations_area(flag text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'admin' or public.app_has_permission(flag), false)
$$;

revoke all on function public.app_can_access_operations_area(text) from public, anon;
grant execute on function public.app_can_access_operations_area(text) to authenticated;

-- Keep the existing finance implementations intact, but put explicit business
-- tool checks in front of their SECURITY DEFINER entry points.
alter function public.list_finance_collection_tracking() rename to list_finance_collection_tracking_legacy_impl;
alter function public.upsert_finance_collection_tracking(text, text, date, text) rename to upsert_finance_collection_tracking_legacy_impl;
alter function public.reserve_finance_transaction_account(uuid, date, text, text, text, jsonb) rename to reserve_finance_transaction_account_legacy_impl;

revoke all on function public.list_finance_collection_tracking_legacy_impl() from public, anon, authenticated;
revoke all on function public.upsert_finance_collection_tracking_legacy_impl(text, text, date, text) from public, anon, authenticated;
revoke all on function public.reserve_finance_transaction_account_legacy_impl(uuid, date, text, text, text, jsonb) from public, anon, authenticated;

create function public.list_finance_collection_tracking()
returns setof public.finance_collection_tracking
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_current_role() <> 'admin' and not public.app_has_permission('view_finance_collection') then
    raise exception 'finance_collection_permission_denied' using errcode = '42501';
  end if;
  return query select * from public.list_finance_collection_tracking_legacy_impl();
end;
$$;

create function public.upsert_finance_collection_tracking(
  p_activity_row_id text, p_collection_status text,
  p_expected_collection_date date default null, p_finance_note text default ''
) returns public.finance_collection_tracking
language plpgsql security definer set search_path = public as $$
begin
  if public.app_current_role() <> 'admin' and not public.app_has_permission('view_finance_collection') then
    raise exception 'finance_collection_permission_denied' using errcode = '42501';
  end if;
  return public.upsert_finance_collection_tracking_legacy_impl(
    p_activity_row_id, p_collection_status, p_expected_collection_date, p_finance_note
  );
end;
$$;

create function public.reserve_finance_transaction_account(
  p_idempotency_key uuid, p_cutoff_date date, p_institution_symbol text,
  p_customer_name text, p_customer_email text, p_lines jsonb
) returns public.finance_transaction_accounts
language plpgsql security definer set search_path = public as $$
begin
  if public.app_current_role() <> 'admin' and not public.app_has_permission('manage_finance_transactions') then
    raise exception 'finance_transactions_permission_denied' using errcode = '42501';
  end if;
  return public.reserve_finance_transaction_account_legacy_impl(
    p_idempotency_key, p_cutoff_date, p_institution_symbol,
    p_customer_name, p_customer_email, p_lines
  );
end;
$$;

grant execute on function public.list_finance_collection_tracking() to authenticated;
grant execute on function public.upsert_finance_collection_tracking(text, text, date, text) to authenticated;
grant execute on function public.reserve_finance_transaction_account(uuid, date, text, text, text, jsonb) to authenticated;

-- The distribution table contains employee-level issue history. Replace broad
-- authenticated policies with the explicit distribution permission when present.
do $do$
begin
  if to_regclass('public.workshop_stock_distributions') is null then return; end if;
  alter table public.workshop_stock_distributions enable row level security;
  drop policy if exists workshop_stock_distributions_explicit_select on public.workshop_stock_distributions;
  create policy workshop_stock_distributions_explicit_select
    on public.workshop_stock_distributions for select to authenticated
    using (public.app_can_access_operations_area('view_workshop_stock_distributions'));
  drop policy if exists workshop_stock_distributions_permission_boundary on public.workshop_stock_distributions;
  create policy workshop_stock_distributions_permission_boundary
    on public.workshop_stock_distributions as restrictive for all to authenticated
    using (public.app_can_access_operations_area('view_workshop_stock_distributions'))
    with check (public.app_can_access_operations_area('view_workshop_stock_distributions'));
  drop policy if exists workshop_stock_distributions_explicit_write on public.workshop_stock_distributions;
  create policy workshop_stock_distributions_explicit_write
    on public.workshop_stock_distributions for all to authenticated
    using (public.app_can_access_operations_area('view_workshop_stock_distributions'))
    with check (public.app_can_access_operations_area('view_workshop_stock_distributions'));
end
$do$;
