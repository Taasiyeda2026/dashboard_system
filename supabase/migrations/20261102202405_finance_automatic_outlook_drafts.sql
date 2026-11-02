-- No billing snapshots, meeting claims or Gefen eligibility functions are changed.
alter table public.finance_transaction_accounts
  add column outlook_recipients jsonb not null default '[]'::jsonb,
  add column outlook_mailbox text,
  add column outlook_attempted_at timestamptz,
  add column outlook_creation_started_at timestamptz;
alter table public.finance_transaction_accounts drop constraint finance_transaction_accounts_outlook_status_check;
alter table public.finance_transaction_accounts add constraint finance_transaction_accounts_outlook_status_check
  check(outlook_status in ('pending','draft_ready','failed','missing_recipient','needs_review','already_sent'));

create table finance_private.outlook_jobs (
  account_id uuid primary key references public.finance_transaction_accounts(id),
  token uuid not null default gen_random_uuid(),
  state text not null default 'pending' check(state in ('pending','ready','blocked')),
  attempts integer not null default 0,
  next_retry_at timestamptz not null default now(),
  dispatched_at timestamptz,
  request_id bigint,
  last_error text
);
alter table finance_private.outlook_jobs enable row level security;
revoke all on finance_private.outlook_jobs from public,anon,authenticated;
grant select,insert,update on finance_private.outlook_jobs to service_role;

create function finance_private.queue_outlook_draft() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if OLD.document_status='generating' and NEW.document_status='issued' then
    insert into finance_private.outlook_jobs(account_id) values(NEW.id) on conflict do nothing;
  end if;
  return NEW;
end $$;
revoke all on function finance_private.queue_outlook_draft() from public,anon,authenticated;
create trigger finance_queue_outlook after update of document_status on public.finance_transaction_accounts
for each row execute function finance_private.queue_outlook_draft();

create function public.finance_authorize_outlook_job(p_account_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  return exists(select 1 from finance_private.outlook_jobs j
    join public.finance_transaction_accounts a on a.id=j.account_id
    where j.account_id=p_account_id and j.token=p_token and j.state='pending'
      and j.dispatched_at>now()-interval '15 minutes'
      and a.document_status in ('issued','mail_draft_ready'));
end $$;
revoke all on function public.finance_authorize_outlook_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finance_authorize_outlook_job(uuid,uuid) to service_role;

create function public.finance_transaction_recipients(p_account_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare account public.finance_transaction_accounts; result jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  select * into account from public.finance_transaction_accounts where id=p_account_id;
  if not found then raise exception 'account_not_found'; end if;
  with activity as (
    select distinct a.* from public.activities a
    join public.finance_transaction_account_lines l on l.activity_row_id=a.row_id where l.account_id=p_account_id
  ), contacts as (
    select distinct c.* from public.contacts_schools c where
      lower(btrim(coalesce(c.active,''))) not in ('לא פעיל','inactive','false','0','no') and (
      (account.payer_key_snapshot like 'school:%' and exists(select 1 from activity a where c.school_id=a.school_id
        or (c.school_id is null and c.id=a.school_contact_id)))
      or (account.payer_key_snapshot like 'authority:%' and c.client_type='authority'
        and c.authority_id=account.authority_id_snapshot)
      or (account.payer_key_snapshot like 'funding:%' and c.client_type='other'
        and btrim(c.client_name)=(select name from public.funding_sources where id=account.funding_source_id_snapshot))
    )
  ), raw_addresses as (
    select c.email value from contacts c where not exists(select 1 from public.contact_emails e
      where e.contact_id=c.id and not e.active and lower(btrim(e.email))=lower(btrim(c.email)))
    union all select e.email from public.contact_emails e join contacts c on c.id=e.contact_id where e.active
    union all select r.recipient_email from public.finance_school_invoice_recipients r
      where account.payer_key_snapshot like 'school:%' and exists(select 1 from activity a where a.school_id=r.school_id)
        and (r.contact_id is null or exists(select 1 from contacts c where c.id=r.contact_id))
    -- Explicitly edited payer emails remain an additional source for sponsor invoices.
    -- School snapshots are deliberately not used: they can contain stale contact emails.
    union all select account.customer_email_snapshot where account.payer_key_snapshot not like 'school:%' and account.manual_draft is not null
  ), addresses as (
    select distinct lower(btrim(part)) email from raw_addresses r
    cross join lateral regexp_split_to_table(coalesce(r.value,''),'[;,\n\r]+') part
    where btrim(part)<>''
  )
  select jsonb_build_object(
    'recipients',coalesce(jsonb_agg(email order by email) filter(where email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),'[]'),
    'invalidCount',count(*) filter(where email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')) into result from addresses;
  return result;
end $$;
revoke all on function public.finance_transaction_recipients(uuid) from public,anon,authenticated;
grant execute on function public.finance_transaction_recipients(uuid) to service_role;

create function public.begin_finance_outlook_creation(p_account_id uuid,p_token uuid,p_mailbox text,p_recipients jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform public.validate_finance_dispatch(p_account_id,p_token);
  update public.finance_transaction_accounts set outlook_creation_started_at=now(),outlook_attempted_at=now(),
    outlook_mailbox=p_mailbox,outlook_recipients=p_recipients
    where id=p_account_id and document_status in ('issued','mail_draft_ready') and outlook_creation_started_at is null
      and outlook_message_id is null;
  return found;
end $$;
revoke all on function public.begin_finance_outlook_creation(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.begin_finance_outlook_creation(uuid,uuid,text,jsonb) to service_role;

drop function public.mark_finance_transaction_outlook(uuid,text,text,text);
create function public.mark_finance_transaction_outlook(p_account_id uuid,p_status text,p_message_id text default null,p_error text default null,
  p_token uuid default null,p_recipients jsonb default null,p_mailbox text default null,p_creation_rejected boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  if p_token is not null then perform public.validate_finance_dispatch(p_account_id,p_token); end if;
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

-- A persistent outbox covers a closed browser or an interrupted HTTP response.
-- The JWT is resolved inside Vault; only short-lived per-account capabilities are
-- sent to the worker. Neither the service-role key nor a user session is stored here.
create function finance_private.dispatch_outlook_jobs() returns integer
language plpgsql security definer set search_path='' as $$
declare job record; project_url text; anon_key text; next_token uuid; queued_request_id bigint; dispatched integer:=0;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name='quote_signature_reminder_project_url';
  select decrypted_secret into anon_key from vault.decrypted_secrets where name='quote_signature_reminder_anon_key';
  if project_url is null or anon_key is null then return 0; end if;
  update finance_private.outlook_jobs set state='blocked',last_error=coalesce(last_error,'automatic_retry_exhausted')
    where state='pending' and attempts>=10 and next_retry_at<=now();
  update public.finance_transaction_accounts a set outlook_status='failed',outlook_error='automatic_retry_exhausted'
    where a.outlook_status='pending' and exists(select 1 from finance_private.outlook_jobs j where j.account_id=a.id and j.state='blocked');
  for job in select j.account_id from finance_private.outlook_jobs j
    join public.finance_transaction_accounts a on a.id=j.account_id
    where j.state='pending' and j.attempts<10 and j.next_retry_at<=now()
      and a.document_status in ('issued','mail_draft_ready')
      and not exists(select 1 from finance_private.dispatch_leases l where l.account_id=j.account_id and l.expires_at>now())
    order by j.next_retry_at for update of j skip locked limit 10
  loop
    next_token:=gen_random_uuid();
    select net.http_post(url:=rtrim(project_url,'/')||'/functions/v1/finance-transaction-accounts',
      headers:=jsonb_build_object('Authorization','Bearer '||anon_key,'Content-Type','application/json'),
      body:=jsonb_build_object('accountId',job.account_id,'outlookJobToken',next_token),timeout_milliseconds:=60000) into queued_request_id;
    update finance_private.outlook_jobs set token=next_token,attempts=attempts+1,dispatched_at=now(),
      next_retry_at=now()+interval '15 minutes',request_id=queued_request_id where account_id=job.account_id;
    dispatched:=dispatched+1;
  end loop;
  return dispatched;
end $$;
revoke all on function finance_private.dispatch_outlook_jobs() from public,anon,authenticated;
select cron.schedule('finance-outlook-drafts','*/2 * * * *','select finance_private.dispatch_outlook_jobs()');
