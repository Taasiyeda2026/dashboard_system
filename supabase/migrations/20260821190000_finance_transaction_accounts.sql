-- Transaction accounts are immutable finance snapshots. activities remains the source of truth.
create sequence if not exists public.finance_transaction_account_number_seq start with 8525 increment by 1 no cycle;

create table public.finance_transaction_accounts (
  id uuid primary key default gen_random_uuid(),
  transaction_account_number bigint not null default nextval('public.finance_transaction_account_number_seq') unique,
  idempotency_key uuid not null,
  issue_date date not null default current_date,
  cutoff_date date not null,
  institution_symbol text not null check (btrim(institution_symbol) <> ''),
  customer_name_snapshot text not null,
  customer_email_snapshot text,
  total_amount numeric not null check (total_amount >= 0),
  document_status text not null default 'generating' check (document_status in ('generating','issued','mail_draft_ready','sent','cancelled')),
  collection_status text not null default 'awaiting_payment' check (collection_status in ('awaiting_payment','partially_paid','paid')),
  generated_filename text,
  pdf_sha256 text,
  sharepoint_drive_id text,
  sharepoint_folder_item_id text,
  sharepoint_item_id text,
  sharepoint_web_url text,
  outlook_status text not null default 'pending' check (outlook_status in ('pending','draft_ready','failed','missing_recipient')),
  outlook_message_id text,
  outlook_error text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  finalized_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancellation_reason text,
  unique (idempotency_key, institution_symbol)
);

create table public.finance_transaction_account_lines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.finance_transaction_accounts(id) on delete restrict,
  activity_row_id text not null references public.activities(row_id) on delete restrict,
  activity_name_snapshot text not null,
  gefen_number_snapshot text,
  activity_price_snapshot numeric not null,
  planned_meeting_count_snapshot integer not null check (planned_meeting_count_snapshot > 0),
  hourly_rate_snapshot numeric not null,
  billed_hours numeric not null check (billed_hours > 0),
  amount numeric not null check (amount >= 0),
  unique (account_id, activity_row_id)
);

create table public.finance_transaction_account_meetings (
  id uuid primary key default gen_random_uuid(),
  account_line_id uuid not null references public.finance_transaction_account_lines(id) on delete restrict,
  activity_row_id text not null references public.activities(row_id) on delete restrict,
  meeting_date date not null,
  hours numeric not null default 1.5 check (hours = 1.5),
  created_at timestamptz not null default now(),
  unique (activity_row_id, meeting_date)
);

create index finance_transaction_accounts_institution_idx on public.finance_transaction_accounts(institution_symbol, issue_date desc);
create index finance_transaction_lines_activity_idx on public.finance_transaction_account_lines(activity_row_id);

alter table public.finance_transaction_accounts enable row level security;
alter table public.finance_transaction_account_lines enable row level security;
alter table public.finance_transaction_account_meetings enable row level security;

create policy finance_transaction_accounts_read on public.finance_transaction_accounts for select to authenticated using ((select public.app_can_access_finance()));
create policy finance_transaction_lines_read on public.finance_transaction_account_lines for select to authenticated using ((select public.app_can_access_finance()));
create policy finance_transaction_meetings_read on public.finance_transaction_account_meetings for select to authenticated using ((select public.app_can_access_finance()));
revoke all on public.finance_transaction_accounts, public.finance_transaction_account_lines, public.finance_transaction_account_meetings from public, anon, authenticated;
grant select on public.finance_transaction_accounts, public.finance_transaction_account_lines, public.finance_transaction_account_meetings to authenticated;

create or replace function public.reserve_finance_transaction_account(
  p_idempotency_key uuid, p_cutoff_date date, p_institution_symbol text,
  p_customer_name text, p_customer_email text, p_lines jsonb
) returns public.finance_transaction_accounts
language plpgsql security definer set search_path=public as $$
declare v_account public.finance_transaction_accounts; v_line jsonb; v_activity public.activities; v_line_id uuid;
declare v_dates date[]; v_planned date[]; v_date date; v_price numeric; v_rate numeric; v_amount numeric; v_total numeric := 0; v_billed numeric;
begin
  if not public.app_can_access_finance() then raise exception 'finance_permission_denied' using errcode='42501'; end if;
  if btrim(coalesce(p_institution_symbol,''))='' or jsonb_array_length(coalesce(p_lines,'[]'))=0 then raise exception 'invalid_transaction_account'; end if;
  select * into v_account from public.finance_transaction_accounts where idempotency_key=p_idempotency_key and institution_symbol=p_institution_symbol;
  if found then return v_account; end if;
  insert into public.finance_transaction_accounts(idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,customer_email_snapshot,total_amount)
  values(p_idempotency_key,p_cutoff_date,btrim(p_institution_symbol),btrim(p_customer_name),nullif(btrim(p_customer_email),''),0) returning * into v_account;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_activity from public.activities where row_id=v_line->>'activity_row_id' for share;
    if not found then raise exception 'activity_not_found'; end if;
    select coalesce(array_agg(d order by d),'{}') into v_planned from (
      select distinct (to_jsonb(v_activity)->>format('date_%s',n))::date d from generate_series(1,35)n
      where coalesce(to_jsonb(v_activity)->>format('date_%s',n),'') ~ '^\d{4}-\d{2}-\d{2}$'
      and not exists(select 1 from public.course_meeting_cancellations c where c.activity_id=v_activity.row_id and c.meeting_date=(to_jsonb(v_activity)->>format('date_%s',n))::date)
    ) q;
    select coalesce(array_agg(x::date order by x::date),'{}') into v_dates from jsonb_array_elements_text(v_line->'meeting_dates') x;
    if cardinality(v_dates)=0 or exists(select 1 from unnest(v_dates) d where d>p_cutoff_date or not(d=any(v_planned))) then raise exception 'invalid_meeting_selection'; end if;
    if cardinality(v_dates)<3 and not (select bool_and(d<=p_cutoff_date) from unnest(v_planned)d) then raise exception 'minimum_three_meetings'; end if;
    v_price := regexp_replace(coalesce(v_activity.price::text,''),'[^0-9.-]','','g')::numeric;
    v_rate := v_price/(cardinality(v_planned)*1.5);
    select coalesce(sum(l.amount),0) into v_billed from public.finance_transaction_account_lines l join public.finance_transaction_accounts a on a.id=l.account_id where l.activity_row_id=v_activity.row_id and a.document_status not in('generating','cancelled');
    v_amount := case when (select bool_and(d<=p_cutoff_date) from unnest(v_planned)d) then greatest(0,v_price-v_billed) else cardinality(v_dates)*1.5*v_rate end;
    insert into public.finance_transaction_account_lines(account_id,activity_row_id,activity_name_snapshot,gefen_number_snapshot,activity_price_snapshot,planned_meeting_count_snapshot,hourly_rate_snapshot,billed_hours,amount)
    values(v_account.id,v_activity.row_id,v_activity.activity_name,v_activity.activity_no,v_price,cardinality(v_planned),v_rate,cardinality(v_dates)*1.5,v_amount) returning id into v_line_id;
    foreach v_date in array v_dates loop insert into public.finance_transaction_account_meetings(account_line_id,activity_row_id,meeting_date) values(v_line_id,v_activity.row_id,v_date); end loop;
    v_total:=v_total+v_amount;
  end loop;
  update public.finance_transaction_accounts set total_amount=v_total where id=v_account.id returning * into v_account; return v_account;
end $$;

create or replace function public.finalize_finance_transaction_account(p_account_id uuid,p_filename text,p_pdf_sha256 text,p_drive_id text,p_folder_item_id text,p_item_id text,p_web_url text)
returns public.finance_transaction_accounts language plpgsql security definer set search_path=public as $$
declare v public.finance_transaction_accounts; begin
 if not public.app_can_access_finance() then raise exception 'finance_permission_denied' using errcode='42501'; end if;
 update public.finance_transaction_accounts set document_status='issued',generated_filename=p_filename,pdf_sha256=p_pdf_sha256,sharepoint_drive_id=p_drive_id,sharepoint_folder_item_id=p_folder_item_id,sharepoint_item_id=p_item_id,sharepoint_web_url=p_web_url,finalized_at=now()
 where id=p_account_id and document_status='generating' returning * into v;
 if not found then select * into v from public.finance_transaction_accounts where id=p_account_id and document_status in('issued','mail_draft_ready','sent'); end if;
 if not found then raise exception 'account_not_finalizable'; end if; return v;
end $$;

create or replace function public.mark_finance_transaction_outlook(p_account_id uuid,p_status text,p_message_id text default null,p_error text default null)
returns void language plpgsql security definer set search_path=public as $$ begin
 if not public.app_can_access_finance() then raise exception 'finance_permission_denied' using errcode='42501'; end if;
 if p_status not in('draft_ready','failed','missing_recipient') then raise exception 'invalid_outlook_status'; end if;
 update public.finance_transaction_accounts set outlook_status=p_status,outlook_message_id=p_message_id,outlook_error=p_error,document_status=case when p_status='draft_ready' then 'mail_draft_ready' else document_status end where id=p_account_id and document_status<>'generating';
end $$;

revoke all on function public.reserve_finance_transaction_account(uuid,date,text,text,text,jsonb), public.finalize_finance_transaction_account(uuid,text,text,text,text,text,text), public.mark_finance_transaction_outlook(uuid,text,text,text) from public,anon;
grant execute on function public.reserve_finance_transaction_account(uuid,date,text,text,text,jsonb), public.finalize_finance_transaction_account(uuid,text,text,text,text,text,text), public.mark_finance_transaction_outlook(uuid,text,text,text) to authenticated;
