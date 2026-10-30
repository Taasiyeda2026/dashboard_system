-- Keep school symbols required for monthly Gefen billing, but not for a non-school payer.
-- No finance records, customer numbers or activities are created or modified.
-- Existing number is optional when payer is an authority or an independent funder.

alter table public.finance_transaction_accounts alter column institution_symbol drop not null;
create unique index if not exists finance_transaction_accounts_idempotency_only_unique
  on public.finance_transaction_accounts(idempotency_key);

create or replace function finance_private.billing_rows(p_activity public.activities, p_ignore_account uuid default null, p_now timestamptz default now())
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
    into total_funding,invalid_funding from finance_private.resolved_funding_rows(p_activity) afs;
  if reason='' and (invalid_funding or total_funding<>p_activity.price) then reason := 'חסרה חלוקת מימון תקינה התואמת למחיר הפעילות'; end if;
  -- A combined funding label cannot be treated as a single payer.
  if reason='' and position('+' in coalesce(p_activity.funding,''))>0
    and (select count(*) from public.activity_funding_sources a where a.activity_id=p_activity.id)<2
  then reason := 'גורם מימון משולב מחייב חלוקה למממנים נפרדים'; end if;
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
  for f in select afs.funding_source_id,afs.amount,afs.name
    from finance_private.resolved_funding_rows(p_activity) afs
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
    if source_reason='' and monthly and coalesce(base->>'institutionSymbol','')='' then source_reason := 'חסר סמל מוסד'; end if;
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
    or (p_lines->0->>'issue_mode'='automatic' and nullif(btrim(p_institution_symbol),'') is null) then raise exception 'invalid_transaction_account'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into account from public.finance_transaction_accounts where idempotency_key=p_idempotency_key;
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
    values(p_idempotency_key,p_cutoff_date,nullif(btrim(p_institution_symbol),''),'',nullif(btrim(p_customer_email),''),0,mode,
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
    if mode='automatic' and row->>'institutionSymbol' is distinct from p_institution_symbol then raise exception 'activity_institution_mismatch'; end if;
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

create or replace function finance_private.manual_quote(p_activity text,p_funder uuid,p_month date,p_draft jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare a public.activities;r jsonb;selected jsonb;quantity int;hours numeric;unit_price numeric;amount numeric;cap numeric;
  issued date;due date;customer text;description text;result jsonb;reason text;full_funding boolean;
begin
  select * into a from public.activities where row_id=p_activity;
  if not found then raise exception 'activity_not_found'; end if;
  full_funding:=coalesce(p_draft->>'billing_basis','performance')='full_funding';
  select x into r from jsonb_array_elements(finance_private.billing_rows(a)) x where (x->>'fundingSourceId')::uuid=p_funder
    and (full_funding or (x->>'period')::date=p_month) order by x->>'period' limit 1;
  if r is null or (case when full_funding then coalesce(r->>'fullFundingBlockedReason','')<>'' or coalesce((r->>'fullFundingAmount')::numeric,0)<=0 else not coalesce((r->>'eligible')::boolean,false) end) then raise exception 'billing_blocked:%',coalesce(r->>'blockedReason','הפעילות אינה זכאית להפקה'); end if;
  quantity:=coalesce(nullif(p_draft->>'quantity','')::int,(r->>case when full_funding then 'plannedCount' else 'unbilledCount' end)::int);
  if quantity<1 or quantity>(r->>case when full_funding then 'plannedCount' else 'unbilledCount' end)::int then raise exception 'הכמות חורגת ממספר המפגשים הזכאים'; end if;
  select jsonb_agg(s order by (s->>'slot')::int),sum((s->>'remainingAmount')::numeric) into selected,cap
    from (select value s from jsonb_array_elements(r->'unbilledSlots') order by (value->>'slot')::int limit quantity) chosen;
  if full_funding then selected:='[]'::jsonb;cap:=(r->>'fullFundingAmount')::numeric; end if;
  hours:=coalesce(nullif(p_draft->>'hours','')::numeric,quantity*1.5);
  amount:=coalesce(nullif(p_draft->>'amount','')::numeric,least(cap,(r->>case when full_funding then 'fullFundingAmount' else 'issuableAmount' end)::numeric));
  unit_price:=coalesce(nullif(p_draft->>'unit_price','')::numeric,amount/quantity);
  if amount<=0 or amount>least(cap,(r->>case when full_funding then 'fullFundingAmount' else 'issuableAmount' end)::numeric) or unit_price<=0 or round(unit_price*quantity,2)<>round(amount,2)
    or hours<=0 or hours>quantity*1.5 then raise exception 'הסכום או השעות חורגים מהיתרה המותרת'; end if;
  if full_funding and amount<>cap then raise exception 'חיוב מראש חייב לכסות את מלוא יתרת המממן'; end if;
  issued:=coalesce(nullif(p_draft->>'issue_date','')::date,(now() at time zone 'Asia/Jerusalem')::date);
  due:=(date_trunc('month',issued)+interval '1 month - 1 day')::date+finance_private.payment_days(r->>'funding');
  reason:=nullif(btrim(p_draft->>'override_reason'),'');
  if issued>(now() at time zone 'Asia/Jerusalem')::date then raise exception 'תאריך הפקה עתידי אינו מותר'; end if;
  if issued<>(now() at time zone 'Asia/Jerusalem')::date or (nullif(p_draft->>'payment_due_date','') is not null and (p_draft->>'payment_due_date')::date<>due) then
    if public.app_current_role() is distinct from 'admin' or reason is null then raise exception 'שינוי מועד דורש הרשאת מנהל וסיבה' using errcode='42501'; end if;
    due:=coalesce(nullif(p_draft->>'payment_due_date','')::date,due);
  end if;
  if due<issued then raise exception 'מועד התשלום קודם להפקה'; end if;
  customer:=coalesce(nullif(btrim(p_draft->>'customer_name'),''),r->>'payerName');
  description:=coalesce(nullif(btrim(p_draft->>'description'),''),a.activity_name);
  result:=jsonb_build_object('transaction_account_number','טיוטה','issue_date',issued,'payment_due_date',due,'institution_symbol',coalesce(nullif(p_draft->>'institution_symbol',''),case when (r->>'gefenFunding')::boolean then r->>'institutionSymbol' else null end),
    'customer_name_snapshot',customer,'payer_identity_snapshot',r->>'payerName','payer_key_snapshot',r->>'payerKey','customer_email_snapshot',coalesce(p_draft->>'customer_email',r->>'customerEmail'),
    'total_amount',round(amount,2),
    'finance_transaction_account_lines',jsonb_build_array(jsonb_build_object('activity_row_id',a.row_id,'activity_name_snapshot',a.activity_name,
      'school_name_snapshot',coalesce(nullif(p_draft->>'school_name',''),a.school),'gefen_number_snapshot',coalesce(p_draft->>'program_number',a.activity_no),
      'service_description_snapshot',description,'funding_source_id',p_funder,'funding_snapshot',r->>'funding','performance_month',case when full_funding then null::date else p_month end,'billing_coverage',case when full_funding then 'full_funding' else 'performance' end,
      'billing_rule',case when (r->>'gefenFunding')::boolean then 'monthly' else 'completion' end,'billed_hours',hours,'quantity_snapshot',quantity,
      'unit_price_snapshot',unit_price,'hourly_rate_snapshot',amount/hours,'amount',round(amount,2),
      'finance_transaction_account_meetings',(select jsonb_agg(jsonb_build_object('meeting_slot',(s->>'slot')::int,'meeting_date',s->>'date','hours',1.5)) from jsonb_array_elements(selected) s))),
    'billing_basis',case when full_funding then 'full_funding' else 'performance' end,'source',r,'override_reason',reason,'selected_slots',selected);
  return result || jsonb_build_object('revision',md5(result::text));
end $$;

create or replace function public.reserve_finance_manual_account(p_idempotency_key uuid,p_activity text,p_funder uuid,p_month date,p_draft jsonb,p_expected_revision text)
returns public.finance_transaction_accounts language plpgsql security definer set search_path='' as $$
declare q jsonb;r jsonb;account public.finance_transaction_accounts;l uuid;slot jsonb;cumulative numeric:=0;prior numeric;cap numeric;amount numeric;quantity int;
begin
  if not public.finance_transaction_can_issue() then raise exception 'finance_transactions_permission_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into account from public.finance_transaction_accounts where idempotency_key=p_idempotency_key;
  if found then return account; end if;
  perform 1 from public.activities where row_id=p_activity for update;
  q:=finance_private.manual_quote(p_activity,p_funder,p_month,p_draft);
  if q->>'revision' is distinct from p_expected_revision then raise exception 'התצוגה המקדימה השתנתה; יש לעדכן אותה'; end if;
  r:=q->'source';
  if q->>'billing_basis'='full_funding' then
    insert into public.finance_transaction_accounts(idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,customer_email_snapshot,total_amount,issue_mode,payment_due_date,issue_date,manual_draft,payer_key_snapshot,authority_id_snapshot,funding_source_id_snapshot,payer_identity_snapshot)
    values(p_idempotency_key,(now() at time zone 'Asia/Jerusalem')::date,q->>'institution_symbol',q->>'customer_name_snapshot',q->>'customer_email_snapshot',(q->>'total_amount')::numeric,'manual',(q->>'payment_due_date')::date,(q->>'issue_date')::date,q,r->>'payerKey',(r->>'authorityId')::bigint,p_funder,r->>'payerName') returning * into account;
    insert into public.finance_transaction_account_lines(account_id,activity_row_id,activity_name_snapshot,gefen_number_snapshot,funding_snapshot,activity_price_snapshot,planned_meeting_count_snapshot,hourly_rate_snapshot,billed_hours,amount,funding_source_id,funding_amount_snapshot,billing_rule,billing_coverage,
      school_name_snapshot,service_description_snapshot,quantity_snapshot,unit_price_snapshot)
    select account.id,p_activity,a.activity_name,q->'finance_transaction_account_lines'->0->>'gefen_number_snapshot',r->>'funding',a.price,(r->>'plannedCount')::int,
      (q->'finance_transaction_account_lines'->0->>'hourly_rate_snapshot')::numeric,(q->'finance_transaction_account_lines'->0->>'billed_hours')::numeric,(q->>'total_amount')::numeric,p_funder,(r->>'fundingAmount')::numeric,
      case when (r->>'gefenFunding')::boolean then 'monthly' else 'completion' end,'full_funding',q->'finance_transaction_account_lines'->0->>'school_name_snapshot',q->'finance_transaction_account_lines'->0->>'service_description_snapshot',
      (q->'finance_transaction_account_lines'->0->>'quantity_snapshot')::numeric,(q->'finance_transaction_account_lines'->0->>'unit_price_snapshot')::numeric from public.activities a where a.row_id=p_activity;
    insert into public.finance_audit_events(event_type,account_id,details) values('manual_full_funding_reserved',account.id,jsonb_build_object('draft',p_draft,'source',r,'revision',p_expected_revision));
    return account;
  end if;
  account:=public.reserve_finance_transaction_account(p_idempotency_key,
    case when (r->>'gefenFunding')::boolean then date_trunc('month',now() at time zone 'Asia/Jerusalem')::date-1 else (now() at time zone 'Asia/Jerusalem')::date end,
    q->>'institution_symbol',r->>'payerName',q->>'customer_email_snapshot',jsonb_build_array(jsonb_build_object('activity_row_id',p_activity,
      'funding_source_id',p_funder,'performance_month',p_month,'expected_amount',r->'issuableAmount','issue_mode',case when (r->>'gefenFunding')::boolean then 'automatic' else 'manual' end,
      'meeting_slots',(select jsonb_agg((s->>'slot')::int order by (s->>'slot')::int) from jsonb_array_elements(r->'unbilledSlots') s))));
  select id into l from public.finance_transaction_account_lines where account_id=account.id;
  delete from public.finance_transaction_account_meetings where account_line_id=l and meeting_slot not in(select (s->>'slot')::int from jsonb_array_elements(q->'selected_slots') s);
  delete from public.finance_billing_claims where account_id=account.id;
  select sum((s->>'remainingAmount')::numeric) into cap from jsonb_array_elements(q->'selected_slots') s;
  amount:=(q->>'total_amount')::numeric;
  for slot in select value from jsonb_array_elements(q->'selected_slots') loop
    prior:=cumulative;cumulative:=cumulative+(slot->>'remainingAmount')::numeric;
    insert into public.finance_billing_claims values(p_activity,p_funder,(slot->>'slot')::int,account.id,round(amount*cumulative/cap,2)-round(amount*prior/cap,2),amount=cap);
  end loop;
  update public.finance_transaction_account_lines set amount=(q->>'total_amount')::numeric,
    service_description_snapshot=q->'finance_transaction_account_lines'->0->>'service_description_snapshot',
    school_name_snapshot=q->'finance_transaction_account_lines'->0->>'school_name_snapshot',
    gefen_number_snapshot=q->'finance_transaction_account_lines'->0->>'gefen_number_snapshot',
    billed_hours=(q->'finance_transaction_account_lines'->0->>'billed_hours')::numeric,
    hourly_rate_snapshot=(q->'finance_transaction_account_lines'->0->>'hourly_rate_snapshot')::numeric,
    quantity_snapshot=(q->'finance_transaction_account_lines'->0->>'quantity_snapshot')::numeric,
    unit_price_snapshot=(q->'finance_transaction_account_lines'->0->>'unit_price_snapshot')::numeric where id=l;
  update public.finance_receipt_allocations set released_at=now(),release_reason='manual_draft_recalculated' where account_id=account.id and released_at is null;
  update public.finance_transaction_accounts set total_amount=(q->>'total_amount')::numeric,issue_date=(q->>'issue_date')::date,
    customer_name_snapshot=q->>'customer_name_snapshot',customer_email_snapshot=q->>'customer_email_snapshot',institution_symbol=q->>'institution_symbol',manual_draft=q where id=account.id;
  perform finance_private.finish_reservation(account.id);
  update public.finance_transaction_accounts set payment_due_date=(q->>'payment_due_date')::date where id=account.id;
  insert into public.finance_audit_events(event_type,account_id,details) values('manual_account_reserved',account.id,jsonb_build_object('draft',p_draft,'source',r,'revision',p_expected_revision));
  select * into account from public.finance_transaction_accounts where id=account.id;
  return account;
end $$;
