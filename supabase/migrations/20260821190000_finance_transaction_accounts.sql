-- Transaction accounts are immutable finance snapshots. activities remains the source of truth.
create sequence if not exists public.finance_transaction_account_number_seq start with 8525 increment by 1 no cycle;

create table public.finance_transaction_accounts (
  id uuid primary key default gen_random_uuid(),
  transaction_account_number bigint not null default nextval('public.finance_transaction_account_number_seq') unique,
  idempotency_key uuid not null,
  issue_date date not null default ((now() at time zone 'Asia/Jerusalem')::date),
  cutoff_date date not null,
  institution_symbol text not null check (btrim(institution_symbol) <> ''),
  customer_name_snapshot text not null,
  customer_email_snapshot text,
  total_amount numeric(14,2) not null check (total_amount >= 0),
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
  activity_price_snapshot numeric(14,2) not null,
  planned_meeting_count_snapshot integer not null check (planned_meeting_count_snapshot > 0),
  hourly_rate_snapshot numeric(18,8) not null,
  billed_hours numeric(10,2) not null check (billed_hours > 0),
  amount numeric(14,2) not null check (amount >= 0),
  unique (account_id, activity_row_id)
);

create table public.finance_transaction_account_meetings (
  id uuid primary key default gen_random_uuid(),
  account_line_id uuid not null references public.finance_transaction_account_lines(id) on delete restrict,
  activity_row_id text not null references public.activities(row_id) on delete restrict,
  meeting_slot smallint not null check (meeting_slot between 1 and 35),
  meeting_date date not null,
  hours numeric(4,2) not null default 1.5 check (hours = 1.5),
  created_at timestamptz not null default now(),
  -- A date is not a meeting identity: date_1 and date_2 may legitimately be the same day.
  unique (activity_row_id, meeting_slot)
);

create index finance_transaction_accounts_institution_idx on public.finance_transaction_accounts(institution_symbol, issue_date desc);
create index finance_transaction_lines_activity_idx on public.finance_transaction_account_lines(activity_row_id);
create index finance_transaction_meetings_date_idx on public.finance_transaction_account_meetings(activity_row_id, meeting_date);

alter table public.finance_transaction_accounts enable row level security;
alter table public.finance_transaction_account_lines enable row level security;
alter table public.finance_transaction_account_meetings enable row level security;

-- Finance users need the same cancellation facts used by the server-side billing calculator.
create policy finance_course_meeting_cancellations_read on public.course_meeting_cancellations
for select to authenticated
using ((select public.app_can_access_finance()));

-- Generating rows are reservation claims, not billed history. Normal finance reads only see finalized/cancelled documents.
create policy finance_transaction_accounts_read on public.finance_transaction_accounts
for select to authenticated
using ((select public.app_can_access_finance()) and document_status <> 'generating');

create policy finance_transaction_lines_read on public.finance_transaction_account_lines
for select to authenticated
using ((select public.app_can_access_finance()) and exists (
  select 1 from public.finance_transaction_accounts a
  where a.id=account_id and a.document_status <> 'generating'
));

create policy finance_transaction_meetings_read on public.finance_transaction_account_meetings
for select to authenticated
using ((select public.app_can_access_finance()) and exists (
  select 1
  from public.finance_transaction_account_lines l
  join public.finance_transaction_accounts a on a.id=l.account_id
  where l.id=account_line_id and a.document_status <> 'generating'
));

revoke all on public.finance_transaction_accounts, public.finance_transaction_account_lines, public.finance_transaction_account_meetings from public, anon, authenticated;
grant select on public.finance_transaction_accounts, public.finance_transaction_account_lines, public.finance_transaction_account_meetings to authenticated;

create or replace function public.reserve_finance_transaction_account(
  p_idempotency_key uuid,
  p_cutoff_date date,
  p_institution_symbol text,
  p_customer_name text,
  p_customer_email text,
  p_lines jsonb
) returns public.finance_transaction_accounts
language plpgsql security definer set search_path=public as $$
declare
  v_account public.finance_transaction_accounts;
  v_line jsonb;
  v_activity public.activities;
  v_line_id uuid;
  v_selected_slots integer[];
  v_expected_slots integer[];
  v_slot integer;
  v_meeting_date date;
  v_planned_count integer;
  v_scheduled_count integer;
  v_non_cancelled_count integer;
  v_finished boolean;
  v_price numeric;
  v_rate numeric;
  v_amount numeric;
  v_total numeric := 0;
  v_billed numeric;
  v_target numeric;
  v_activity_symbol text;
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_local_time time := (now() at time zone 'Asia/Jerusalem')::time;
begin
  if not public.app_can_access_finance() then
    raise exception 'finance_permission_denied' using errcode='42501';
  end if;
  if p_idempotency_key is null
     or p_cutoff_date is null
     or p_cutoff_date > v_today
     or btrim(coalesce(p_institution_symbol,''))=''
     or btrim(coalesce(p_customer_name,''))='' then
    raise exception 'invalid_transaction_account';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'invalid_transaction_account';
  end if;
  if jsonb_array_length(p_lines)=0 then
    raise exception 'invalid_transaction_account';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text || ':' || btrim(p_institution_symbol), 0));
  select * into v_account
  from public.finance_transaction_accounts
  where idempotency_key=p_idempotency_key and institution_symbol=btrim(p_institution_symbol);
  if found then return v_account; end if;

  insert into public.finance_transaction_accounts(
    idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,customer_email_snapshot,total_amount
  ) values(
    p_idempotency_key,p_cutoff_date,btrim(p_institution_symbol),btrim(p_customer_name),nullif(btrim(p_customer_email),''),0
  ) returning * into v_account;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_activity
    from public.activities
    where row_id=v_line->>'activity_row_id'
    for update;
    if not found then raise exception 'activity_not_found'; end if;

    select nullif(btrim(s.semel_mosad::text),'') into v_activity_symbol
    from public.schools s
    where s.id=v_activity.school_id;
    if v_activity_symbol is null or v_activity_symbol <> btrim(p_institution_symbol) then
      raise exception 'activity_institution_mismatch';
    end if;

    -- Preserve the supported denormalized activity contact-email fallback when no explicit recipient was supplied.
    if v_account.customer_email_snapshot is null and nullif(btrim(coalesce(v_activity.contact_email,'')),'') is not null then
      update public.finance_transaction_accounts
      set customer_email_snapshot=nullif(btrim(v_activity.contact_email),'')
      where id=v_account.id
      returning * into v_account;
    end if;

    select count(*)::integer into v_scheduled_count
    from generate_series(1,35) n
    where coalesce(to_jsonb(v_activity)->>format('date_%s',n),'') ~ '^\d{4}-\d{2}-\d{2}$';

    v_planned_count := case
      when btrim(coalesce(v_activity.sessions,'')) ~ '^[1-9][0-9]*$' then v_activity.sessions::integer
      else v_scheduled_count
    end;
    if coalesce(v_planned_count,0) <= 0 then raise exception 'invalid_planned_meeting_count'; end if;

    select count(*)::integer into v_non_cancelled_count
    from generate_series(1,35) n
    where coalesce(to_jsonb(v_activity)->>format('date_%s',n),'') ~ '^\d{4}-\d{2}-\d{2}$'
      and not exists(
        select 1 from public.course_meeting_cancellations c
        where c.activity_id=v_activity.row_id
          and c.meeting_date=(to_jsonb(v_activity)->>format('date_%s',n))::date
      );

    select coalesce(array_agg(n order by d,n),'{}'::integer[]) into v_expected_slots
    from (
      select n, (to_jsonb(v_activity)->>format('date_%s',n))::date d
      from generate_series(1,35) n
      where coalesce(to_jsonb(v_activity)->>format('date_%s',n),'') ~ '^\d{4}-\d{2}-\d{2}$'
    ) slots
    where not exists(
        select 1 from public.course_meeting_cancellations c
        where c.activity_id=v_activity.row_id and c.meeting_date=slots.d
      )
      and (
        slots.d < p_cutoff_date
        or (
          slots.d = p_cutoff_date
          and (
            p_cutoff_date < v_today
            or (p_cutoff_date = v_today and v_activity.end_time is not null and v_activity.end_time <= v_local_time)
          )
        )
      )
      and not exists(
        select 1
        from public.finance_transaction_account_meetings m
        join public.finance_transaction_account_lines l on l.id=m.account_line_id
        join public.finance_transaction_accounts a on a.id=l.account_id
        where m.activity_row_id=v_activity.row_id
          and m.meeting_slot=slots.n
          and a.document_status <> 'cancelled'
      );

    select coalesce(array_agg(slot order by slot),'{}'::integer[]) into v_selected_slots
    from (
      select distinct case
        when jsonb_typeof(value)='number' then (value::text)::integer
        when jsonb_typeof(value)='object' and coalesce(value->>'slot','') ~ '^[0-9]+$' then (value->>'slot')::integer
        else null
      end as slot
      from jsonb_array_elements(coalesce(v_line->'meeting_slots','[]'::jsonb))
    ) requested
    where slot between 1 and 35;

    if cardinality(v_expected_slots)=0 or v_selected_slots is distinct from v_expected_slots then
      raise exception 'invalid_meeting_selection';
    end if;

    select v_scheduled_count >= v_planned_count
      and not exists(
        select 1
        from (
          select (to_jsonb(v_activity)->>format('date_%s',n))::date d
          from generate_series(1,35) n
          where coalesce(to_jsonb(v_activity)->>format('date_%s',n),'') ~ '^\d{4}-\d{2}-\d{2}$'
        ) slots
        where not exists(
            select 1 from public.course_meeting_cancellations c
            where c.activity_id=v_activity.row_id and c.meeting_date=slots.d
          )
          and not (
            slots.d < p_cutoff_date
            or (
              slots.d = p_cutoff_date
              and (
                p_cutoff_date < v_today
                or (p_cutoff_date = v_today and v_activity.end_time is not null and v_activity.end_time <= v_local_time)
              )
            )
          )
      ) into v_finished;

    if cardinality(v_expected_slots) < 3 and not v_finished then
      raise exception 'minimum_three_meetings';
    end if;

    if v_activity.price is null or v_activity.price < 0 then raise exception 'invalid_activity_price'; end if;
    v_price := v_activity.price::numeric;
    v_rate := v_price/(v_planned_count*1.5::numeric);

    select coalesce(sum(l.amount),0) into v_billed
    from public.finance_transaction_account_lines l
    join public.finance_transaction_accounts a on a.id=l.account_id
    where l.activity_row_id=v_activity.row_id
      and a.document_status in('issued','mail_draft_ready','sent');

    if v_finished then
      v_target := round(v_price * least(v_non_cancelled_count,v_planned_count)::numeric / v_planned_count::numeric, 2);
      v_amount := round(greatest(0,v_target-v_billed),2);
    else
      v_amount := round(cardinality(v_expected_slots)*1.5::numeric*v_rate,2);
    end if;

    insert into public.finance_transaction_account_lines(
      account_id,activity_row_id,activity_name_snapshot,gefen_number_snapshot,
      activity_price_snapshot,planned_meeting_count_snapshot,hourly_rate_snapshot,billed_hours,amount
    ) values(
      v_account.id,v_activity.row_id,v_activity.activity_name,v_activity.activity_no,
      v_price,v_planned_count,v_rate,cardinality(v_expected_slots)*1.5,v_amount
    ) returning id into v_line_id;

    foreach v_slot in array v_expected_slots loop
      v_meeting_date := (to_jsonb(v_activity)->>format('date_%s',v_slot))::date;
      insert into public.finance_transaction_account_meetings(account_line_id,activity_row_id,meeting_slot,meeting_date)
      values(v_line_id,v_activity.row_id,v_slot,v_meeting_date);
    end loop;
    v_total := v_total+v_amount;
  end loop;

  update public.finance_transaction_accounts set total_amount=round(v_total,2)
  where id=v_account.id returning * into v_account;
  return v_account;
end $$;

create or replace function public.finalize_finance_transaction_account(
  p_account_id uuid,p_filename text,p_pdf_sha256 text,p_drive_id text,
  p_folder_item_id text,p_item_id text,p_web_url text
) returns public.finance_transaction_accounts
language plpgsql security definer set search_path=public as $$
declare v public.finance_transaction_accounts;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  if btrim(coalesce(p_filename,''))='' or btrim(coalesce(p_item_id,''))='' then raise exception 'missing_generated_document'; end if;
  update public.finance_transaction_accounts set
    document_status='issued',generated_filename=p_filename,pdf_sha256=p_pdf_sha256,
    sharepoint_drive_id=p_drive_id,sharepoint_folder_item_id=p_folder_item_id,
    sharepoint_item_id=p_item_id,sharepoint_web_url=p_web_url,finalized_at=now()
  where id=p_account_id and document_status='generating' returning * into v;
  if not found then
    select * into v from public.finance_transaction_accounts
    where id=p_account_id and document_status in('issued','mail_draft_ready','sent');
  end if;
  if not found then raise exception 'account_not_finalizable'; end if;
  return v;
end $$;

create or replace function public.mark_finance_transaction_outlook(
  p_account_id uuid,p_status text,p_message_id text default null,p_error text default null
) returns void
language plpgsql security definer set search_path=public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  if p_status not in('draft_ready','failed','missing_recipient') then raise exception 'invalid_outlook_status'; end if;
  update public.finance_transaction_accounts set
    outlook_status=p_status,outlook_message_id=p_message_id,outlook_error=p_error,
    document_status=case when p_status='draft_ready' then 'mail_draft_ready' else document_status end
  where id=p_account_id and document_status<>'generating';
end $$;

create or replace function public.cancel_generating_finance_transaction_account(p_account_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
  if not public.app_can_access_finance() then raise exception 'finance_permission_denied' using errcode='42501'; end if;
  select document_status into v_status from public.finance_transaction_accounts where id=p_account_id for update;
  if v_status is distinct from 'generating' then raise exception 'account_not_cancellable'; end if;
  delete from public.finance_transaction_account_meetings m
  using public.finance_transaction_account_lines l
  where m.account_line_id=l.id and l.account_id=p_account_id;
  delete from public.finance_transaction_account_lines where account_id=p_account_id;
  update public.finance_transaction_accounts set
    document_status='cancelled',cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=nullif(btrim(p_reason),'')
  where id=p_account_id;
end $$;

revoke all on function public.reserve_finance_transaction_account(uuid,date,text,text,text,jsonb), public.finalize_finance_transaction_account(uuid,text,text,text,text,text,text), public.mark_finance_transaction_outlook(uuid,text,text,text), public.cancel_generating_finance_transaction_account(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_finance_transaction_account(uuid,date,text,text,text,jsonb), public.cancel_generating_finance_transaction_account(uuid,text) to authenticated;
grant execute on function public.finalize_finance_transaction_account(uuid,text,text,text,text,text,text), public.mark_finance_transaction_outlook(uuid,text,text,text) to service_role;
