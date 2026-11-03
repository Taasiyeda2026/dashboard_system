-- Capture the issuer at reservation time, before a browser or background worker
-- can lose its session. No billing, claims, PDF or recipient snapshots change.
alter table public.finance_transaction_accounts
  add column outlook_owner_id uuid,
  add column outlook_owner_mailbox text;

-- Read the administrator-managed application record, never profiles/user_metadata
-- or a mailbox supplied by the browser. Require a confirmed matching Auth email.
create function finance_private.issuer_outlook_mailbox(p_user_id uuid) returns text
language sql stable set search_path='' as $$
  with recursive permission_chain(flag) as (
    select 'manage_finance_transactions'::text
    union all select public.app_permission_parent(flag) from permission_chain
      where public.app_permission_parent(flag) is not null
  ), eligible as (
    select lower(btrim(u.email)) mailbox from public.users u
    join auth.users a on a.id=u.auth_user_id
    where u.auth_user_id=p_user_id and u.is_active and a.email_confirmed_at is not null
      and lower(btrim(a.email))=lower(btrim(u.email))
      and lower(btrim(u.email)) ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@think[.]org[.]il$'
      and (u.role='admin' or (select bool_and(lower(coalesce(u.permissions->>flag,'')) in ('yes','true','1')) from permission_chain))
  )
  select min(mailbox) from eligible having count(*)=1;
$$;
revoke all on function finance_private.issuer_outlook_mailbox(uuid) from public,anon,authenticated;

-- Preserve existing message IDs and their actual mailbox. If an old draft belongs
-- elsewhere, resolution below blocks it for review instead of duplicating it.
update public.finance_transaction_accounts set outlook_owner_id=created_by,
  outlook_owner_mailbox=finance_private.issuer_outlook_mailbox(created_by);

create function finance_private.capture_outlook_owner() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='INSERT' then
    NEW.outlook_owner_id:=auth.uid();
    NEW.outlook_owner_mailbox:=finance_private.issuer_outlook_mailbox(auth.uid());
  else
    if NEW.outlook_owner_id is distinct from OLD.outlook_owner_id then
      raise exception 'invoice_mailbox_owner_immutable';
    end if;
    if NEW.outlook_owner_mailbox is distinct from OLD.outlook_owner_mailbox then
      -- A missing address may be repaired for the SAME original issuer, by the
      -- lease-owning resolver after an administrator corrects that user's record.
      if OLD.outlook_owner_mailbox is not null or coalesce(auth.role(),'')<>'service_role'
        or NEW.outlook_owner_mailbox is distinct from finance_private.issuer_outlook_mailbox(OLD.outlook_owner_id)
      then raise exception 'invoice_mailbox_owner_immutable'; end if;
    end if;
  end if;
  return NEW;
end $$;
revoke all on function finance_private.capture_outlook_owner() from public,anon,authenticated;
create trigger finance_capture_outlook_owner before insert or update of outlook_owner_id,outlook_owner_mailbox
  on public.finance_transaction_accounts for each row execute function finance_private.capture_outlook_owner();

create function public.resolve_finance_outlook_mailbox(p_account_id uuid,p_token uuid) returns text
language plpgsql security definer set search_path='' as $$
declare account public.finance_transaction_accounts; authorized_mailbox text;
begin
  perform public.validate_finance_dispatch(p_account_id,p_token);
  select * into account from public.finance_transaction_accounts where id=p_account_id for update;
  if not found then raise exception 'account_not_found'; end if;
  authorized_mailbox:=finance_private.issuer_outlook_mailbox(account.outlook_owner_id);
  if authorized_mailbox is null then raise exception 'invoice_mailbox_not_authorized'; end if;
  if account.outlook_owner_mailbox is null then
    update public.finance_transaction_accounts set outlook_owner_mailbox=authorized_mailbox where id=p_account_id;
  elsif account.outlook_owner_mailbox<>authorized_mailbox then
    raise exception 'invoice_mailbox_identity_changed';
  end if;
  if (account.outlook_message_id is not null or account.outlook_creation_started_at is not null)
    and lower(btrim(coalesce(account.outlook_mailbox,'')))<>authorized_mailbox then
    raise exception 'invoice_mailbox_existing_draft_mismatch';
  end if;
  return authorized_mailbox;
end $$;
revoke all on function public.resolve_finance_outlook_mailbox(uuid,uuid) from public,anon,authenticated;
grant execute on function public.resolve_finance_outlook_mailbox(uuid,uuid) to service_role;

create or replace function public.begin_finance_outlook_creation(p_account_id uuid,p_token uuid,p_mailbox text,p_recipients jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if p_mailbox is distinct from public.resolve_finance_outlook_mailbox(p_account_id,p_token) then
    raise exception 'invoice_mailbox_identity_changed';
  end if;
  update public.finance_transaction_accounts set outlook_creation_started_at=now(),outlook_attempted_at=now(),
    outlook_mailbox=p_mailbox,outlook_recipients=p_recipients
    where id=p_account_id and document_status in ('issued','mail_draft_ready') and outlook_creation_started_at is null
      and outlook_message_id is null;
  return found;
end $$;

-- Keep the established outbox/status behavior, but reject cross-mailbox writes.
create or replace function public.mark_finance_transaction_outlook(p_account_id uuid,p_status text,p_message_id text default null,p_error text default null,
  p_token uuid default null,p_recipients jsonb default null,p_mailbox text default null,p_creation_rejected boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  if p_token is not null then perform public.validate_finance_dispatch(p_account_id,p_token); end if;
  if p_mailbox is not null and not exists(select 1 from public.finance_transaction_accounts where id=p_account_id and outlook_owner_mailbox=p_mailbox) then
    raise exception 'invoice_mailbox_identity_changed';
  end if;
  if p_status not in ('draft_ready','failed','missing_recipient','needs_review','already_sent') then raise exception 'invalid_outlook_status'; end if;
  update public.finance_transaction_accounts set outlook_status=p_status,
    outlook_message_id=coalesce(p_message_id,outlook_message_id),outlook_error=p_error,outlook_attempted_at=now(),
    outlook_recipients=coalesce(p_recipients,outlook_recipients),outlook_mailbox=coalesce(p_mailbox,outlook_mailbox),
    outlook_creation_started_at=case when p_creation_rejected then null else outlook_creation_started_at end,
    document_status=case when p_status='draft_ready' then 'mail_draft_ready' when p_status='already_sent' then 'sent'
      when document_status='mail_draft_ready' then 'issued' else document_status end
    where id=p_account_id and document_status in ('issued','mail_draft_ready','sent');
  if not found then raise exception 'account_not_dispatchable'; end if;
  update finance_private.outlook_jobs set
    state=case when p_status in ('draft_ready','already_sent') then 'ready' when p_status='needs_review' or attempts>=10 then 'blocked' else 'pending' end,
    next_retry_at=now()+case when p_status='missing_recipient' then interval '1 hour' else interval '5 minutes'*least(12,greatest(1,attempts)) end,
    last_error=p_error where account_id=p_account_id;
end $$;
revoke all on function public.mark_finance_transaction_outlook(uuid,text,text,text,uuid,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.mark_finance_transaction_outlook(uuid,text,text,text,uuid,jsonb,text,boolean) to service_role;
