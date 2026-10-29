-- No production data is rewritten. Legacy snapshots remain unassigned and block
-- new billing until explicitly reconciled by accounting in a separate reviewed change.
create schema if not exists finance_private;
revoke all on schema finance_private from public, anon, authenticated;

alter table public.finance_transaction_accounts
  add column payer_key_snapshot text,
  add column authority_id_snapshot bigint references public.authorities(id),
  add column funding_source_id_snapshot uuid references public.funding_sources(id);
alter table public.finance_transaction_account_lines
  add column funding_source_id uuid references public.funding_sources(id),
  add column funding_amount_snapshot numeric(14,2),
  add column performance_month date,
  add column billing_rule text check (billing_rule in ('monthly','completion'));
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.finance_transaction_account_lines'::regclass
    and contype='u' and pg_get_constraintdef(oid)='UNIQUE (account_id, activity_row_id)'
  loop execute format('alter table public.finance_transaction_account_lines drop constraint %I',c.conname); end loop;
end $$;
create unique index finance_lines_funder_period_unique on public.finance_transaction_account_lines
  (account_id,activity_row_id,funding_source_id,coalesce(performance_month,'0001-01-01'::date));
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.finance_transaction_account_meetings'::regclass
    and contype='u' and pg_get_constraintdef(oid)='UNIQUE (activity_row_id, meeting_slot)'
  loop execute format('alter table public.finance_transaction_account_meetings drop constraint %I',c.conname); end loop;
end $$;

-- Claims are separate from immutable document snapshots, and include generating
-- reservations. Activity locks serialize issuances; this ledger also supports partial financial coverage.
create table public.finance_billing_claims (
  activity_row_id text not null references public.activities(row_id),
  funding_source_id uuid not null references public.funding_sources(id),
  meeting_slot smallint not null check (meeting_slot between 1 and 35),
  account_id uuid not null references public.finance_transaction_accounts(id),
  claimed_amount numeric(14,2) not null check (claimed_amount>=0),
  settles_meeting boolean not null default true,
  primary key(activity_row_id,funding_source_id,meeting_slot,account_id)
);
create index finance_billing_claims_account_idx on public.finance_billing_claims(account_id);
alter table public.finance_billing_claims enable row level security;
revoke all on public.finance_billing_claims from public,anon,authenticated;

-- Funding/cancellation edits take the same parent lock as reservation/finalize.
create function finance_private.lock_billing_activity() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_TABLE_NAME='activity_funding_sources' then
    perform 1 from public.activities where id in (
      case when TG_OP<>'INSERT' then OLD.activity_id end,
      case when TG_OP<>'DELETE' then NEW.activity_id end) order by row_id for update;
  else
    perform 1 from public.activities where row_id in (
      case when TG_OP<>'INSERT' then OLD.activity_id end,
      case when TG_OP<>'DELETE' then NEW.activity_id end) order by row_id for update;
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end $$;
create trigger finance_lock_funding before insert or update or delete on public.activity_funding_sources
for each row execute function finance_private.lock_billing_activity();
create trigger finance_lock_cancellation before insert or update or delete on public.course_meeting_cancellations
for each row execute function finance_private.lock_billing_activity();

create function finance_private.billing_rows(p_activity public.activities, p_ignore_account uuid default null, p_now timestamptz default now())
returns jsonb language plpgsql stable set search_path='' as $$
declare
  f record; period date; slot record; result jsonb := '[]'; base jsonb;
  slots jsonb; completion_month date; completed jsonb; unbilled jsonb; scoped jsonb;
  planned integer; scheduled integer; done integer; billed_count integer;
  today date := (p_now at time zone 'Asia/Jerusalem')::date;
  local_time time := (p_now at time zone 'Asia/Jerusalem')::time;
  reason text := ''; source_reason text; authority_funding boolean; finished boolean; monthly boolean;
  total_funding numeric; invalid_funding boolean; billed numeric; prior_funding numeric; cancelled_count integer; paid_coverage numeric; full_coverage boolean; adjustment numeric; amount numeric; target numeric;
begin
  select coalesce(jsonb_agg(jsonb_build_object('slot',n,'date',(to_jsonb(p_activity)->>format('date_%s',n))::date) order by n),'[]')
    into slots from generate_series(1,35) n
    where nullif(to_jsonb(p_activity)->>format('date_%s',n),'') is not null;
  scheduled := jsonb_array_length(slots);
  planned := case when btrim(coalesce(p_activity.sessions,'')) ~ '^[1-9][0-9]?$' then btrim(p_activity.sessions)::integer when nullif(btrim(p_activity.sessions),'') is null then scheduled else 0 end;
  if lower(btrim(coalesce(p_activity.status,''))) in ('נמחק','בוטל','מבוטל','deleted','cancelled','canceled') then return '[]'::jsonb;
  elsif p_activity.price is null or p_activity.price<=0 then reason := 'מחיר פעילות אינו תקין';
  elsif planned<1 or planned>35 or scheduled>planned then reason := 'מספר המפגשים אינו תואם לתכנון'; end if;
  select coalesce(sum(afs.amount),0), coalesce(bool_or(afs.amount is null or afs.amount<0),true)
    into total_funding,invalid_funding from public.activity_funding_sources afs where afs.activity_id=p_activity.id;
  if reason='' and (invalid_funding or total_funding<>p_activity.price) then reason := 'חסרה חלוקת מימון תקינה התואמת למחיר הפעילות'; end if;
  if reason='' and exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts a on a.id=l.account_id
    where l.activity_row_id=p_activity.row_id and l.funding_source_id is null and a.document_status<>'cancelled' and (a.document_status<>'generating' or a.created_at>p_now-interval '15 minutes')) then
    reason := 'חשבון קודם ללא שיוך למממן — נדרש בירור לפני חיוב נוסף';
  end if;
  select coalesce(jsonb_agg(s order by (s->>'slot')::int),'[]') into completed
    from jsonb_array_elements(slots) s
    where not exists(select 1 from public.course_meeting_cancellations c where c.activity_id=p_activity.row_id and c.meeting_date=(s->>'date')::date)
    and ((s->>'date')::date<today or ((s->>'date')::date=today and p_activity.end_time is not null and local_time>p_activity.end_time));
  done := jsonb_array_length(completed);
  select date_trunc('month',max((s->>'date')::date))::date into completion_month from jsonb_array_elements(slots) s
    where not exists(select 1 from public.course_meeting_cancellations c where c.activity_id=p_activity.row_id and c.meeting_date=(s->>'date')::date);
  finished := planned>0 and scheduled=planned and not exists(
    select 1 from jsonb_array_elements(slots) s where not completed @> jsonb_build_array(s)
      and not exists(select 1 from public.course_meeting_cancellations c where c.activity_id=p_activity.row_id and c.meeting_date=(s->>'date')::date));
  for f in
    select afs.funding_source_id,afs.amount,fs.name from public.activity_funding_sources afs
      join public.funding_sources fs on fs.id=afs.funding_source_id where afs.activity_id=p_activity.id
    union all select null::uuid,null::numeric,coalesce(p_activity.funding,'ללא מימון')
      where not exists(select 1 from public.activity_funding_sources where activity_id=p_activity.id)
  loop
    monthly := public.finance_is_gefen_funding(f.name) and position('+' in f.name)=0;
    source_reason := reason;
    authority_funding:=lower(regexp_replace(f.name,'["''׳״[:space:]]','','g')) in ('רשות','רשויות','authority');
    if source_reason='' and authority_funding and not exists(select 1 from public.authorities where id=p_activity.authority_id and nullif(btrim(authority_name),'') is not null) then source_reason:='חסרה זהות הרשות המקומית'; end if;
    if source_reason='' and f.name in ('תעשיינים','תורם','תורמים','מימון אחר') then source_reason:='חסרה זהות ספציפית של הגורם המשלם'; end if;
    if source_reason='' and position('+' in f.name)>0 then source_reason := 'גורם מימון משולב מחייב חלוקה למממנים נפרדים'; end if;
    if source_reason='' and not monthly and scheduled<planned then source_reason := 'חסרים מועדי מפגשים מתוכננים'; end if;
    select coalesce(sum(l.amount),0),coalesce(sum((select count(*) from public.finance_transaction_account_meetings m where m.account_line_id=l.id)),0)::int
      into billed,billed_count from public.finance_transaction_account_lines l join public.finance_transaction_accounts a on a.id=l.account_id
      where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id
        and a.document_status<>'cancelled' and (a.document_status<>'generating' or a.created_at>p_now-interval '15 minutes') and (p_ignore_account is null or a.id<>p_ignore_account);
    select max(l.funding_amount_snapshot),coalesce(sum(l.amount) filter(where h.collection_status='paid'),0),coalesce(bool_or(l.billing_coverage='full_funding'),false)
      into prior_funding,paid_coverage,full_coverage from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id
      where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id and h.document_status in ('issued','mail_draft_ready','sent') and (p_ignore_account is null or h.id<>p_ignore_account);
    select count(*)::int into cancelled_count from jsonb_array_elements(slots) cancelled_slot where exists(select 1 from public.course_meeting_cancellations c where c.activity_id=p_activity.row_id and c.meeting_date=(cancelled_slot->>'date')::date);
    adjustment:=case when (full_coverage or paid_coverage>=prior_funding) and (f.amount is distinct from prior_funding or cancelled_count>0)
      then round(f.amount*greatest(0,planned-cancelled_count)/nullif(planned,0),2)-prior_funding else 0 end;
    if source_reason='' and adjustment<>0 then source_reason:='הפרש לאחר חיוב מלא — נדרשת בדיקת כספים'; end if;
    if source_reason='' and billed>f.amount then source_reason := 'החיוב הקיים חורג מחלק המממן — נדרש בירור'; end if;
    select coalesce(jsonb_agg(s || jsonb_build_object('remainingAmount',remaining) order by (s->>'slot')::int),'[]') into unbilled
    from (
      select s,case when exists(select 1 from public.finance_billing_claims settled join public.finance_transaction_accounts settled_account on settled_account.id=settled.account_id
        where settled.activity_row_id=p_activity.row_id and settled.funding_source_id=f.funding_source_id and settled.meeting_slot=(s->>'slot')::int and settled.settles_meeting
        and (p_ignore_account is null or settled.account_id<>p_ignore_account) and settled_account.document_status<>'cancelled'
        and (settled_account.document_status<>'generating' or settled_account.created_at>p_now-interval '15 minutes')) then 0 else greatest(0,round(f.amount*ordinality/nullif(planned,0),2)-round(f.amount*(ordinality-1)/nullif(planned,0),2)-coalesce((
        select sum(c.claimed_amount) from public.finance_billing_claims c join public.finance_transaction_accounts claim on claim.id=c.account_id
        where c.activity_row_id=p_activity.row_id and c.funding_source_id=f.funding_source_id and c.meeting_slot=(s->>'slot')::int
        and (p_ignore_account is null or c.account_id<>p_ignore_account) and claim.document_status<>'cancelled'
        and (claim.document_status<>'generating' or claim.created_at>p_now-interval '15 minutes')),0)) end remaining
      from jsonb_array_elements(completed) with ordinality performed(s,ordinality)
    ) remaining_slots where remaining>0;
    if source_reason='' and exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id
      where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id and h.document_status='generating' and h.created_at>p_now-interval '15 minutes'
      and (p_ignore_account is null or h.id<>p_ignore_account)) then source_reason := 'הפקה בתהליך'; end if;
    base := jsonb_build_object('activityRowId',p_activity.row_id,'activityName',p_activity.activity_name,'gefenNumber',p_activity.activity_no,
      'customerName',p_activity.school,'customerEmail',case when monthly then p_activity.contact_email else null end,'fundingSourceId',f.funding_source_id,'funding',f.name,
      'fundingAmount',f.amount,'gefenFunding',monthly,'plannedCount',planned,'scheduledCount',scheduled,'completedCount',done,
      'billedCount',(select count(distinct m.meeting_slot) from public.finance_transaction_account_meetings m join public.finance_transaction_account_lines l on l.id=m.account_line_id
        join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id and h.document_status in ('issued','mail_draft_ready','sent')),
      'billedAmount',(select coalesce(sum(l.amount),0) from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=p_activity.row_id and l.funding_source_id=f.funding_source_id and h.document_status in ('issued','mail_draft_ready','sent')),'finished',finished,'completionMonth',completion_month,
      'financialAdjustment',adjustment,'fullFundingAmount',greatest(0,f.amount-billed),
      'fullFundingBlockedReason',case when source_reason not in ('','חסרים מועדי מפגשים מתוכננים') then source_reason when billed>=f.amount then 'חלק המממן חויב במלואו' when cancelled_count>0 then 'קיימים מפגשים שבוטלו; יש לעדכן את מסגרת המימון' else '' end,
      'manualMonth',coalesce(completion_month,date_trunc('month',today)::date),
      'institutionSymbol',(select s.semel_mosad::text from public.schools s where s.id=p_activity.school_id),
      'authorityId',case when authority_funding then p_activity.authority_id else null end,
      'payerKey',case when monthly then 'school:'||p_activity.school_id::text when authority_funding then 'authority:'||p_activity.authority_id::text else 'funding:'||f.funding_source_id::text end,
      'payerName',case when monthly then p_activity.school when authority_funding then (select authority_name from public.authorities where id=p_activity.authority_id) else f.name end);
    if source_reason='' and coalesce(base->>'institutionSymbol','')='' then source_reason := 'חסר סמל מוסד'; end if;
    if source_reason='' and coalesce(base->>'payerName','')='' then source_reason := 'חסר גורם משלם'; end if;
    for period in
      select distinct case when monthly then date_trunc('month',(s->>'date')::date)::date else completion_month end
        from jsonb_array_elements(unbilled) s
      union select case when monthly then null::date else completion_month end where jsonb_array_length(unbilled)=0
      order by 1 nulls last
    loop
      select coalesce(jsonb_agg(s order by (s->>'slot')::int),'[]') into scoped from jsonb_array_elements(unbilled) s
        where not monthly or date_trunc('month',(s->>'date')::date)::date=period;
      select coalesce(sum((s->>'remainingAmount')::numeric),0) into amount from jsonb_array_elements(scoped) s;
      target := round(f.amount*done/nullif(planned,0),2);
      if finished and jsonb_array_length(scoped)=jsonb_array_length(unbilled) then amount := target-billed; end if;
      amount := greatest(0,least(amount,f.amount-billed,target-billed));
      result := result || jsonb_build_array(base || jsonb_build_object(
        'period',period,'unbilledSlots',scoped,'unbilledCount',jsonb_array_length(scoped),'unbilledHours',jsonb_array_length(scoped)*1.5,
        'unbilledAmount',amount,'amount',amount,'hourlyRate',f.amount/nullif(planned*1.5,0),
        'blockedReason',source_reason,'eligible',source_reason='' and amount>0 and jsonb_array_length(scoped)>0
          and (case when monthly then period<date_trunc('month',today)::date else finished end),
        'issuableAmount',case when source_reason='' and (case when monthly then period<date_trunc('month',today)::date else finished end) then amount else 0 end));
    end loop;
  end loop;
  return result;
end $$;

create function public.finance_billing_preview(p_activity_ids text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.activities; result jsonb := '[]';
begin
  if auth.uid() is null or not coalesce(public.app_current_role()='admin' or public.app_has_permission('view_finance_collection') or public.app_has_permission('manage_finance_transactions'),false) then
    raise exception 'finance_permission_denied' using errcode='42501'; end if;
  if cardinality(p_activity_ids)>10000 then raise exception 'too_many_activities'; end if;
  for a in select * from public.activities where row_id=any(p_activity_ids) order by row_id loop
    result := result || finance_private.billing_rows(a);
  end loop;
  return result;
end $$;
revoke all on function public.finance_billing_preview(text[]) from public,anon,authenticated;
grant execute on function public.finance_billing_preview(text[]) to authenticated;

create or replace function public.reserve_finance_transaction_account(
  p_idempotency_key uuid,p_cutoff_date date,p_institution_symbol text,p_customer_name text,p_customer_email text,p_lines jsonb
) returns public.finance_transaction_accounts
language plpgsql security definer set search_path='' as $$
declare
  account public.finance_transaction_accounts; a public.activities; req jsonb; row jsonb;
  line_id uuid; meeting jsonb; claim_total numeric; cumulative numeric; prior_cumulative numeric; mode text; payer uuid; period date; total numeric := 0; customer text; payer_key text; expired uuid;
begin
  if auth.uid() is null or not coalesce(public.app_current_role()='admin' or public.app_has_permission('manage_finance_transactions'),false) then
    raise exception 'finance_transactions_permission_denied' using errcode='42501'; end if;
  if p_idempotency_key is null or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)=0
    or nullif(btrim(p_institution_symbol),'') is null then raise exception 'invalid_transaction_account'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into account from public.finance_transaction_accounts where idempotency_key=p_idempotency_key and institution_symbol=p_institution_symbol;
  if found then return account; end if;
  mode := p_lines->0->>'issue_mode';
  if mode is null or mode not in ('automatic','manual') then raise exception 'invalid_issue_mode'; end if;
  if p_cutoff_date is distinct from (case when mode='automatic' then date_trunc('month',now() at time zone 'Asia/Jerusalem')::date-1 else (now() at time zone 'Asia/Jerusalem')::date end) then
    raise exception 'invalid_cutoff'; end if;
  for expired in select id from public.finance_transaction_accounts stale where stale.document_status='generating'
    and stale.created_at<now()-interval '15 minutes'
    and exists(select 1 from public.finance_transaction_account_lines l where l.account_id=stale.id and l.activity_row_id in (select value->>'activity_row_id' from jsonb_array_elements(p_lines)))
    and not exists(select 1 from finance_private.dispatch_leases where account_id=stale.id and expires_at>now())
  loop perform finance_private.cancel_reservation(expired,'reservation_expired'); end loop;
  -- Stable global lock order for multi-activity accounts.
  perform 1 from public.activities where row_id in (select value->>'activity_row_id' from jsonb_array_elements(p_lines)) order by row_id for update;
  insert into public.finance_transaction_accounts(idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,customer_email_snapshot,total_amount,issue_mode,payment_due_date)
    values(p_idempotency_key,p_cutoff_date,p_institution_symbol,'',nullif(btrim(p_customer_email),''),0,mode,
      (date_trunc('month',now() at time zone 'Asia/Jerusalem')+interval '1 month - 1 day')::date+30) returning * into account;
  for req in select value from jsonb_array_elements(p_lines) order by value->>'activity_row_id',value->>'funding_source_id',value->>'performance_month' loop
    select * into a from public.activities where row_id=req->>'activity_row_id';
    if not found then raise exception 'activity_not_found'; end if;
    if req->>'issue_mode' is distinct from mode then raise exception 'mixed_issue_modes'; end if;
    payer := (req->>'funding_source_id')::uuid;
    period := nullif(req->>'performance_month','')::date;
    select s into row from jsonb_array_elements(finance_private.billing_rows(a)) s
      where (s->>'fundingSourceId')::uuid=payer and (s->>'period')::date is not distinct from period;
    if row is null or not coalesce((row->>'eligible')::boolean,false) then
      raise exception 'billing_blocked:%',coalesce(row->>'blockedReason','activity_not_eligible'); end if;
    if (row->>'gefenFunding')::boolean is distinct from (mode='automatic') then raise exception 'wrong_billing_tab'; end if;
    if row->>'institutionSymbol' is distinct from p_institution_symbol then raise exception 'activity_institution_mismatch'; end if;
    if payer_key is not null and payer_key is distinct from row->>'payerKey' then raise exception 'mixed_payers'; end if;
    payer_key:=row->>'payerKey';
    if exists(select 1 from public.finance_transaction_account_lines where account_id=account.id and funding_source_id<>payer) then raise exception 'mixed_funding_sources'; end if;
    customer := row->>'payerName';
    if req->'meeting_slots' is distinct from (select jsonb_agg((s->>'slot')::int order by (s->>'slot')::int) from jsonb_array_elements(row->'unbilledSlots') s)
      or (req->>'expected_amount')::numeric is distinct from (row->>'issuableAmount')::numeric then raise exception 'stale_billing_preview'; end if;
    insert into public.finance_transaction_account_lines(account_id,activity_row_id,activity_name_snapshot,gefen_number_snapshot,funding_snapshot,
      activity_price_snapshot,planned_meeting_count_snapshot,hourly_rate_snapshot,billed_hours,amount,funding_source_id,funding_amount_snapshot,performance_month,billing_rule)
    values(account.id,a.row_id,a.activity_name,a.activity_no,row->>'funding',a.price,(row->>'plannedCount')::int,(row->>'hourlyRate')::numeric,
      (row->>'unbilledHours')::numeric,(row->>'issuableAmount')::numeric,payer,(row->>'fundingAmount')::numeric,period,case when mode='automatic' then 'monthly' else 'completion' end)
    returning id into line_id;
    select sum((x->>'remainingAmount')::numeric) into claim_total from jsonb_array_elements(row->'unbilledSlots') x;
    cumulative:=0;
    for meeting in select value from jsonb_array_elements(row->'unbilledSlots') loop
      prior_cumulative:=cumulative;cumulative:=cumulative+(meeting->>'remainingAmount')::numeric;
      insert into public.finance_billing_claims values(a.row_id,payer,(meeting->>'slot')::int,account.id,
        round((row->>'issuableAmount')::numeric*cumulative/claim_total,2)-round((row->>'issuableAmount')::numeric*prior_cumulative/claim_total,2),true);
      insert into public.finance_transaction_account_meetings(account_line_id,activity_row_id,meeting_slot,meeting_date)
        values(line_id,a.row_id,(meeting->>'slot')::int,(meeting->>'date')::date);
    end loop;
    total := total+(row->>'issuableAmount')::numeric;
  end loop;
  update public.finance_transaction_accounts set total_amount=total,customer_name_snapshot=customer,payer_key_snapshot=payer_key,authority_id_snapshot=(row->>'authorityId')::bigint,funding_source_id_snapshot=payer where id=account.id returning * into account;
  perform finance_private.finish_reservation(account.id);
  select * into account from public.finance_transaction_accounts where id=account.id;
  return account;
end $$;
revoke all on function public.reserve_finance_transaction_account(uuid,date,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_finance_transaction_account(uuid,date,text,text,text,jsonb) to authenticated;
-- Explicitly close the old implementation as an alternative billing entrypoint.
revoke all on function public.reserve_finance_transaction_account_legacy_impl(uuid,date,text,text,text,jsonb) from public,anon,authenticated,service_role;

create function finance_private.assert_current(p_account_id uuid) returns void
language plpgsql set search_path='' as $$
declare l public.finance_transaction_account_lines; a public.activities; r jsonb; account public.finance_transaction_accounts;
begin
  select * into account from public.finance_transaction_accounts where id=p_account_id;
  perform 1 from public.activities where row_id in(select activity_row_id from public.finance_transaction_account_lines where account_id=p_account_id) order by row_id for update;
  if not exists(select 1 from public.finance_transaction_account_lines where account_id=p_account_id) then raise exception 'empty_account'; end if;
  for l in select * from public.finance_transaction_account_lines where account_id=p_account_id loop
    if l.funding_source_id is null then raise exception 'legacy_reservation_requires_review'; end if;
    select * into a from public.activities where row_id=l.activity_row_id;
    select s into r from jsonb_array_elements(finance_private.billing_rows(a,p_account_id)) s where
      (s->>'fundingSourceId')::uuid=l.funding_source_id and (s->>'period')::date is not distinct from l.performance_month;
    if r is null or not coalesce((r->>'eligible')::boolean,false)
      or (r->>'issuableAmount')::numeric is distinct from l.amount
      or (r->>'fundingAmount')::numeric is distinct from l.funding_amount_snapshot
      or (r->>'plannedCount')::int is distinct from l.planned_meeting_count_snapshot
      or r->>'funding' is distinct from l.funding_snapshot
      or r->>'payerName' is distinct from account.customer_name_snapshot
      or r->>'institutionSymbol' is distinct from account.institution_symbol
      or r->'unbilledSlots' is distinct from (select jsonb_agg(jsonb_build_object('slot',m.meeting_slot,'date',m.meeting_date,'remainingAmount',(select c.claimed_amount from public.finance_billing_claims c where c.account_id=p_account_id and c.activity_row_id=l.activity_row_id and c.funding_source_id=l.funding_source_id and c.meeting_slot=m.meeting_slot)) order by m.meeting_slot) from public.finance_transaction_account_meetings m where m.account_line_id=l.id)
    then raise exception 'stale_billing_reservation'; end if;
  end loop;
end $$;

create table finance_private.dispatch_leases(account_id uuid primary key references public.finance_transaction_accounts(id),token uuid not null,expires_at timestamptz not null);
alter table finance_private.dispatch_leases enable row level security;
create function public.finance_transaction_can_issue() returns boolean language sql stable security invoker set search_path='' as $$
  select auth.uid() is not null and coalesce(public.app_current_role()='admin' or public.app_has_permission('manage_finance_transactions'),false)
$$;
revoke all on function public.finance_transaction_can_issue() from public,anon,authenticated;
grant execute on function public.finance_transaction_can_issue() to authenticated;
create function public.acquire_finance_dispatch(p_account_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
declare status text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  select document_status into status from public.finance_transaction_accounts where id=p_account_id for update;
  if status is null or status='cancelled' then raise exception 'account_not_dispatchable'; end if;
  if status='generating' and exists(select 1 from public.finance_transaction_accounts where id=p_account_id and created_at<now()-interval '15 minutes') then raise exception 'reservation_expired'; end if;
  insert into finance_private.dispatch_leases values(p_account_id,p_token,now()+interval '10 minutes')
    on conflict(account_id) do update set token=excluded.token,expires_at=excluded.expires_at where finance_private.dispatch_leases.expires_at<now();
  if not found then raise exception 'dispatch_in_progress'; end if;
end $$;
create function public.release_finance_dispatch(p_account_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  delete from finance_private.dispatch_leases where account_id=p_account_id and token=p_token;
end $$;
revoke all on function public.acquire_finance_dispatch(uuid,uuid),public.release_finance_dispatch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.acquire_finance_dispatch(uuid,uuid),public.release_finance_dispatch(uuid,uuid) to service_role;

-- Preserve the original finalizer and its grants; revalidate before it can mark issued.
create function finance_private.validate_finalization() returns trigger
language plpgsql set search_path='' as $$
begin
  if OLD.document_status='generating' and NEW.document_status in ('issued','mail_draft_ready','sent') then
    perform finance_private.assert_current(OLD.id);
  end if;
  if NEW.document_status='cancelled' then delete from public.finance_billing_claims where account_id=NEW.id; end if;
  return NEW;
end $$;
create trigger finance_validate_finalization before update of document_status on public.finance_transaction_accounts
for each row execute function finance_private.validate_finalization();

-- Private routines only run under the existing finance SECURITY DEFINER gates.
revoke all on all functions in schema finance_private from public,anon,authenticated,service_role;

create function public.validate_finance_dispatch(p_account_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  if not exists(select 1 from finance_private.dispatch_leases where account_id=p_account_id and token=p_token and expires_at>now()) then raise exception 'dispatch_lease_expired'; end if;
  if exists(select 1 from public.finance_transaction_accounts where id=p_account_id and document_status='generating') then
    perform finance_private.assert_current(p_account_id);
  end if;
end $$;
create function public.finalize_finance_billing(p_account_id uuid,p_token uuid,p_filename text,p_pdf_sha256 text,p_drive_id text,p_folder_item_id text,p_item_id text,p_web_url text)
returns public.finance_transaction_accounts language plpgsql security definer set search_path='' as $$
begin
  perform public.validate_finance_dispatch(p_account_id,p_token);
  return public.finalize_finance_transaction_account(p_account_id,p_filename,p_pdf_sha256,p_drive_id,p_folder_item_id,p_item_id,p_web_url);
end $$;
revoke all on function public.finalize_finance_transaction_account(uuid,text,text,text,text,text,text) from service_role;
revoke all on function public.validate_finance_dispatch(uuid,uuid),public.finalize_finance_billing(uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.validate_finance_dispatch(uuid,uuid),public.finalize_finance_billing(uuid,uuid,text,text,text,text,text,text) to service_role;

create function finance_private.guard_document_snapshot() returns trigger
language plpgsql set search_path='' as $$
declare aid uuid; status text;
begin
  if TG_TABLE_NAME='finance_transaction_account_lines' then aid := OLD.account_id;
  else select account_id into aid from public.finance_transaction_account_lines where id=OLD.account_line_id; end if;
  select document_status into status from public.finance_transaction_accounts where id=aid;
  if status<>'generating' then raise exception 'issued_snapshot_is_immutable'; end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end $$;
create trigger finance_lines_snapshot_guard before update or delete on public.finance_transaction_account_lines
for each row execute function finance_private.guard_document_snapshot();
create trigger finance_meetings_snapshot_guard before update or delete on public.finance_transaction_account_meetings
for each row execute function finance_private.guard_document_snapshot();
revoke all on function finance_private.guard_document_snapshot() from public,anon,authenticated,service_role;

-- A crashed browser/function must not hide a debt indefinitely. Generating
-- reservations expire after 15 minutes; active dispatch leases last 10 minutes.
create function finance_private.cancel_reservation(p_account_id uuid,p_reason text) returns void
language plpgsql set search_path='' as $$
declare status text;
begin
  select document_status into status from public.finance_transaction_accounts where id=p_account_id for update;
  if status is distinct from 'generating' then raise exception 'account_not_cancellable'; end if;
  delete from public.finance_billing_claims where account_id=p_account_id;
  delete from public.finance_transaction_account_meetings where account_line_id in (select id from public.finance_transaction_account_lines where account_id=p_account_id);
  delete from public.finance_transaction_account_lines where account_id=p_account_id;
  update public.finance_transaction_accounts set document_status='cancelled',cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=p_reason where id=p_account_id;
end $$;
create or replace function public.cancel_generating_finance_transaction_account(p_account_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.app_current_role()='admin' or public.app_has_permission('manage_finance_transactions'),false) then
    raise exception 'finance_transactions_permission_denied' using errcode='42501'; end if;
  perform 1 from public.finance_transaction_accounts where id=p_account_id for update;
  if exists(select 1 from finance_private.dispatch_leases where account_id=p_account_id and expires_at>now()) then raise exception 'dispatch_in_progress'; end if;
  perform finance_private.cancel_reservation(p_account_id,p_reason);
end $$;
create function public.cancel_finance_dispatch(p_account_id uuid,p_token uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  perform 1 from public.finance_transaction_accounts where id=p_account_id for update;
  if not exists(select 1 from finance_private.dispatch_leases where account_id=p_account_id and token=p_token) then raise exception 'dispatch_in_progress'; end if;
  perform finance_private.cancel_reservation(p_account_id,p_reason);
end $$;
revoke all on function finance_private.cancel_reservation(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.cancel_finance_dispatch(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_finance_dispatch(uuid,uuid,text) to service_role;
