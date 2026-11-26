begin;

CREATE OR REPLACE FUNCTION finance_private.manual_quote(p_activity text, p_funder uuid, p_month date, p_draft jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare a public.activities;r jsonb;selected jsonb;quantity int;hours numeric;unit_price numeric;amount numeric;cap numeric;
  issued date;due date;customer text;description text;result jsonb;reason text;full_funding boolean; service_activity boolean; source_hours numeric;
begin
  select * into a from public.activities where row_id=p_activity;
  if not found then raise exception 'activity_not_found'; end if;
  service_activity:=lower(btrim(coalesce(a.activity_type,''))) in ('tour','workshop');
  full_funding:=coalesce(p_draft->>'billing_basis','performance')='full_funding';
  select x into r from jsonb_array_elements(finance_private.billing_rows(a)) x where (x->>'fundingSourceId')::uuid=p_funder
    and ((full_funding and not (coalesce((x->>'gefenFunding')::boolean,false) and lower(btrim(coalesce(a.activity_type,'')))='course')) or (x->>'period')::date=p_month) order by x->>'period' limit 1;
  if r is null or (case when full_funding then coalesce(r->>'fullFundingBlockedReason','')<>'' or coalesce((r->>'fullFundingAmount')::numeric,0)<=0 else not coalesce((r->>'eligible')::boolean,false) end) then raise exception 'billing_blocked:%',coalesce(r->>'blockedReason','הפעילות אינה זכאית להפקה'); end if;
  quantity:=coalesce(nullif(p_draft->>'quantity','')::int,(r->>case when full_funding then 'plannedCount' else 'unbilledCount' end)::int);
  if quantity<1 or quantity>(r->>case when full_funding then 'plannedCount' else 'unbilledCount' end)::int then raise exception 'הכמות חורגת ממספר המפגשים הזכאים'; end if;
  if not service_activity and not coalesce((r->>'gefenFunding')::boolean,false) and quantity<>(r->>case when full_funding then 'plannedCount' else 'unbilledCount' end)::int then raise exception 'חיוב קורס למממן שאינו גפ״ן מבוסס על סכום המימון הקבוע ולא על בחירת מפגשים'; end if;
  select jsonb_agg(s order by (s->>'slot')::int),sum((s->>'remainingAmount')::numeric) into selected,cap
    from (select value s from jsonb_array_elements(r->'unbilledSlots') order by (value->>'slot')::int limit quantity) chosen;
  if full_funding then selected:='[]'::jsonb;cap:=(r->>'fullFundingAmount')::numeric; end if;
  -- Owner confirmed a fixed 90-minute course meeting. Performance inputs
  -- select existing meetings; browser-edited prices/hours cannot reprice them.
  source_hours:=case when full_funding then (r->>'plannedHours')::numeric
    else (select sum((s->>'remainingHours')::numeric) from jsonb_array_elements(selected) s) end;
  hours:=case when service_activity then 0 else source_hours end;
  amount:=coalesce(nullif(p_draft->>'amount','')::numeric,least(cap,(r->>case when full_funding then 'fullFundingAmount' else 'issuableAmount' end)::numeric));
  unit_price:=case when service_activity then coalesce(nullif(p_draft->>'unit_price','')::numeric,amount/quantity) else amount/quantity end;
  if amount<=0 or amount>least(cap,(r->>case when full_funding then 'fullFundingAmount' else 'issuableAmount' end)::numeric) or unit_price<=0 or round(unit_price*quantity,2)<>round(amount,2)
    or (not service_activity and (hours is null or hours<=0 or (nullif(p_draft->>'hours','') is not null and abs((p_draft->>'hours')::numeric-hours)>0.000000001)
      or (coalesce((r->>'gefenFunding')::boolean,false) and amount<>cap) or (full_funding and quantity<>(r->>'plannedCount')::int))) then
    raise exception 'course_performance_mismatch: השעות והסכום חייבים להתאים למפגשים שנבחרו'; end if;
  if full_funding and coalesce((r->>'gefenFunding')::boolean,false) and amount<>cap then raise exception 'חיוב מראש חייב לכסות את מלוא יתרת המממן'; end if;
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
    'finance_transaction_account_lines',jsonb_build_array(jsonb_build_object('activity_row_id',a.row_id,'activity_price_snapshot',a.price,'planned_meeting_count_snapshot',(r->>'plannedCount')::int,'activity_name_snapshot',a.activity_name,
      'school_name_snapshot',coalesce(nullif(p_draft->>'school_name',''),a.school),'gefen_number_snapshot',coalesce(p_draft->>'program_number',a.activity_no),
      'service_description_snapshot',description,'funding_source_id',p_funder,'funding_snapshot',r->>'funding','performance_month',case when full_funding then null::date else p_month end,'billing_coverage',case when full_funding then 'full_funding' else 'performance' end,
      'funding_amount_snapshot',(r->>'fundingAmount')::numeric,'billing_rule',case when (r->>'gefenFunding')::boolean then 'monthly' else 'completion' end,'billed_hours',hours,'quantity_snapshot',quantity,
      'unit_price_snapshot',unit_price,'hourly_rate_snapshot',case when service_activity then null else (r->>'hourlyRate')::numeric end,'amount',round(amount,2),
      'finance_transaction_account_meetings',(select jsonb_agg(jsonb_build_object('meeting_slot',(s->>'slot')::int,'meeting_date',s->>'date','hours',(s->>'remainingHours')::numeric)) from jsonb_array_elements(selected) s))),
    'billing_basis',case when full_funding then 'full_funding' else 'performance' end,'source',r,'override_reason',reason,'selected_slots',selected);
  return result || jsonb_build_object('revision',md5(result::text));
end $function$;

create or replace function finance_private.assert_current(p_account_id uuid)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  l public.finance_transaction_account_lines;
  a public.activities;
  r jsonb;
  account public.finance_transaction_accounts;
  selected jsonb;
  cap numeric;
  expected_period text;
begin
  select * into account from public.finance_transaction_accounts where id = p_account_id;
  perform 1 from public.activities
    where row_id in (select activity_row_id from public.finance_transaction_account_lines where account_id = p_account_id)
    order by row_id for update;
  if not exists(select 1 from public.finance_transaction_account_lines where account_id = p_account_id) then
    raise exception 'empty_account';
  end if;
  for l in select * from public.finance_transaction_account_lines where account_id = p_account_id loop
    if l.funding_source_id is null then raise exception 'legacy_reservation_requires_review'; end if;
    select * into a from public.activities where row_id = l.activity_row_id;
    expected_period := coalesce(
      (
        select item->'quote'->'source'->>'period'
          from jsonb_array_elements(coalesce(account.manual_draft->'items', '[]'::jsonb)) item
         where item->>'activity' = l.activity_row_id
           and (item->>'funder')::uuid = l.funding_source_id
         limit 1
      ),
      account.manual_draft->'source'->>'period'
    );
    select s into r from jsonb_array_elements(finance_private.billing_rows(a, p_account_id)) s
      where (s->>'fundingSourceId')::uuid = l.funding_source_id
        and (
          (l.billing_coverage = 'full_funding'
            and (not (coalesce((s->>'gefenFunding')::boolean, false)
                      and lower(btrim(coalesce(a.activity_type, ''))) = 'course')
                 or s->>'period' = expected_period))
          or (s->>'period')::date = l.performance_month
        )
      order by s->>'period' limit 1;
    if l.billing_coverage = 'full_funding' then
      if r is null or coalesce(r->>'fullFundingBlockedReason', '') <> '' then
        perform finance_private.raise_stale_billing('זכאות לחיוב מלא');
      elsif l.amount>(r->>'fullFundingAmount')::numeric or
        (coalesce((r->>'gefenFunding')::boolean,false) and (r->>'fullFundingAmount')::numeric is distinct from l.amount) then
        perform finance_private.raise_stale_billing('סכום המימון');
      elsif r->>'payerKey' is distinct from account.payer_key_snapshot then
        perform finance_private.raise_stale_billing('גורם מממן');
      elsif (r->>'fundingAmount')::numeric is distinct from l.funding_amount_snapshot then
        perform finance_private.raise_stale_billing('מסגרת המימון');
      end if;
      continue;
    end if;
    if r is null or not coalesce((r->>'eligible')::boolean, false) then
      perform finance_private.raise_stale_billing('זכאות לחיוב');
    elsif r->>'payerKey' is distinct from account.payer_key_snapshot then
      perform finance_private.raise_stale_billing('גורם מממן');
    elsif (r->>'fundingAmount')::numeric is distinct from l.funding_amount_snapshot then
      perform finance_private.raise_stale_billing('מסגרת המימון');
    elsif (r->>'plannedCount')::int is distinct from l.planned_meeting_count_snapshot then
      perform finance_private.raise_stale_billing('מספר המפגשים המתוכנן');
    elsif r->>'funding' is distinct from l.funding_snapshot then
      perform finance_private.raise_stale_billing('גורם מממן');
    end if;
    select jsonb_agg(jsonb_build_object('slot', m.meeting_slot, 'date', m.meeting_date) order by m.meeting_slot)
      into selected
      from public.finance_transaction_account_meetings m
      where m.account_line_id = l.id;
    if account.manual_draft is null then
      if (r->>'issuableAmount')::numeric is distinct from l.amount then
        perform finance_private.raise_stale_billing('סכום לחיוב');
      elsif r->>'payerName' is distinct from account.customer_name_snapshot then
        perform finance_private.raise_stale_billing('שם הלקוח');
      elsif account.issue_mode = 'automatic'
            and r->>'institutionSymbol' is distinct from account.institution_symbol then
        perform finance_private.raise_stale_billing('סמל מוסד');
      elsif selected is distinct from (
          select jsonb_agg(s - 'remainingAmount' - 'remainingHours' order by (s->>'slot')::int)
          from jsonb_array_elements(r->'unbilledSlots') s
        ) then
        perform finance_private.raise_stale_billing('מפגשים לחיוב');
      end if;
    else
      if exists(
        select 1 from jsonb_array_elements(selected) s
        where not exists(
          select 1 from jsonb_array_elements(r->'unbilledSlots') eligible
          where eligible - 'remainingAmount' - 'remainingHours' = s
        )
      ) then
        perform finance_private.raise_stale_billing('מפגשים לחיוב');
      end if;
      select sum((s->>'remainingAmount')::numeric) into cap
      from jsonb_array_elements(r->'unbilledSlots') s
      where selected @> jsonb_build_array(s - 'remainingAmount' - 'remainingHours');
      if l.amount > least(cap, (r->>'issuableAmount')::numeric) then
        perform finance_private.raise_stale_billing('סכום לחיוב');
      elsif account.payer_identity_snapshot is distinct from r->>'payerName' then
        perform finance_private.raise_stale_billing('שם הלקוח');
      end if;
    end if;
  end loop;
end;
$function$;


commit;
