-- Verify a manual consolidated Gefen account against each course's billing period.
-- Retains full-funding, payer, funding source, and amount validation.
CREATE OR REPLACE FUNCTION finance_private.assert_current(p_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare l public.finance_transaction_account_lines;a public.activities;r jsonb;account public.finance_transaction_accounts;selected jsonb;cap numeric;
begin
  select * into account from public.finance_transaction_accounts where id=p_account_id;
  perform 1 from public.activities where row_id in(select activity_row_id from public.finance_transaction_account_lines where account_id=p_account_id) order by row_id for update;
  if not exists(select 1 from public.finance_transaction_account_lines where account_id=p_account_id) then raise exception 'empty_account'; end if;
  for l in select * from public.finance_transaction_account_lines where account_id=p_account_id loop
    if l.funding_source_id is null then raise exception 'legacy_reservation_requires_review'; end if;
    select * into a from public.activities where row_id=l.activity_row_id;
    select s into r from jsonb_array_elements(finance_private.billing_rows(a,p_account_id)) s where
      (s->>'fundingSourceId')::uuid=l.funding_source_id and ((l.billing_coverage='full_funding' and (not (coalesce((s->>'gefenFunding')::boolean,false) and lower(btrim(coalesce(a.activity_type,'')))='course') or s->>'period'=coalesce(
        (select item->'quote'->'source'->>'period'
           from jsonb_array_elements(coalesce(account.manual_draft->'items','[]'::jsonb)) item
          where item->>'activity'=l.activity_row_id
            and (item->>'funder')::uuid=l.funding_source_id
          limit 1),
        account.manual_draft->'source'->>'period'))) or (s->>'period')::date=l.performance_month) order by s->>'period' limit 1;
    if l.billing_coverage='full_funding' then
      if r is null or coalesce(r->>'fullFundingBlockedReason','')<>'' or (r->>'fullFundingAmount')::numeric is distinct from l.amount or r->>'payerKey' is distinct from account.payer_key_snapshot
        or (r->>'fundingAmount')::numeric is distinct from l.funding_amount_snapshot then raise exception 'stale_billing_reservation'; end if;
      continue;
    end if;
    if r is null or not coalesce((r->>'eligible')::boolean,false) or r->>'payerKey' is distinct from account.payer_key_snapshot or (r->>'fundingAmount')::numeric is distinct from l.funding_amount_snapshot
      or (r->>'plannedCount')::int is distinct from l.planned_meeting_count_snapshot or r->>'funding' is distinct from l.funding_snapshot then raise exception 'stale_billing_reservation'; end if;
    select jsonb_agg(jsonb_build_object('slot',m.meeting_slot,'date',m.meeting_date) order by m.meeting_slot) into selected from public.finance_transaction_account_meetings m where m.account_line_id=l.id;
    if account.manual_draft is null then
      if (r->>'issuableAmount')::numeric is distinct from l.amount or r->>'payerName' is distinct from account.customer_name_snapshot or (account.issue_mode='automatic' and r->>'institutionSymbol' is distinct from account.institution_symbol)
        or selected is distinct from (select jsonb_agg(s-'remainingAmount'-'remainingHours' order by (s->>'slot')::int) from jsonb_array_elements(r->'unbilledSlots') s) then raise exception 'stale_billing_reservation'; end if;
    else
      if exists(select 1 from jsonb_array_elements(selected) s where not exists(select 1 from jsonb_array_elements(r->'unbilledSlots') eligible where eligible-'remainingAmount'-'remainingHours'=s)) then raise exception 'stale_billing_reservation'; end if;
      select sum((s->>'remainingAmount')::numeric) into cap from jsonb_array_elements(r->'unbilledSlots') s where selected @> jsonb_build_array(s-'remainingAmount'-'remainingHours');
      if l.amount>least(cap,(r->>'issuableAmount')::numeric) or account.payer_identity_snapshot is distinct from r->>'payerName' then raise exception 'stale_billing_reservation'; end if;
    end if;
  end loop;
end $function$
;
