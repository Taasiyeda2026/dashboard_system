-- Stabilize transaction-account billing: prevent double-settling the same
-- activity/funder/slot, and surface generic stale errors with field-level reasons.
-- No historical account amounts, numbers, or activity source rows are rewritten.
-- Applied in production as version 20261104223358. Do not re-run.
-- Repo filename matches supabase_migrations.schema_migrations.

-- One active settlement claim per activity + funder + meeting slot.
-- Cancelled / expired reservations delete their claims first, so this does not
-- block legitimate re-billing after cancel.
create unique index if not exists finance_billing_claims_settled_slot_unique
  on public.finance_billing_claims (activity_row_id, funding_source_id, meeting_slot)
  where settles_meeting;

create or replace function finance_private.raise_stale_billing(p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', format(
    'נתוני החיוב השתנו (%s). יש לרענן את התצוגה המקדימה ולחשב מחדש לפני ההפקה.',
    coalesce(nullif(btrim(p_reason), ''), 'מחיר, מפגשים, מממן או סכום')
  );
end;
$$;

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
    select s into r from jsonb_array_elements(finance_private.billing_rows(a, p_account_id)) s
      where (s->>'fundingSourceId')::uuid = l.funding_source_id
        and (
          (l.billing_coverage = 'full_funding'
            and (not (coalesce((s->>'gefenFunding')::boolean, false)
                      and lower(btrim(coalesce(a.activity_type, ''))) = 'course')
                 or s->>'period' = account.manual_draft->'source'->>'period'))
          or (s->>'period')::date = l.performance_month
        )
      order by s->>'period' limit 1;
    if l.billing_coverage = 'full_funding' then
      if r is null or coalesce(r->>'fullFundingBlockedReason', '') <> '' then
        perform finance_private.raise_stale_billing('זכאות לחיוב מלא');
      elsif (r->>'fullFundingAmount')::numeric is distinct from l.amount then
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

revoke all on function finance_private.raise_stale_billing(text) from public, anon, authenticated;
revoke all on function finance_private.assert_current(uuid) from public, anon, authenticated;
