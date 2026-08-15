-- Restrict the activity coordination feature to admin users only.

create or replace function public.activity_coordination_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.app_current_role() = 'admin', false)
$$;

revoke all on function public.activity_coordination_is_admin() from public;
grant execute on function public.activity_coordination_is_admin() to authenticated;

create or replace function public.activity_coordination_contact_emails(
  p_contact_ids bigint[]
)
returns table (
  contact_id bigint,
  email text,
  is_primary boolean,
  active boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.activity_coordination_is_admin() then
    raise exception 'activity_coordination_not_authorized';
  end if;

  return query
  select ce.contact_id, ce.email, ce.is_primary, ce.active
  from public.contact_emails ce
  where ce.active = true
    and ce.contact_id = any(coalesce(p_contact_ids, array[]::bigint[]));
end;
$$;

revoke all on function public.activity_coordination_contact_emails(bigint[]) from public;
grant execute on function public.activity_coordination_contact_emails(bigint[]) to authenticated;

drop policy if exists activity_coordination_dispatches_select_activities_viewers on public.activity_coordination_dispatches;
drop policy if exists activity_coordination_dispatches_select_admin on public.activity_coordination_dispatches;
create policy activity_coordination_dispatches_select_admin
  on public.activity_coordination_dispatches
  for select to authenticated
  using (public.activity_coordination_is_admin());

drop policy if exists activity_coordination_dispatch_items_select_activities_viewers on public.activity_coordination_dispatch_items;
drop policy if exists activity_coordination_dispatch_items_select_admin on public.activity_coordination_dispatch_items;
create policy activity_coordination_dispatch_items_select_admin
  on public.activity_coordination_dispatch_items
  for select to authenticated
  using (public.activity_coordination_is_admin());

create or replace function public.reserve_activity_coordination_dispatch(
  p_school_id bigint,
  p_activity_season text,
  p_recipient_contact_id bigint,
  p_recipient_email text,
  p_recipient_name text,
  p_cc_email text,
  p_subject text,
  p_summary_pdf_filename text,
  p_photography_pdf_filename text,
  p_idempotency_key text,
  p_client_correlation_id uuid,
  p_items jsonb
)
returns public.activity_coordination_dispatches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dispatch public.activity_coordination_dispatches;
  v_email text := lower(regexp_replace(btrim(coalesce(p_recipient_email, '')), '\s+', '', 'g'));
  v_item jsonb;
  v_row_id text;
  v_hash text;
  v_ids text[];
begin
  if not public.activity_coordination_is_admin() then raise exception 'activity_coordination_not_authorized'; end if;
  if p_school_id is null or btrim(coalesce(p_activity_season, '')) = '' or v_email = '' then
    raise exception 'activity_coordination_invalid_recipient';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'activity_coordination_items_required';
  end if;

  select array_agg(value->>'activity_row_id' order by value->>'activity_row_id') into v_ids
  from jsonb_array_elements(p_items);
  if array_position(v_ids, null) is not null or cardinality(v_ids) <> cardinality(array(select distinct unnest(v_ids))) then
    raise exception 'activity_coordination_duplicate_or_missing_activity';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(array_to_string(v_ids, '|'), 0));

  if exists (
    select 1 from unnest(v_ids) requested(row_id)
    left join public.activities a on a.row_id = requested.row_id
    where a.row_id is null
      or a.school_id is distinct from p_school_id
      or a.activity_season is distinct from p_activity_season
  ) then raise exception 'activity_coordination_activity_scope_mismatch'; end if;

  select * into v_dispatch
  from public.activity_coordination_dispatches
  where idempotency_key = p_idempotency_key and status in ('reserved', 'creating', 'draft');
  if found then return v_dispatch; end if;

  insert into public.activity_coordination_dispatches (
    school_id, activity_season, recipient_contact_id, recipient_email, recipient_name, cc_email,
    subject, summary_pdf_filename, photography_pdf_filename, idempotency_key,
    client_correlation_id, status, draft_created_by
  ) values (
    p_school_id, p_activity_season, p_recipient_contact_id, v_email, nullif(btrim(p_recipient_name), ''),
    nullif(lower(regexp_replace(btrim(coalesce(p_cc_email, '')), '\s+', '', 'g')), ''),
    p_subject, p_summary_pdf_filename, p_photography_pdf_filename, p_idempotency_key,
    p_client_correlation_id, 'reserved', auth.uid()
  ) returning * into v_dispatch;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_row_id := v_item->>'activity_row_id';
    v_hash := lower(v_item->>'document_data_hash');
    if v_hash !~ '^[0-9a-f]{64}$' then raise exception 'activity_coordination_invalid_document_hash'; end if;
    insert into public.activity_coordination_dispatch_items (
      dispatch_id, activity_row_id, document_data_hash, open_draft_hash
    ) values (v_dispatch.id, v_row_id, v_hash, v_hash);
  end loop;

  return v_dispatch;
exception
  when unique_violation then
    select d.* into v_dispatch
    from public.activity_coordination_dispatches d
    where d.idempotency_key = p_idempotency_key and d.status in ('reserved', 'creating', 'draft');
    if found then return v_dispatch; end if;
    raise exception 'activity_coordination_open_draft_exists';
end;
$$;

create or replace function public.mark_activity_coordination_dispatch_draft(
  p_dispatch_id uuid,
  p_graph_message_id text,
  p_graph_internet_message_id text,
  p_graph_web_link text
)
returns public.activity_coordination_dispatches
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_dispatch public.activity_coordination_dispatches;
begin
  if not public.activity_coordination_is_admin() then raise exception 'activity_coordination_not_authorized'; end if;
  update public.activity_coordination_dispatches
  set status = 'draft', graph_message_id = nullif(btrim(p_graph_message_id), ''),
      graph_internet_message_id = nullif(btrim(p_graph_internet_message_id), ''),
      graph_web_link = nullif(btrim(p_graph_web_link), ''), draft_created_at = now(), updated_at = now()
  where id = p_dispatch_id and status in ('reserved', 'creating')
    and nullif(btrim(p_graph_message_id), '') is not null
  returning * into v_dispatch;
  if not found then raise exception 'activity_coordination_dispatch_not_reservable'; end if;
  return v_dispatch;
end;
$$;

create or replace function public.finish_activity_coordination_dispatch(
  p_dispatch_id uuid,
  p_status text,
  p_sent_at timestamptz default null,
  p_reconciliation_error text default null
)
returns public.activity_coordination_dispatches
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_dispatch public.activity_coordination_dispatches;
begin
  if not public.activity_coordination_is_admin() then raise exception 'activity_coordination_not_authorized'; end if;
  if p_status not in ('sent', 'failed', 'cancelled') then raise exception 'activity_coordination_invalid_final_status'; end if;
  update public.activity_coordination_dispatches
  set status = p_status,
      sent_at = case when p_status = 'sent' then p_sent_at else sent_at end,
      sent_verified_at = case when p_status = 'sent' then now() else sent_verified_at end,
      last_reconciled_at = now(), reconciliation_error = nullif(btrim(p_reconciliation_error), ''), updated_at = now()
  where id = p_dispatch_id
    and (p_status <> 'sent' or (status = 'draft' and graph_message_id is not null and p_sent_at is not null))
  returning * into v_dispatch;
  if not found then raise exception 'activity_coordination_dispatch_transition_rejected'; end if;
  update public.activity_coordination_dispatch_items set open_draft_hash = null where dispatch_id = p_dispatch_id;
  return v_dispatch;
end;
$$;

create or replace function public.record_activity_coordination_reconciliation(
  p_dispatch_id uuid,
  p_reconciliation_error text default null,
  p_increment_missing boolean default false
)
returns public.activity_coordination_dispatches
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_dispatch public.activity_coordination_dispatches;
begin
  if not public.activity_coordination_is_admin() then raise exception 'activity_coordination_not_authorized'; end if;
  update public.activity_coordination_dispatches
  set last_reconciled_at = now(), reconciliation_error = nullif(btrim(p_reconciliation_error), ''),
      reconciliation_miss_count = case when p_increment_missing then reconciliation_miss_count + 1 else 0 end,
      updated_at = now()
  where id = p_dispatch_id and status = 'draft'
  returning * into v_dispatch;
  if not found then raise exception 'activity_coordination_dispatch_not_draft'; end if;
  return v_dispatch;
end;
$$;

create or replace view public.activity_coordination_activity_status_view
with (security_invoker = true)
as
select
  a.row_id as activity_row_id,
  latest_sent.dispatch_id as latest_sent_dispatch_id,
  latest_sent.document_data_hash as latest_sent_document_data_hash,
  latest_sent.sent_at,
  active_draft.dispatch_id as active_draft_dispatch_id,
  active_draft.document_data_hash as active_draft_document_data_hash,
  active_draft.draft_created_at,
  active_draft.recipient_email,
  active_draft.reconciliation_error,
  active_draft.graph_message_id,
  active_draft.client_correlation_id,
  active_draft.summary_pdf_filename,
  active_draft.photography_pdf_filename,
  active_draft.last_reconciled_at,
  active_draft.reconciliation_miss_count
from public.activities a
left join lateral (
  select d.id as dispatch_id, i.document_data_hash, d.sent_at
  from public.activity_coordination_dispatch_items i
  join public.activity_coordination_dispatches d on d.id = i.dispatch_id
  where i.activity_row_id = a.row_id and d.status = 'sent'
  order by d.sent_verified_at desc, d.created_at desc limit 1
) latest_sent on true
left join lateral (
  select d.id as dispatch_id, i.document_data_hash, d.draft_created_at,
         d.recipient_email, d.reconciliation_error, d.graph_message_id,
         d.client_correlation_id, d.summary_pdf_filename, d.photography_pdf_filename,
         d.last_reconciled_at, d.reconciliation_miss_count
  from public.activity_coordination_dispatch_items i
  join public.activity_coordination_dispatches d on d.id = i.dispatch_id
  where i.activity_row_id = a.row_id and d.status = 'draft' and i.open_draft_hash is not null
  order by d.draft_created_at desc, d.created_at desc limit 1
) active_draft on true
where public.activity_coordination_is_admin();

grant select on public.activity_coordination_activity_status_view to authenticated;

revoke all on function public.reserve_activity_coordination_dispatch(bigint,text,bigint,text,text,text,text,text,text,text,uuid,jsonb) from public;
revoke all on function public.mark_activity_coordination_dispatch_draft(uuid,text,text,text) from public;
revoke all on function public.finish_activity_coordination_dispatch(uuid,text,timestamptz,text) from public;
revoke all on function public.record_activity_coordination_reconciliation(uuid,text,boolean) from public;
grant execute on function public.reserve_activity_coordination_dispatch(bigint,text,bigint,text,text,text,text,text,text,text,uuid,jsonb) to authenticated;
grant execute on function public.mark_activity_coordination_dispatch_draft(uuid,text,text,text) to authenticated;
grant execute on function public.finish_activity_coordination_dispatch(uuid,text,timestamptz,text) to authenticated;
grant execute on function public.record_activity_coordination_reconciliation(uuid,text,boolean) to authenticated;
