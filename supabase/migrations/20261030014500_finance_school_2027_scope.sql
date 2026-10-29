-- Finance in the active school year only. Calendar year 2026 dates may belong to school_2027.
-- No activity, invoice or receipt records are modified by this migration.

create or replace function public.finance_billing_preview(p_activity_ids text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.activities; result jsonb := '[]';
begin
  if auth.uid() is null or not coalesce(
    public.app_current_role()='admin'
    or public.app_has_permission('view_finance_collection')
    or public.app_has_permission('manage_finance_transactions'), false)
  then
    raise exception 'finance_permission_denied' using errcode='42501';
  end if;
  if cardinality(p_activity_ids)>10000 then raise exception 'too_many_activities'; end if;
  for a in
    select * from public.activities
    where row_id=any(p_activity_ids) and activity_season='school_2027'
    order by row_id
  loop
    result := result || finance_private.billing_rows(a);
  end loop;
  return result;
end $$;
revoke all on function public.finance_billing_preview(text[]) from public,anon,authenticated;
grant execute on function public.finance_billing_preview(text[]) to authenticated;

create or replace function public.finance_manual_account_quote(
  p_activity text, p_funder uuid, p_month date, p_draft jsonb
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.finance_transaction_can_issue() then
    raise exception 'finance_transactions_permission_denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.activities
    where row_id=p_activity and activity_season='school_2027') then
    raise exception 'finance_year_mismatch';
  end if;
  return finance_private.manual_quote(p_activity,p_funder,p_month,p_draft);
end $$;
revoke all on function public.finance_manual_account_quote(text,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.finance_manual_account_quote(text,uuid,date,jsonb) to authenticated;

-- Protect the financial write path too, including direct RPC calls from stale clients.
create function finance_private.guard_finance_school_2027_line() returns trigger
language plpgsql set search_path='' as $$
begin
  if not exists (
    select 1 from public.activities a
    where a.row_id=NEW.activity_row_id and a.activity_season='school_2027'
  ) then
    raise exception 'finance_year_mismatch' using errcode='23514';
  end if;
  return NEW;
end $$;
create trigger finance_lines_school_year_guard
before insert or update of activity_row_id
on public.finance_transaction_account_lines
for each row execute function finance_private.guard_finance_school_2027_line();
revoke all on function finance_private.guard_finance_school_2027_line() from public,anon,authenticated,service_role;
