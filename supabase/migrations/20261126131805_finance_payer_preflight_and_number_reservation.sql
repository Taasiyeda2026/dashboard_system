begin;

alter table public.finance_transaction_accounts
  alter column transaction_account_number drop default,
  alter column transaction_account_number drop not null,
  add constraint finance_issued_account_has_number check (
    document_status not in ('issued','mail_draft_ready','sent') or transaction_account_number is not null
  );

create function finance_private.payer_recipients(
  p_activities text[], p_payer_key text, p_authority bigint, p_funder uuid, p_explicit_email text
) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
  with activity as (
    select a.school_id, a.school_contact_id from public.activities a where a.row_id=any(p_activities)
  ), contacts as (
    select distinct c.* from public.contacts_schools c where
      lower(btrim(coalesce(c.active,''))) not in ('לא פעיל','inactive','false','0','no') and (
      (p_payer_key like 'school:%' and exists(select 1 from activity a where c.school_id=a.school_id
        or (c.school_id is null and c.id=a.school_contact_id)))
      or (p_payer_key like 'authority:%' and c.client_type='authority'
        and c.authority_id=p_authority)
      or (p_payer_key like 'funding:%' and c.client_type='other'
        and btrim(c.client_name)=(select name from public.funding_sources where id=p_funder))
    )
  ), raw_addresses as (
    select c.id contact_id,c.email value from contacts c
    union all select e.contact_id,e.email from public.contact_emails e join contacts c on c.id=e.contact_id where e.active
    union all select r.contact_id,r.recipient_email from public.finance_school_invoice_recipients r
      where p_payer_key like 'school:%' and exists(select 1 from activity a where a.school_id=r.school_id)
        and (r.contact_id is null or exists(select 1 from contacts c where c.id=r.contact_id))
    -- The account wrapper decides whether a saved payer email was editable
    -- on this route. Automatic issuance always uses current contacts.
    union all select null::bigint,p_explicit_email
  ), addresses as (
    select distinct lower(btrim(part)) email from raw_addresses r
    cross join lateral regexp_split_to_table(coalesce(r.value,''),'[;,\n\r]+') part
    where btrim(part)<>''
      and not exists(select 1 from public.contact_emails disabled where disabled.contact_id=r.contact_id
        and not disabled.active and lower(btrim(disabled.email))=lower(btrim(part)))
  )
  select jsonb_build_object(
    'recipients',coalesce(jsonb_agg(email order by email) filter(where email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),'[]'),
    'invalidCount',count(*) filter(where email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')) into result from addresses;
  return result;
end $$;
revoke all on function finance_private.payer_recipients(text[],text,bigint,uuid,text) from public,anon,authenticated,service_role;

create or replace function public.finance_transaction_recipients(p_account_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare account public.finance_transaction_accounts; result jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501'; end if;
  select * into account from public.finance_transaction_accounts where id=p_account_id;
  if not found then raise exception 'account_not_found'; end if;
  if account.document_revision>0 or account.replaces_account_id is not null then
    select jsonb_build_object('recipients',coalesce(jsonb_agg(email order by email),'[]'),'invalidCount',0) into result from
      (select distinct lower(btrim(x)) email from regexp_split_to_table(coalesce(account.customer_email_snapshot,''),'[;,\n\r]+') x where btrim(x) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') revised;
    return result;
  end if;
  return finance_private.payer_recipients(
    array(select l.activity_row_id from public.finance_transaction_account_lines l where l.account_id=p_account_id),
    account.payer_key_snapshot, account.authority_id_snapshot, account.funding_source_id_snapshot,
    case when account.manual_draft is not null and account.payer_key_snapshot not like 'school:%' then account.customer_email_snapshot end
  );
end $$;

-- The existing preview already resolves the payer email per funder. Reuse
-- that result without a second directory lookup for every billing period.
create or replace function finance_private.manual_payer_emails(p_activity public.activities,p_funder uuid,p_school boolean,p_authority boolean) returns text
language sql stable set search_path='' as $$
  select coalesce(string_agg(email,';' order by email),'')
  from jsonb_array_elements_text(finance_private.payer_recipients(
    array[p_activity.row_id],case when p_school then 'school:'
      when p_authority then 'authority:' else 'funding:' end,
    p_activity.authority_id,p_funder,null
  )->'recipients') as emails(email);
$$;

create or replace function public.finance_billing_preview(p_activity_ids text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(
    public.app_current_role()='admin'
    or public.app_has_permission('view_finance_collection')
    or public.app_has_permission('manage_finance_transactions'), false)
  then
    raise exception 'finance_permission_denied' using errcode='42501';
  end if;
  if cardinality(p_activity_ids)>10000 then raise exception 'too_many_activities'; end if;
  return (
    select coalesce(jsonb_agg(
      case when r.value->>'eligible'='true' and r.value->>'payerKey' is not null
        then r.value || jsonb_build_object('payerEmailMissing',coalesce(r.value->>'customerEmail','')='')
        else r.value end order by a.row_id,r.ordinality
    ),'[]')
    from public.activities a
    cross join lateral jsonb_array_elements(finance_private.billing_rows(a)) with ordinality r
    where a.row_id=any(p_activity_ids) and a.activity_season='school_2027'
  );
end $$;

create function public.prepare_finance_dispatch(p_account_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  account public.finance_transaction_accounts;
  recipients jsonb;
begin
  perform public.validate_finance_dispatch(p_account_id,p_token);
  select * into strict account from public.finance_transaction_accounts where id=p_account_id for update;
  if account.document_status<>'generating' then raise exception 'account_not_dispatchable'; end if;
  recipients:=public.finance_transaction_recipients(p_account_id);
  if jsonb_array_length(recipients->'recipients')=0 then raise exception 'no_valid_payer_email'; end if;
  if account.transaction_account_number is null then
    update public.finance_transaction_accounts
      set transaction_account_number='Pl'||nextval('public.finance_transaction_account_number_seq'::regclass)::text
      where id=p_account_id returning * into account;
  end if;
  return recipients || jsonb_build_object('accountNumber',account.transaction_account_number);
end $$;
revoke all on function public.prepare_finance_dispatch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_finance_dispatch(uuid,uuid) to service_role;

commit;
