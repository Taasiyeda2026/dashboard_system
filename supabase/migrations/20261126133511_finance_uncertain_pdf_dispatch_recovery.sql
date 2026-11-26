begin;

alter table public.finance_transaction_accounts add column dispatch_upload_hash text;
create index finance_dispatch_recovery_idx on public.finance_transaction_accounts(created_by,created_at)
  where document_status='generating' and dispatch_upload_hash is not null;

create or replace function public.acquire_finance_dispatch(p_account_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
declare status text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  select document_status into status from public.finance_transaction_accounts where id=p_account_id for update;
  if exists(select 1 from finance_private.account_deletions where account_id=p_account_id) then
    raise exception 'finance_account_deletion_in_progress';
  end if;
  if status is null or status='cancelled' then raise exception 'account_not_dispatchable'; end if;
  if status='generating' and exists(select 1 from public.finance_transaction_accounts where id=p_account_id and dispatch_upload_hash is null and created_at<now()-interval '15 minutes') then raise exception 'reservation_expired'; end if;
  insert into finance_private.dispatch_leases values(p_account_id,p_token,now()+interval '10 minutes')
    on conflict(account_id) do update set token=excluded.token,expires_at=excluded.expires_at where finance_private.dispatch_leases.expires_at<now();
  if not found then raise exception 'dispatch_in_progress'; end if;
end $$;

create or replace function finance_private.cancel_reservation(p_account_id uuid,p_reason text) returns void
language plpgsql set search_path='' as $$
declare status text; upload_hash text; account_number text; reserved_number boolean;
begin
  select document_status,dispatch_upload_hash,transaction_account_number,dispatch_number_reserved into status,upload_hash,account_number,reserved_number from public.finance_transaction_accounts where id=p_account_id for update;
  if status is distinct from 'generating' then raise exception 'account_not_cancellable'; end if;
  if upload_hash is not null then raise exception 'finance_pdf_upload_outcome_unknown'; end if;
  if reserved_number and account_number~'^Pl[0-9]+$' then
    update finance_private.account_numbering set next_number=next_number-1
      where singleton and next_number-1=substring(account_number from 3)::bigint;
    if found then
      update public.finance_transaction_accounts set transaction_account_number=null where id=p_account_id;
    end if;
  end if;
  delete from public.finance_billing_claims where account_id=p_account_id;
  delete from public.finance_transaction_account_meetings where account_line_id in (select id from public.finance_transaction_account_lines where account_id=p_account_id);
  delete from public.finance_transaction_account_lines where account_id=p_account_id;
  update public.finance_transaction_accounts set document_status='cancelled',cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=p_reason where id=p_account_id;
end $$;

create or replace function public.finance_transaction_recipients(p_account_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare account public.finance_transaction_accounts; result jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  select * into account from public.finance_transaction_accounts where id=p_account_id;
  if not found then raise exception 'account_not_found'; end if;
  if account.document_revision>0 or account.replaces_account_id is not null then
    select jsonb_build_object('recipients',coalesce(jsonb_agg(email order by email),'[]'),'invalidCount',0) into result from
      (select distinct lower(btrim(x)) email from regexp_split_to_table(coalesce(account.customer_email_snapshot,''),'[;,\n\r]+') x where btrim(x) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') revised;
    return result;
  end if;
  return finance_private.payer_recipients(
    array(select l.activity_row_id from public.finance_transaction_account_lines l where l.account_id=p_account_id),
    account.payer_key_snapshot, account.authority_id_snapshot, account.funding_source_id_snapshot,
    case when account.manual_draft is not null and (
      account.payer_key_snapshot not like 'school:%'
      or account.document_status='generating' or account.dispatch_number_reserved
    ) then account.customer_email_snapshot end
  );
end $$;

create function public.finance_stage_pdf_upload(p_account_id uuid,p_token uuid,p_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  if p_hash is null or p_hash!~'^[a-f0-9]{64}$' then raise exception 'invalid_pdf_hash';end if;
  perform 1 from public.finance_transaction_accounts where id=p_account_id for update;
  if not exists(select 1 from finance_private.dispatch_leases
    where account_id=p_account_id and token=p_token and expires_at>now()) then raise exception 'dispatch_lease_expired';end if;
  update public.finance_transaction_accounts set dispatch_upload_hash=p_hash
    where id=p_account_id and document_status='generating'
      and (dispatch_upload_hash is null or dispatch_upload_hash=p_hash);
  if not found then raise exception 'finance_pdf_upload_outcome_unknown';end if;
end $$;

create function public.finance_clear_failed_pdf_upload(p_account_id uuid,p_token uuid,p_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  perform 1 from public.finance_transaction_accounts where id=p_account_id for update;
  if not exists(select 1 from finance_private.dispatch_leases
    where account_id=p_account_id and token=p_token and expires_at>now()) then raise exception 'dispatch_lease_expired';end if;
  update public.finance_transaction_accounts set dispatch_upload_hash=null
    where id=p_account_id and document_status='generating' and dispatch_upload_hash=p_hash;
end $$;

create function public.finance_pending_pdf_uploads() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.finance_transaction_can_issue(),false) then
    raise exception 'finance_transactions_permission_denied' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'customerName',a.customer_name_snapshot,
    'createdAt',a.created_at,'total',a.total_amount) order by a.created_at),'[]')
    from public.finance_transaction_accounts a
    where a.document_status='generating' and a.dispatch_upload_hash is not null
      and (a.created_by=auth.uid() or public.app_current_role()='admin'));
end $$;

revoke all on function public.finance_stage_pdf_upload(uuid,uuid,text),public.finance_clear_failed_pdf_upload(uuid,uuid,text),
  public.finance_pending_pdf_uploads() from public,anon,authenticated,service_role;
grant execute on function public.finance_stage_pdf_upload(uuid,uuid,text),public.finance_clear_failed_pdf_upload(uuid,uuid,text) to service_role;
grant execute on function public.finance_pending_pdf_uploads() to authenticated;

commit;
