-- Retire app-only Outlook dispatch. SharePoint credentials and billing are unchanged.
do $$ begin
  if exists(select 1 from cron.job where jobname='finance-outlook-drafts') then
    perform cron.unschedule('finance-outlook-drafts');
  end if;
end $$;
create or replace function finance_private.dispatch_outlook_jobs() returns integer
language sql security definer set search_path='' as $$ select 0 $$;
create or replace function public.finance_authorize_outlook_job(p_account_id uuid,p_token uuid) returns boolean
language sql set search_path='' as $$ select false $$;
revoke all on function public.finance_authorize_outlook_job(uuid,uuid) from public,anon,authenticated,service_role;

alter table public.finance_transaction_accounts drop constraint finance_transaction_accounts_outlook_status_check;
alter table public.finance_transaction_accounts add constraint finance_transaction_accounts_outlook_status_check
  check(outlook_status in ('pending','draft_ready','failed','missing_recipient','needs_review','already_sent','waiting_connection'));

create function public.finance_delegated_account_owner(p_account_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.finance_transaction_can_issue() and exists(select 1 from public.finance_transaction_accounts
    where id=p_account_id and outlook_owner_id=auth.uid());
$$;
revoke all on function public.finance_delegated_account_owner(uuid) from public,anon;
grant execute on function public.finance_delegated_account_owner(uuid) to authenticated;

create function public.finance_pending_delegated_accounts(p_reconnected boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not coalesce(public.finance_transaction_can_issue(),false) then
    raise exception 'finance_transactions_permission_denied' using errcode='42501';
  end if;
  if p_reconnected then
    update finance_private.outlook_jobs j set state='pending',attempts=0,next_retry_at=now()
    from public.finance_transaction_accounts a where a.id=j.account_id and a.outlook_owner_id=auth.uid() and (a.outlook_status='waiting_connection' or (a.outlook_status='failed' and a.outlook_error='invoice_microsoft_account_mismatch'));
  end if;
  return (select coalesce(jsonb_agg(q),'[]') from (
    select a.id,a.outlook_owner_mailbox from public.finance_transaction_accounts a
    join finance_private.outlook_jobs j on j.account_id=a.id
    where a.outlook_owner_id=auth.uid() and a.document_status in ('issued','mail_draft_ready')
      and a.outlook_status in ('pending','waiting_connection','failed','missing_recipient','needs_review')
      and j.state='pending' and j.attempts<10 and j.next_retry_at<=now()
    order by a.created_at limit 20
  ) q);
end $$;
revoke all on function public.finance_pending_delegated_accounts(boolean) from public,anon;
grant execute on function public.finance_pending_delegated_accounts(boolean) to authenticated;

-- Revive safe failures from the retired Application path, never uncertain POSTs.
update finance_private.outlook_jobs j set state='pending',attempts=0,next_retry_at=now()
from public.finance_transaction_accounts a where a.id=j.account_id and a.outlook_status in ('pending','failed')
  and (a.outlook_error is null or a.outlook_error in ('invoice_mailbox_access_denied','automatic_retry_exhausted','graph_auth_failed')
    or a.outlook_error like 'graph_request_failed:403:%');
update public.finance_transaction_accounts a set outlook_status='waiting_connection'
where a.outlook_status in ('pending','failed') and exists(select 1 from finance_private.outlook_jobs j where j.account_id=a.id and j.state='pending');

create or replace function public.mark_finance_transaction_outlook(p_account_id uuid,p_status text,p_message_id text default null,p_error text default null,
  p_token uuid default null,p_recipients jsonb default null,p_mailbox text default null,p_creation_rejected boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  if p_token is not null then perform public.validate_finance_dispatch(p_account_id,p_token); end if;
  if p_mailbox is not null and not exists(select 1 from public.finance_transaction_accounts where id=p_account_id and outlook_owner_mailbox=p_mailbox) then
    raise exception 'invoice_mailbox_identity_changed';
  end if;
  if p_status not in ('draft_ready','failed','missing_recipient','needs_review','already_sent','waiting_connection') then raise exception 'invalid_outlook_status'; end if;
  update public.finance_transaction_accounts set outlook_status=p_status,
    outlook_message_id=coalesce(p_message_id,outlook_message_id),outlook_error=p_error,outlook_attempted_at=now(),
    outlook_recipients=coalesce(p_recipients,outlook_recipients),outlook_mailbox=coalesce(p_mailbox,outlook_mailbox),
    outlook_creation_started_at=case when p_creation_rejected then null else outlook_creation_started_at end,
    document_status=case when p_status='draft_ready' then 'mail_draft_ready' when p_status='already_sent' then 'sent'
      when document_status='mail_draft_ready' then 'issued' else document_status end
    where id=p_account_id and document_status in ('issued','mail_draft_ready','sent');
  if not found then raise exception 'account_not_dispatchable'; end if;
  update finance_private.outlook_jobs set
    attempts=attempts+case when p_status in ('draft_ready','already_sent') then 0 else 1 end,
    state=case when p_status in ('draft_ready','already_sent') then 'ready' when attempts>=9 or p_error in ('invoice_microsoft_account_mismatch','invoice_mailbox_identity_changed','invoice_mailbox_existing_draft_mismatch') then 'blocked' else 'pending' end,
    next_retry_at=now()+case when p_status='missing_recipient' then interval '1 hour' else interval '5 minutes'*least(12,greatest(1,attempts)) end,
    last_error=p_error where account_id=p_account_id;
end $$;
revoke all on function public.mark_finance_transaction_outlook(uuid,text,text,text,uuid,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.mark_finance_transaction_outlook(uuid,text,text,text,uuid,jsonb,text,boolean) to service_role;
