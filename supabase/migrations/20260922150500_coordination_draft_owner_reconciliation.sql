-- Keep Outlook reconciliation tied to the employee who created the draft.
-- This prevents one admin's /me mailbox from falsely cancelling another admin's
-- coordination draft after a 404 in Microsoft Graph.

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
  active_draft.reconciliation_miss_count,
  active_draft.draft_created_by
from public.activities a
left join lateral (
  select d.id as dispatch_id, i.document_data_hash, d.sent_at
  from public.activity_coordination_dispatch_items i
  join public.activity_coordination_dispatches d on d.id = i.dispatch_id
  where i.activity_row_id = a.row_id and d.status = 'sent'
  order by d.sent_verified_at desc, d.created_at desc
  limit 1
) latest_sent on true
left join lateral (
  select
    d.id as dispatch_id,
    i.document_data_hash,
    d.draft_created_at,
    d.recipient_email,
    d.reconciliation_error,
    d.graph_message_id,
    d.client_correlation_id,
    d.summary_pdf_filename,
    d.photography_pdf_filename,
    d.last_reconciled_at,
    d.reconciliation_miss_count,
    d.draft_created_by
  from public.activity_coordination_dispatch_items i
  join public.activity_coordination_dispatches d on d.id = i.dispatch_id
  where i.activity_row_id = a.row_id
    and d.status = 'draft'
    and i.open_draft_hash is not null
  order by d.draft_created_at desc, d.created_at desc
  limit 1
) active_draft on true
where public.activity_coordination_is_admin();

grant select on public.activity_coordination_activity_status_view to authenticated;

-- A server-side Graph reconciliation experiment cannot be used until the Azure
-- application has mailbox-read application permission. Keep these dispatch tables
-- browser/RPC-only rather than broadening service_role access.
revoke select, update on table public.activity_coordination_dispatches from service_role;
revoke select, update on table public.activity_coordination_dispatch_items from service_role;
