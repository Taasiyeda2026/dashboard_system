begin;

lock table public.finance_transaction_accounts in access exclusive mode;
alter table public.finance_transaction_accounts add column deleted_at timestamptz,
  add column dispatch_number_reserved boolean not null default false;
alter policy finance_transaction_accounts_read on public.finance_transaction_accounts
  using ((select public.app_can_access_finance()) and document_status<>'generating' and deleted_at is null);

create or replace function finance_private.invoice_hash(p_snapshot jsonb) returns text language sql immutable set search_path='' as $$
 select md5((select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p_snapshot) where key not like 'outlook_%' and key not in ('expected_collection_date','finance_note','collection_status','deleted_at','dispatch_number_reserved','dispatch_upload_hash'))::text);
$$;
create or replace function finance_private.assert_revision_access(p_id uuid,p_readonly boolean default false) returns void language plpgsql stable set search_path='' as $$
begin
 if not coalesce(public.finance_transaction_can_issue(),false) then raise exception 'finance_transactions_permission_denied' using errcode='42501'; end if;
 if not exists(select 1 from public.finance_transaction_accounts a where a.id=p_id and a.deleted_at is null and (a.document_status in ('issued','mail_draft_ready','sent') or (p_readonly and a.document_status='cancelled')) and exists(select 1 from public.finance_transaction_account_lines l where l.account_id=a.id)
   and not exists(select 1 from public.finance_transaction_account_lines l left join public.activities activity on activity.row_id=l.activity_row_id where l.account_id=a.id and coalesce(activity.activity_season,'')<>'school_2027')) then raise exception 'invoice_not_editable'; end if;
end $$;
create or replace function public.finance_payment_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not finance_private.can_collect() and not public.finance_transaction_can_issue() then raise exception 'finance_collection_permission_denied' using errcode='42501'; end if;
  return jsonb_build_object('receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by r.received_date desc,r.id),'[]') from public.finance_receipts r),
    'allocations',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.finance_receipt_allocations x),
    'balances',(select coalesce(jsonb_agg(jsonb_build_object('accountId',a.id,'paidAmount',finance_private.account_paid(a.id),'balance',greatest(0,a.total_amount-finance_private.account_paid(a.id)))),'[]') from public.finance_transaction_accounts a where a.document_status<>'generating' and a.deleted_at is null));
end $$;
create table finance_private.account_numbering (
  singleton boolean primary key default true check(singleton),
  next_number bigint not null check(next_number>0)
);
insert into finance_private.account_numbering(next_number)
select greatest(
  (select last_value+case when is_called then 1 else 0 end from public.finance_transaction_account_number_seq),
  coalesce((select max(substring(transaction_account_number from 3)::bigint)+1
    from public.finance_transaction_accounts where transaction_account_number~'^Pl[0-9]+$'),1)
);
alter table finance_private.account_numbering enable row level security;
revoke all on finance_private.account_numbering from public,anon,authenticated,service_role;

create table finance_private.account_deletions (
  account_id uuid primary key,
  operation_id uuid not null unique default gen_random_uuid(),
  account_number text,
  actor_id uuid not null,
  drive_id text,
  item_id text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  recycled_number boolean
);
alter table finance_private.account_deletions enable row level security;
revoke all on finance_private.account_deletions from public,anon,authenticated,service_role;

create function finance_private.guard_pending_deletion_allocation() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from finance_private.account_deletions where account_id=new.account_id) then
    raise exception 'finance_account_deletion_in_progress';
  end if;
  return new;
end $$;
revoke all on function finance_private.guard_pending_deletion_allocation() from public,anon,authenticated,service_role;
create trigger finance_block_allocation_during_deletion before insert on public.finance_receipt_allocations
for each row execute function finance_private.guard_pending_deletion_allocation();

create or replace function public.finance_cancel_issued_account(p_account_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.app_current_role() is distinct from 'admin' or nullif(btrim(p_reason),'') is null then raise exception 'cancellation_requires_admin_and_reason' using errcode='42501'; end if;
  perform 1 from public.finance_transaction_accounts where id=p_account_id for update;
  if exists(select 1 from finance_private.account_deletions where account_id=p_account_id) then
    raise exception 'finance_account_deletion_in_progress';
  end if;
  if exists(select 1 from finance_private.dispatch_leases where account_id=p_account_id and expires_at>now()) then raise exception 'dispatch_in_progress'; end if;
  update public.finance_transaction_accounts set document_status='cancelled',cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=btrim(p_reason) where id=p_account_id and document_status in ('issued','mail_draft_ready','sent');
  if not found then raise exception 'account_not_cancellable'; end if;
end $$;
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
  if status='generating' and exists(select 1 from public.finance_transaction_accounts where id=p_account_id and created_at<now()-interval '15 minutes') then raise exception 'reservation_expired'; end if;
  insert into finance_private.dispatch_leases values(p_account_id,p_token,now()+interval '10 minutes')
    on conflict(account_id) do update set token=excluded.token,expires_at=excluded.expires_at where finance_private.dispatch_leases.expires_at<now();
  if not found then raise exception 'dispatch_in_progress'; end if;
end $$;

create or replace function public.prepare_finance_dispatch(p_account_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  account public.finance_transaction_accounts;
  recipients jsonb;
  allocated_number bigint;
begin
  perform public.validate_finance_dispatch(p_account_id,p_token);
  select * into strict account from public.finance_transaction_accounts where id=p_account_id for update;
  if account.document_status<>'generating' then raise exception 'account_not_dispatchable'; end if;
  recipients:=public.finance_transaction_recipients(p_account_id);
  if jsonb_array_length(recipients->'recipients')=0 then raise exception 'no_valid_payer_email'; end if;
  if account.transaction_account_number is null then
    update finance_private.account_numbering set next_number=next_number+1 where singleton
      returning next_number-1 into allocated_number;
    update public.finance_transaction_accounts
      set transaction_account_number='Pl'||allocated_number::text,dispatch_number_reserved=true
      where id=p_account_id returning * into account;
  end if;
  return recipients || jsonb_build_object('accountNumber',account.transaction_account_number);
end $$;

create function public.begin_finance_account_deletion(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.finance_transaction_accounts; d finance_private.account_deletions;
begin
  if auth.uid() is null or public.app_current_role() is distinct from 'admin' then
    raise exception 'finance_transactions_permission_denied' using errcode='42501';
  end if;
  select * into a from public.finance_transaction_accounts where id=p_account_id for update;
  select * into d from finance_private.account_deletions where account_id=p_account_id;
  if not found then
    if a.id is null or a.deleted_at is not null then raise exception 'account_not_found';end if;
    if a.document_status='generating'
      or exists(select 1 from finance_private.dispatch_leases where account_id=a.id and expires_at>now())

      then raise exception 'dispatch_in_progress';end if;
    if (nullif(a.sharepoint_drive_id,'') is null) <> (nullif(a.sharepoint_item_id,'') is null)
      then raise exception 'finance_pdf_identifier_missing';end if;
    insert into finance_private.account_deletions(account_id,account_number,actor_id,drive_id,item_id)
      values(a.id,a.transaction_account_number,auth.uid(),nullif(a.sharepoint_drive_id,''),nullif(a.sharepoint_item_id,''))
      returning * into d;
  end if;
  return jsonb_build_object('operationId',d.operation_id,'completed',d.completed_at is not null,
    'driveId',d.drive_id,'itemId',d.item_id);
end $$;

create function public.finish_finance_account_deletion(p_account_id uuid,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.finance_transaction_accounts; d finance_private.account_deletions; recycled boolean:=false;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501';end if;
  select * into a from public.finance_transaction_accounts where id=p_account_id for update;
  select * into d from finance_private.account_deletions where account_id=p_account_id and operation_id=p_operation_id for update;
  if not found then raise exception 'account_deletion_not_started';end if;
  if d.completed_at is not null then return jsonb_build_object('deleted',true,'recycledNumber',d.recycled_number);end if;
  if a.id is null or a.document_status='generating'
    or nullif(a.sharepoint_item_id,'') is distinct from d.item_id
    or nullif(a.sharepoint_drive_id,'') is distinct from d.drive_id
    or a.transaction_account_number is distinct from d.account_number then raise exception 'account_deletion_conflict';end if;
  update finance_private.outlook_jobs set state='blocked',last_error='finance_account_deleted' where account_id=a.id;
  update finance_private.invoice_revisions set status='rejected',decided_at=now(),decided_by=d.actor_id,decision_reason='החשבון נמחק'
    where account_id=a.id and status in ('pending_admin','approved','rendering','finance_review_required');
  update public.finance_transaction_accounts set document_status='cancelled',cancelled_at=now(),cancelled_by=d.actor_id,
    cancellation_reason='החשבון נמחק',deleted_at=now(),transaction_account_number=null where id=a.id;
  if d.account_number~'^Pl[0-9]+$' then
    update finance_private.account_numbering set next_number=next_number-1
      where singleton and next_number-1=substring(d.account_number from 3)::bigint;
    recycled := found;
  end if;
  update finance_private.account_deletions set completed_at=now(),recycled_number=recycled where account_id=a.id;
  insert into public.finance_audit_events(event_type,actor_id,account_id,details)
    values('account_deleted',d.actor_id,a.id,jsonb_build_object('internal_id',a.id,'account_number',d.account_number,
      'operation_id',d.operation_id,'recycled_number',recycled,'pdf_item_id',d.item_id));
  return jsonb_build_object('deleted',true,'recycledNumber',recycled);
end $$;

revoke all on function public.begin_finance_account_deletion(uuid),public.finish_finance_account_deletion(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.begin_finance_account_deletion(uuid) to authenticated;
grant execute on function public.finish_finance_account_deletion(uuid,uuid) to service_role;

commit;
