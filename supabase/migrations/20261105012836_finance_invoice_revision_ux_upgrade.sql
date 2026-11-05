-- Invoice revision UX upgrade:
-- 1) Financial corrections keep the customer-facing account number on the active
--    replacement document (cancelled original gets a unique cancelled suffix).
-- 2) Course-price edits stay on the account snapshot only — never rewrite
--    activities / activity_funding_sources for תשפ״ז source data.
-- Billing eligibility, claim uniqueness and admin gates are unchanged.

create or replace function finance_private.revision_quote(p_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare r finance_private.invoice_revisions;snap jsonb;oldl jsonb;item jsonb;l jsonb;lines jsonb:='[]';source jsonb;activity public.activities;
 selected jsonb;price numeric;factor numeric;qty integer;hours numeric;amount numeric;cap numeric;total numeric:=0;q jsonb;
begin
 select * into r from finance_private.invoice_revisions where id=p_id;
 if not found or r.status not in ('approved','rendering') then raise exception 'revision_not_approved'; end if;
 snap:=finance_private.invoice_snapshot(r.account_id);
 if finance_private.invoice_hash(snap)<>r.base_hash then raise exception 'invoice_revision_stale';end if;
 if r.financial then
  if r.source_hash<>finance_private.invoice_source_hash(r.account_id) then raise exception 'invoice_revision_stale';end if;
  perform finance_private.assert_financial_correction(r.account_id);
 end if;
 for item in select value from jsonb_array_elements(r.proposed->'lines') loop
  select value into oldl from jsonb_array_elements(snap->'finance_transaction_account_lines') where value->>'id'=item->>'id';
  l:=oldl||jsonb_build_object('school_name_snapshot',item->'school_name_snapshot','service_description_snapshot',item->'service_description_snapshot');
  if r.financial then
   select * into activity from public.activities where row_id=oldl->>'activity_row_id';
   select x into source from jsonb_array_elements(finance_private.billing_rows(activity,r.account_id)) x where x->>'fundingSourceId'=oldl->>'funding_source_id'
     and ((oldl->>'billing_coverage'='full_funding' and not coalesce((x->>'gefenFunding')::boolean,false)) or x->>'period'=oldl->>'performance_month' or (oldl->>'billing_coverage'='full_funding' and x->>'period'=snap->'manual_draft'->'source'->>'period')) order by x->>'period' limit 1;
   if source is null then raise exception 'revision_billing_not_eligible';end if;
   if source->>'payerKey' is distinct from snap->>'payer_key_snapshot' or (coalesce((source->>'gefenFunding')::boolean,false) and source->>'institutionSymbol' is distinct from snap->>'institution_symbol') then raise exception 'revision_payer_identity_changed';end if;
   price:=(item->>'activity_price_snapshot')::numeric;factor:=price/nullif(activity.price,0);
   if price<=0 or price>activity.price or price<>trunc(price) then raise exception 'revision_price_exceeds_contract';end if;
   -- Document-only price change: never mutate תשפ״ז activity rows here.
   qty:=(item->>'quantity_snapshot')::numeric::integer;
   if qty<=0 or (item->>'quantity_snapshot')::numeric<>qty then raise exception 'invalid_revision_quantity';end if;
   if oldl->>'billing_coverage'='full_funding' then
    if coalesce(source->>'fullFundingBlockedReason','')<>'' or qty<>(source->>'plannedCount')::int then raise exception 'revision_billing_not_eligible';end if;
    selected:='[]';cap:=(source->>'fullFundingAmount')::numeric*factor;
    hours:=case when lower(activity.activity_type) in ('workshop','tour') then 0 else (source->>'plannedHours')::numeric end;
   else
    if not coalesce((source->>'eligible')::boolean,false) or qty>(source->>'unbilledCount')::int then raise exception 'revision_billing_not_eligible';end if;
    select coalesce(jsonb_agg(s order by (s->>'slot')::int),'[]'),sum((s->>'remainingAmount')::numeric)*factor,
      sum((s->>'remainingHours')::numeric) into selected,cap,hours
      from (select value s from jsonb_array_elements(source->'unbilledSlots') order by (value->>'slot')::int limit qty) chosen;
   end if;
   if price is distinct from activity.price and oldl->>'billing_coverage'<>'full_funding' then
    with slots as (
     select distinct (s->>'slot')::int slot from jsonb_array_elements(finance_private.billing_rows(activity,r.account_id)) rows
      cross join lateral jsonb_array_elements(rows->'unbilledSlots') s where rows->>'fundingSourceId'=oldl->>'funding_source_id'
    ), ranked as (select slot,row_number() over(order by slot) n from slots), repriced as (
     select s||jsonb_build_object('remainingAmount',round(price*n/(source->>'plannedCount')::numeric,2)-round(price*(n-1)/(source->>'plannedCount')::numeric,2)) s
     from jsonb_array_elements(selected) s join ranked on ranked.slot=(s->>'slot')::int
    ) select jsonb_agg(s order by (s->>'slot')::int),sum((s->>'remainingAmount')::numeric) into selected,cap from repriced;
   end if;
   amount:=round(cap,2);
   if abs((item->>'billed_hours')::numeric-hours)>0.000000001 or (item->>'amount')::numeric<>amount or amount<=0
    then raise exception 'revision_billing_mismatch: השעות והסכום צריכים להתאים למפגשים שנבחרו. סכום החיוב התקין הוא % ושעות החיוב הן %.',amount,hours;end if;
   l:=l||jsonb_build_object('funding_snapshot',source->>'funding','activity_price_snapshot',price,'planned_meeting_count_snapshot',(source->>'plannedCount')::int,
    'quantity_snapshot',qty,'billed_hours',hours,'amount',amount,'unit_price_snapshot',amount/qty,
    'hourly_rate_snapshot',case when hours=0 then null else (source->>'hourlyRate')::numeric*factor end,
    'funding_amount_snapshot',(source->>'fundingAmount')::numeric*factor,
    'finance_transaction_account_meetings',(select coalesce(jsonb_agg(jsonb_build_object('meeting_slot',(s->>'slot')::int,'meeting_date',s->>'date','hours',case when hours=0 then 1.5 else (s->>'remainingHours')::numeric end) order by (s->>'slot')::int),'[]') from jsonb_array_elements(selected) s),
    'revision_selected_slots',selected,'revision_source',source);
  end if;
  total:=total+(l->>'amount')::numeric;lines:=lines||jsonb_build_array(l);
 end loop;
 q:=snap||(r.proposed-'lines')||jsonb_build_object('transaction_account_number',case when r.financial then snap->>'transaction_account_number' else snap->>'transaction_account_number' end,
  'total_amount',total,'finance_transaction_account_lines',lines,'revision_price_changes','[]'::jsonb,'revision_request_id',r.id,'revision_financial',r.financial,
  'revision_keeps_account_number',r.financial);
 if r.financial then
  q:=q||jsonb_build_object('issue_date',case when r.proposed->>'issue_date' is distinct from r.before_snapshot->>'issue_date' then (r.proposed->>'issue_date')::date else (now() at time zone 'Asia/Jerusalem')::date end);
  q:=q||jsonb_build_object('payment_due_date',case when r.proposed->>'payment_due_date' is distinct from r.before_snapshot->>'payment_due_date' then (r.proposed->>'payment_due_date')::date else (date_trunc('month',(q->>'issue_date')::date)+interval '1 month - 1 day')::date+finance_private.payment_days(lines->0->>'funding_snapshot') end);
  if (q->>'payment_due_date')::date<(q->>'issue_date')::date then raise exception 'invalid_revision_details';end if;
 end if;
 return q||jsonb_build_object('revision',finance_private.invoice_hash(q));
end $$;

create or replace function public.begin_finance_invoice_revision(p_id uuid,p_token uuid,p_expected_revision text,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r finance_private.invoice_revisions;q jsonb;a public.finance_transaction_accounts;target public.finance_transaction_accounts;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501';end if;
 if p_actor is null then raise exception 'revision_actor_required';end if;
 perform 1 from public.finance_transaction_accounts where id=(select account_id from finance_private.invoice_revisions where id=p_id) for update;
 select * into r from finance_private.invoice_revisions where id=p_id for update;
 if r.status='applied' then return jsonb_build_object('applied',true,'accountId',r.result_account_id);end if;
 if r.financial and (r.decided_by is null or r.decided_at is null) then raise exception 'revision_not_approved';end if;
 perform public.acquire_finance_dispatch(r.account_id,p_token);
 q:=finance_private.revision_quote(p_id);
 if q->>'revision' is distinct from p_expected_revision then raise exception 'invoice_revision_stale';end if;
 select * into a from public.finance_transaction_accounts where id=r.account_id for update;
 update finance_private.invoice_revisions set status='rendering',dispatch_token=p_token,applied_by=p_actor,applied_name=finance_private.invoice_actor_name(p_actor) where id=p_id;
 if r.financial then
  if r.replacement_account_id is null then
   r.replacement_account_id:=gen_random_uuid();
   update finance_private.invoice_revisions set replacement_account_id=r.replacement_account_id where id=p_id;
   insert into public.finance_transaction_accounts(id,idempotency_key,cutoff_date,institution_symbol,customer_name_snapshot,customer_email_snapshot,total_amount,issue_mode,payment_due_date,payer_key_snapshot,payer_identity_snapshot,funding_source_id_snapshot,replaces_account_id,outlook_message_id,outlook_mailbox,created_by)
    values(r.replacement_account_id,r.id,case when a.issue_mode='automatic' then date_trunc('month',now() at time zone 'Asia/Jerusalem')::date-1 else (now() at time zone 'Asia/Jerusalem')::date end,
     a.institution_symbol,q->>'customer_name_snapshot',q->>'customer_email_snapshot',(q->>'total_amount')::numeric,a.issue_mode,(q->>'payment_due_date')::date,
     a.payer_key_snapshot,q->'finance_transaction_account_lines'->0->'revision_source'->>'payerName',a.funding_source_id_snapshot,a.id,a.outlook_message_id,a.outlook_mailbox,r.requested_by)
     returning * into target;
  else
   select * into target from public.finance_transaction_accounts where id=r.replacement_account_id for update;
   if target.document_status<>'generating' or exists(select 1 from public.finance_transaction_account_lines where account_id=target.id) then raise exception 'invalid_replacement_reservation';end if;
   update public.finance_transaction_accounts set created_at=now() where id=target.id;
  end if;
  -- Keep the customer-facing number on the PDF quote; the reserved row gets it only after the original is cancelled.
  q:=q||jsonb_build_object('id',target.id,'transaction_account_number',a.transaction_account_number,'revision_keeps_account_number',true);
 else target:=a;
 end if;
 return jsonb_build_object('quote',q||jsonb_build_object('revision_created_at',r.requested_at),'accountId',target.id,'originalAccountId',a.id,'financial',r.financial,
  'originalMailbox',a.outlook_owner_mailbox,'originalMessageId',a.outlook_message_id,'originalOwnerId',a.outlook_owner_id,
  'previousFiles',(select coalesce(jsonb_agg(jsonb_build_object('name',snapshot->>'generated_filename','hash',snapshot->>'pdf_sha256')),'[]') from finance_private.invoice_versions where account_id=a.id));
end $$;

create or replace function public.finish_finance_invoice_revision(p_id uuid,p_token uuid,p_expected_revision text,p_filename text,p_hash text,p_drive text,p_folder text,p_item text,p_url text,p_mail_state text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r finance_private.invoice_revisions;q jsonb;l jsonb;m jsonb;a public.finance_transaction_accounts;target_id uuid;line_id uuid;cap numeric;cumulative numeric;prior numeric;kept_number text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501';end if;
 perform 1 from public.finance_transaction_accounts where id=(select account_id from finance_private.invoice_revisions where id=p_id) for update;
 select * into r from finance_private.invoice_revisions where id=p_id for update;
 if r.status='applied' then return jsonb_build_object('accountId',r.result_account_id,'applied',true);end if;
 if r.status<>'rendering' or r.dispatch_token is distinct from p_token or not exists(select 1 from finance_private.dispatch_leases where account_id=r.account_id and token=p_token and expires_at>now()) then raise exception 'dispatch_lease_expired';end if;
 perform 1 from public.finance_transaction_accounts where id=r.account_id for update;
 perform 1 from public.activities where row_id in(select value->>'activity_row_id' from jsonb_array_elements(r.before_snapshot->'finance_transaction_account_lines')) order by row_id for update;
 q:=finance_private.revision_quote(p_id);
 if q->>'revision' is distinct from p_expected_revision then raise exception 'invoice_revision_stale';end if;
 if p_hash!~'^[a-f0-9]{64}$' or coalesce(p_item,'')='' or coalesce(p_filename,'')='' or coalesce(p_url,'')='' then raise exception 'invalid_revision_pdf';end if;
 select * into a from public.finance_transaction_accounts where id=r.account_id;
 if r.financial and a.outlook_message_id is not null and p_mail_state is distinct from 'draft' then raise exception 'finance_decision_required';end if;
 perform set_config('finance.invoice_revision_id',r.id::text,true);
 if r.financial then
  target_id:=r.replacement_account_id;
  if target_id is null then raise exception 'replacement_not_reserved';end if;
  kept_number:=a.transaction_account_number;
  -- Never rewrite activities / funding sources: corrections stay on the account.
  update public.finance_transaction_accounts set document_status='cancelled',cancelled_at=now(),cancelled_by=r.decided_by,
   outlook_status='needs_review',outlook_error='invoice_replaced_by_corrected_account',cancellation_reason='הוחלף בעקבות תיקון כספי מאושר '||r.id::text,replaced_by_account_id=target_id,
   transaction_account_number=kept_number||'-בוטל-'||replace(left(a.id::text,8),'-','')
   where id=a.id;
  for l in select value from jsonb_array_elements(q->'finance_transaction_account_lines') loop
   insert into public.finance_transaction_account_lines(account_id,activity_row_id,activity_name_snapshot,gefen_number_snapshot,funding_snapshot,activity_price_snapshot,planned_meeting_count_snapshot,
    hourly_rate_snapshot,billed_hours,amount,funding_source_id,funding_amount_snapshot,performance_month,billing_rule,billing_coverage,school_name_snapshot,service_description_snapshot,quantity_snapshot,unit_price_snapshot)
   values(target_id,l->>'activity_row_id',l->>'activity_name_snapshot',l->>'gefen_number_snapshot',l->>'funding_snapshot',(l->>'activity_price_snapshot')::numeric,(l->>'planned_meeting_count_snapshot')::int,
    (l->>'hourly_rate_snapshot')::numeric,(l->>'billed_hours')::numeric,(l->>'amount')::numeric,(l->>'funding_source_id')::uuid,(l->>'funding_amount_snapshot')::numeric,
    (l->>'performance_month')::date,l->>'billing_rule',l->>'billing_coverage',l->>'school_name_snapshot',l->>'service_description_snapshot',(l->>'quantity_snapshot')::numeric,(l->>'unit_price_snapshot')::numeric) returning id into line_id;
   if l->>'billing_coverage'<>'full_funding' then
    select sum((s->>'remainingAmount')::numeric) into cap from jsonb_array_elements(l->'revision_selected_slots') s;
    cumulative:=0;
    for m in select value from jsonb_array_elements(l->'revision_selected_slots') loop
     prior:=cumulative;cumulative:=cumulative+(m->>'remainingAmount')::numeric;
     insert into public.finance_billing_claims values(l->>'activity_row_id',(l->>'funding_source_id')::uuid,(m->>'slot')::int,target_id,
       round((l->>'amount')::numeric*cumulative/cap,2)-round((l->>'amount')::numeric*prior/cap,2),true);
    end loop;
   end if;
   for m in select value from jsonb_array_elements(l->'finance_transaction_account_meetings') loop
    insert into public.finance_transaction_account_meetings(account_line_id,activity_row_id,meeting_slot,meeting_date,hours) values(line_id,l->>'activity_row_id',(m->>'meeting_slot')::int,(m->>'meeting_date')::date,(m->>'hours')::numeric);
   end loop;
  end loop;
  update public.finance_transaction_accounts set manual_draft=q||jsonb_build_object('source',q->'finance_transaction_account_lines'->0->'revision_source'),issue_date=(q->>'issue_date')::date,payment_due_date=(q->>'payment_due_date')::date where id=target_id;
  perform finance_private.finish_reservation(target_id);
  update public.finance_transaction_accounts set payment_due_date=(q->>'payment_due_date')::date,transaction_account_number=kept_number where id=target_id;
  perform public.acquire_finance_dispatch(target_id,p_token);
  perform public.finalize_finance_billing(target_id,p_token,p_filename,p_hash,p_drive,p_folder,p_item,p_url);
  perform public.release_finance_dispatch(target_id,p_token);
  -- Re-assert the original number after finalize (which may have assigned a new Pl*).
  update public.finance_transaction_accounts set transaction_account_number=kept_number where id=target_id;
 else
  target_id:=a.id;
  update public.finance_transaction_accounts set customer_name_snapshot=q->>'customer_name_snapshot',customer_email_snapshot=q->>'customer_email_snapshot',issue_date=(q->>'issue_date')::date,payment_due_date=(q->>'payment_due_date')::date,
   expected_collection_date=case when expected_collection_date=payment_due_date then (q->>'payment_due_date')::date else expected_collection_date end,document_revision=document_revision+1,generated_filename=p_filename,pdf_sha256=p_hash,sharepoint_drive_id=p_drive,sharepoint_folder_item_id=p_folder,sharepoint_item_id=p_item,sharepoint_web_url=p_url where id=target_id;
  for l in select value from jsonb_array_elements(q->'finance_transaction_account_lines') loop
   update public.finance_transaction_account_lines set school_name_snapshot=l->>'school_name_snapshot',service_description_snapshot=l->>'service_description_snapshot' where id=(l->>'id')::uuid and account_id=target_id;
  end loop;
 end if;
 update public.finance_transaction_accounts set outlook_status=case when p_mail_state='sent' or document_status='sent' or outlook_status='already_sent' then 'already_sent' else 'waiting_connection' end,
  outlook_error=case when p_mail_state='sent' or document_status='sent' or outlook_status='already_sent' then 'document_corrected_requires_send_decision' else 'invoice_revision_draft_update_pending' end where id=target_id;
 insert into finance_private.outlook_jobs(account_id)
  select id from public.finance_transaction_accounts where id=target_id and outlook_status<>'already_sent'
  on conflict(account_id) do update set state='pending',attempts=0,next_retry_at=now(),last_error='invoice_revision_draft_update_pending';
 if r.financial then update finance_private.outlook_jobs set state='blocked',last_error='invoice_replaced_by_corrected_account' where account_id=a.id;end if;
 insert into finance_private.invoice_versions(account_id,version,request_id,snapshot,actor_id,actor_name) select id,document_revision,r.id,finance_private.invoice_snapshot(id),r.applied_by,r.applied_name from public.finance_transaction_accounts where id=target_id;
 update finance_private.invoice_revisions set status='applied',applied_at=now(),result_account_id=target_id where id=r.id;
 insert into public.finance_audit_events(event_type,account_id,actor_id,details) values('invoice_revision_applied',target_id,r.applied_by,jsonb_build_object('revision_id',r.id,'original_account_id',a.id,'financial',r.financial,'approved_by',r.decided_by,'actor',r.applied_by,'actor_name',r.applied_name,'changes',r.changes,'kept_account_number',kept_number,'activity_source_unchanged',true));
 return jsonb_build_object('accountId',target_id,'originalAccountId',a.id,'applied',true,'financial',r.financial,'keptAccountNumber',kept_number);
end $$;
