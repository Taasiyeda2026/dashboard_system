-- Versioned document corrections; financial corrections always require an explicit
-- administrator decision and create a linked replacement after its PDF is stored.
alter table public.finance_transaction_accounts
  add column document_revision integer not null default 0 check(document_revision>=0),
  add column replaces_account_id uuid references public.finance_transaction_accounts(id),
  add column replaced_by_account_id uuid references public.finance_transaction_accounts(id);
create table finance_private.invoice_revisions(
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.finance_transaction_accounts(id),
 request_key uuid not null unique, base_hash text not null, source_hash text not null, before_snapshot jsonb not null, proposed jsonb not null, changes jsonb not null,
 financial boolean not null, status text not null check(status in ('pending_admin','approved','rejected','rendering','applied','finance_review_required')),
 requested_by uuid not null, requested_name text not null, requested_at timestamptz not null default now(),
 decided_by uuid,decided_name text,decided_at timestamptz,decision_reason text,
 replacement_account_id uuid references public.finance_transaction_accounts(id) deferrable initially deferred,
 dispatch_token uuid,applied_by uuid,applied_name text,applied_at timestamptz, result_account_id uuid references public.finance_transaction_accounts(id)
);
create unique index invoice_revision_one_open on finance_private.invoice_revisions(account_id) where status in ('pending_admin','approved','rendering','finance_review_required');
create index invoice_revisions_account_history on finance_private.invoice_revisions(account_id,requested_at desc);
create unique index invoice_revisions_replacement on finance_private.invoice_revisions(replacement_account_id) where replacement_account_id is not null;
create index invoice_revisions_result on finance_private.invoice_revisions(result_account_id) where result_account_id is not null;
create table finance_private.invoice_versions(
 account_id uuid not null references public.finance_transaction_accounts(id),version integer not null,
 request_id uuid unique references finance_private.invoice_revisions(id),snapshot jsonb not null,
 actor_id uuid,actor_name text not null default '',created_at timestamptz not null default now(),primary key(account_id,version)
);
alter table finance_private.invoice_revisions enable row level security;
alter table finance_private.invoice_versions enable row level security;
revoke all on finance_private.invoice_revisions,finance_private.invoice_versions from public,anon,authenticated,service_role;

create function finance_private.invoice_actor_name(p_id uuid) returns text language sql stable set search_path='' as $$
 select coalesce((select coalesce(nullif(btrim(to_jsonb(u)->>'display_name'),''),nullif(btrim(to_jsonb(u)->>'full_name'),''),nullif(btrim(to_jsonb(u)->>'name'),''),u.email) from public.users u where u.auth_user_id=p_id),p_id::text,'לא ידוע');
$$;
create function finance_private.invoice_snapshot(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(a)||jsonb_build_object('finance_transaction_account_lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('finance_transaction_account_meetings',coalesce((select jsonb_agg(to_jsonb(m) order by meeting_slot) from public.finance_transaction_account_meetings m where m.account_line_id=l.id),'[]')) order by l.id) from public.finance_transaction_account_lines l where l.account_id=a.id),'[]'))
 from public.finance_transaction_accounts a where a.id=p_id;
$$;
create function finance_private.invoice_source_hash(p_id uuid) returns text language sql stable set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_object('activity',to_jsonb(a),'funding',(select jsonb_agg(to_jsonb(f) order by f.funding_source_id) from finance_private.resolved_funding_rows(a) f),
 'cancelled',(select jsonb_agg(c.meeting_date order by c.meeting_date) from public.course_meeting_cancellations c where c.activity_id=a.row_id)) order by a.row_id),'[]')::text)
 from public.activities a where a.row_id in(select activity_row_id from public.finance_transaction_account_lines where account_id=p_id);
$$;
create function finance_private.invoice_hash(p_snapshot jsonb) returns text language sql immutable set search_path='' as $$
 select md5((select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p_snapshot) where key not like 'outlook_%' and key not in ('expected_collection_date','finance_note','collection_status'))::text);
$$;
create function finance_private.assert_revision_access(p_id uuid,p_readonly boolean default false) returns void language plpgsql stable set search_path='' as $$
begin
 if not coalesce(public.finance_transaction_can_issue(),false) then raise exception 'finance_transactions_permission_denied' using errcode='42501'; end if;
 if not exists(select 1 from public.finance_transaction_accounts a where a.id=p_id and (a.document_status in ('issued','mail_draft_ready','sent') or (p_readonly and a.document_status='cancelled')) and exists(select 1 from public.finance_transaction_account_lines l where l.account_id=a.id)
   and not exists(select 1 from public.finance_transaction_account_lines l left join public.activities activity on activity.row_id=l.activity_row_id where l.account_id=a.id and coalesce(activity.activity_season,'')<>'school_2027')) then raise exception 'invoice_not_editable'; end if;
end $$;
create function finance_private.assert_financial_correction(p_id uuid) returns void language plpgsql stable set search_path='' as $$
declare a public.finance_transaction_accounts;
begin
 select * into a from public.finance_transaction_accounts where id=p_id;
 if a.document_status not in ('issued','mail_draft_ready') or a.outlook_status='already_sent' or a.collection_status<>'awaiting_payment'
   or finance_private.account_paid(p_id)>0 or nullif(btrim(a.finance_note),'') is not null
   or (a.expected_collection_date is not null and a.expected_collection_date is distinct from a.payment_due_date)
   or (a.outlook_message_id is null and a.outlook_creation_started_at is not null)
 then raise exception 'finance_decision_required: חשבון שנשלח, שולם או נמצא בטיפול גבייה מחייב החלטת כספים נפרדת'; end if;
end $$;

create function public.finance_invoice_revision_context(p_account_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare snap jsonb;
begin
 if not coalesce(public.finance_transaction_can_issue(),false) then raise exception 'finance_transactions_permission_denied' using errcode='42501'; end if;
 if p_account_id is null then
  if public.app_current_role() is distinct from 'admin' then raise exception 'admin_required' using errcode='42501'; end if;
  return jsonb_build_object('requests',coalesce((select jsonb_agg(to_jsonb(r)-'dispatch_token' order by requested_at) from finance_private.invoice_revisions r where status in ('pending_admin','finance_review_required')),'[]'));
 end if;
 perform finance_private.assert_revision_access(p_account_id,true);
 snap:=finance_private.invoice_snapshot(p_account_id);
 return jsonb_build_object('account',snap,'baseHash',finance_private.invoice_hash(snap),
 'requests',coalesce((select jsonb_agg(to_jsonb(r)-'dispatch_token' order by requested_at desc) from finance_private.invoice_revisions r where account_id=p_account_id or result_account_id=p_account_id),'[]'),
 'versions',coalesce((select jsonb_agg(to_jsonb(v) order by version desc) from finance_private.invoice_versions v where account_id=p_account_id),'[]'),
 'events',coalesce((select jsonb_agg(jsonb_build_object('type',event_type,'at',ev.occurred_at,'actor',coalesce(details->>'actor_name',finance_private.invoice_actor_name((details->>'actor')::uuid))) order by ev.occurred_at,ev.id) from public.finance_audit_events ev where ev.event_type like 'invoice_revision_%' and ev.account_id in (p_account_id,(snap->>'replaces_account_id')::uuid,(snap->>'replaced_by_account_id')::uuid)),'[]'));
end $$;

create function public.finance_request_invoice_revision(p_account_id uuid,p_key uuid,p_base_hash text,p_proposed jsonb,p_admin_approve boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare snap jsonb;oldline jsonb;newl jsonb;item jsonb; normalized jsonb;items jsonb:='[]';diff jsonb:='[]';k text;v jsonb;oldv jsonb;financial boolean:=false;r finance_private.invoice_revisions;name text;
begin
 perform finance_private.assert_revision_access(p_account_id);
 if p_admin_approve and public.app_current_role() is distinct from 'admin' then raise exception 'admin_required' using errcode='42501';end if;
 perform 1 from public.finance_transaction_accounts where id=p_account_id for update;
 select * into r from finance_private.invoice_revisions where request_key=p_key;
 if found then if r.account_id<>p_account_id or r.requested_by<>auth.uid() then raise exception 'revision_request_mismatch'; end if;
  if p_admin_approve and r.status='pending_admin' then perform public.finance_decide_invoice_revision(r.id,true,'אישור מפורש בעת העריכה');select * into r from finance_private.invoice_revisions where id=r.id;end if;
  return to_jsonb(r)-'dispatch_token';end if;
 if exists(select 1 from finance_private.dispatch_leases where account_id=p_account_id and expires_at>now()) then raise exception 'dispatch_in_progress'; end if;
 snap:=finance_private.invoice_snapshot(p_account_id);
 if finance_private.invoice_hash(snap) is distinct from p_base_hash then raise exception 'invoice_revision_stale'; end if;
 if jsonb_typeof(p_proposed)<>'object' or exists(select 1 from jsonb_object_keys(p_proposed) x where x not in ('customer_name_snapshot','customer_email_snapshot','issue_date','payment_due_date','lines')) then raise exception 'invalid_revision_fields'; end if;
 normalized:=jsonb_build_object('customer_name_snapshot',btrim(coalesce(p_proposed->>'customer_name_snapshot',snap->>'customer_name_snapshot')),
 'customer_email_snapshot',btrim(coalesce(p_proposed->>'customer_email_snapshot',snap->>'customer_email_snapshot','')),
 'issue_date',coalesce(p_proposed->>'issue_date',snap->>'issue_date')::date,'payment_due_date',coalesce(p_proposed->>'payment_due_date',snap->>'payment_due_date')::date);
 if length(normalized->>'customer_name_snapshot') not between 1 and 300 or length(normalized->>'customer_email_snapshot')>2000
   or (normalized->>'issue_date')::date>(now() at time zone 'Asia/Jerusalem')::date or (normalized->>'payment_due_date')::date<(normalized->>'issue_date')::date then raise exception 'invalid_revision_details';end if;
 if exists(select 1 from regexp_split_to_table(normalized->>'customer_email_snapshot','[;,\n\r]+') email where btrim(email)<>'' and btrim(email)!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then raise exception 'invalid_revision_email'; end if;
 if (normalized->>'issue_date' is distinct from snap->>'issue_date' or normalized->>'payment_due_date' is distinct from snap->>'payment_due_date') and public.app_current_role() is distinct from 'admin' then raise exception 'revision_dates_require_admin' using errcode='42501';end if;
 for k,v in select * from jsonb_each(normalized) loop
  if v is distinct from (case when k in ('customer_name_snapshot','customer_email_snapshot') then to_jsonb(coalesce(snap->>k,'')) else snap->k end) then diff:=diff||jsonb_build_array(jsonb_build_object('field',k,'before',snap->k,'after',v));end if;
 end loop;
 if jsonb_typeof(p_proposed->'lines') is distinct from 'array' or jsonb_array_length(p_proposed->'lines')<>jsonb_array_length(snap->'finance_transaction_account_lines')
 or (select count(distinct value->>'id') from jsonb_array_elements(p_proposed->'lines'))<>jsonb_array_length(p_proposed->'lines') then raise exception 'revision_activity_identity_immutable';end if;
 for item in select value from jsonb_array_elements(p_proposed->'lines') loop
  select value into oldline from jsonb_array_elements(snap->'finance_transaction_account_lines') where value->>'id'=item->>'id';
  if oldline is null or exists(select 1 from jsonb_object_keys(item) x where x not in ('id','school_name_snapshot','service_description_snapshot','activity_price_snapshot','quantity_snapshot','billed_hours','amount')) then raise exception 'revision_activity_identity_immutable';end if;
  newl:=jsonb_build_object('id',oldline->'id','school_name_snapshot',coalesce(item->>'school_name_snapshot',oldline->>'school_name_snapshot',''),
    'service_description_snapshot',coalesce(item->>'service_description_snapshot',oldline->>'service_description_snapshot',oldline->>'activity_name_snapshot'),
    'activity_price_snapshot',coalesce((item->>'activity_price_snapshot')::numeric,(oldline->>'activity_price_snapshot')::numeric),
    'quantity_snapshot',coalesce((item->>'quantity_snapshot')::numeric,(oldline->>'quantity_snapshot')::numeric,jsonb_array_length(oldline->'finance_transaction_account_meetings')),
    'billed_hours',coalesce((item->>'billed_hours')::numeric,(oldline->>'billed_hours')::numeric), 'amount',coalesce((item->>'amount')::numeric,(oldline->>'amount')::numeric));
  if length(newl->>'school_name_snapshot')>300 or length(newl->>'service_description_snapshot')>2000 then raise exception 'invalid_revision_details';end if;
  for k,v in select * from jsonb_each(newl) where key<>'id' loop
   oldv:=case when k='quantity_snapshot' then to_jsonb(coalesce((oldline->>'quantity_snapshot')::numeric,jsonb_array_length(oldline->'finance_transaction_account_meetings'))) when k in ('school_name_snapshot','service_description_snapshot') then to_jsonb(coalesce(oldline->>k,case when k='service_description_snapshot' then oldline->>'activity_name_snapshot' else '' end)) else oldline->k end;
   if k='billed_hours' and abs((v#>>'{}')::numeric-(oldv#>>'{}')::numeric)<=0.000000001 then v:=oldv;newl:=newl||jsonb_build_object(k,oldv);end if;
   if v is distinct from oldv then
    diff:=diff||jsonb_build_array(jsonb_build_object('line',item->>'id','field',k,'before',oldv,'after',v));
    if k in ('activity_price_snapshot','quantity_snapshot','billed_hours','amount') then financial:=true;end if;
   end if;
  end loop;
  items:=items||jsonb_build_array(newl);
 end loop;
 if diff='[]' then raise exception 'invoice_revision_no_changes';end if;
 name:=finance_private.invoice_actor_name(auth.uid());
 insert into finance_private.invoice_versions(account_id,version,snapshot,actor_id,actor_name,created_at) values(p_account_id,(snap->>'document_revision')::int,snap,(snap->>'created_by')::uuid,finance_private.invoice_actor_name((snap->>'created_by')::uuid),coalesce((snap->>'finalized_at')::timestamptz,now())) on conflict do nothing;
 insert into finance_private.invoice_revisions(account_id,request_key,base_hash,source_hash,before_snapshot,proposed,changes,financial,status,requested_by,requested_name)
 values(p_account_id,p_key,p_base_hash,finance_private.invoice_source_hash(p_account_id),snap,normalized||jsonb_build_object('lines',items),diff,financial,case when financial then 'pending_admin' else 'approved' end,auth.uid(),coalesce(name,auth.uid()::text)) returning * into r;
 insert into public.finance_audit_events(event_type,account_id,details) values('invoice_revision_requested',p_account_id,jsonb_build_object('revision_id',r.id,'financial',financial,'changes',diff,'actor',auth.uid(),'actor_name',name));
 if p_admin_approve and financial then
  perform public.finance_decide_invoice_revision(r.id,true,'אישור מפורש בעת העריכה');
  select * into r from finance_private.invoice_revisions where id=r.id;
 end if;
 return to_jsonb(r)-'dispatch_token';
end $$;

create function finance_private.revision_quote(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare r finance_private.invoice_revisions;snap jsonb;oldl jsonb;item jsonb;l jsonb;lines jsonb:='[]';source jsonb;activity public.activities;
 selected jsonb;price numeric;factor numeric;qty integer;hours numeric;amount numeric;cap numeric;total numeric:=0;changes jsonb:='[]';q jsonb;
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
   if price is distinct from activity.price then
    if nullif(to_jsonb(activity)->>'proposal_item_id','') is not null
      or (select count(*) from finance_private.resolved_funding_rows(activity))<>1
      or (source->>'fundingAmount')::numeric<>activity.price
      or not exists(select 1 from public.activity_funding_sources af where af.activity_id=activity.id and af.funding_source_id=(oldl->>'funding_source_id')::uuid and af.amount=activity.price)
      or exists(select 1 from public.finance_transaction_account_lines other join public.finance_transaction_accounts a on a.id=other.account_id where other.activity_row_id=activity.row_id and a.id<>r.account_id and a.document_status<>'cancelled')
    then raise exception 'revision_contract_change_requires_finance_review';end if;
    changes:=changes||jsonb_build_array(jsonb_build_object('activity_id',activity.id,'old_price',activity.price,'new_price',price,'funder',oldl->>'funding_source_id'));
   end if;
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
 q:=snap||(r.proposed-'lines')||jsonb_build_object('transaction_account_number',case when r.financial then 'טיוטה חלופית' else snap->>'transaction_account_number' end,
  'total_amount',total,'finance_transaction_account_lines',lines,'revision_price_changes',changes,'revision_request_id',r.id,'revision_financial',r.financial);
 if r.financial then
  q:=q||jsonb_build_object('issue_date',case when r.proposed->>'issue_date' is distinct from r.before_snapshot->>'issue_date' then (r.proposed->>'issue_date')::date else (now() at time zone 'Asia/Jerusalem')::date end);
  q:=q||jsonb_build_object('payment_due_date',case when r.proposed->>'payment_due_date' is distinct from r.before_snapshot->>'payment_due_date' then (r.proposed->>'payment_due_date')::date else (date_trunc('month',(q->>'issue_date')::date)+interval '1 month - 1 day')::date+finance_private.payment_days(lines->0->>'funding_snapshot') end);
  if (q->>'payment_due_date')::date<(q->>'issue_date')::date then raise exception 'invalid_revision_details';end if;
 end if;
 return q||jsonb_build_object('revision',finance_private.invoice_hash(q));
end $$;

create function public.finance_decide_invoice_revision(p_id uuid,p_approve boolean,p_reason text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare r finance_private.invoice_revisions;
begin
 if not coalesce(public.finance_transaction_can_issue(),false) or public.app_current_role() is distinct from 'admin' then raise exception 'admin_required' using errcode='42501';end if;
 select * into r from finance_private.invoice_revisions where id=p_id for update;
 if not found or r.status<>'pending_admin' then raise exception 'revision_not_pending';end if;
 update finance_private.invoice_revisions set status=case when p_approve then 'approved' else 'rejected' end,decided_by=auth.uid(),decided_name=finance_private.invoice_actor_name(auth.uid()),decided_at=now(),decision_reason=left(p_reason,1000) where id=p_id returning * into r;
 if p_approve and r.financial then
  begin
   perform finance_private.assert_financial_correction(r.account_id);
  exception when raise_exception then
   if SQLERRM like 'finance_decision_required%' then
    update finance_private.invoice_revisions set status='finance_review_required' where id=p_id returning * into r;
   else raise;end if;
  end;
 end if;
 if p_approve and r.status='approved' then perform finance_private.revision_quote(r.id);end if;
 -- Approval is explicit even for the requesting administrator. A later
 -- financial/collection conflict is checked again at preview and commit.
 insert into public.finance_audit_events(event_type,account_id,details) values(case when p_approve then 'invoice_revision_approved' else 'invoice_revision_rejected' end,r.account_id,jsonb_build_object('revision_id',r.id,'actor',auth.uid(),'actor_name',finance_private.invoice_actor_name(auth.uid()),'reason',p_reason));
 return to_jsonb(r)-'dispatch_token';
end $$;
create function public.finance_invoice_revision_quote(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare aid uuid;state text;result_id uuid;
begin
 select account_id,status,result_account_id into aid,state,result_id from finance_private.invoice_revisions where id=p_id;
 if state='applied' then
  if not coalesce(public.finance_transaction_can_issue(),false) then raise exception 'finance_transactions_permission_denied' using errcode='42501';end if;
  return jsonb_build_object('applied',true,'accountId',result_id);
 end if;
 perform finance_private.assert_revision_access(aid);
 return finance_private.revision_quote(p_id)||jsonb_build_object('revision_actor',auth.uid());
end $$;

-- The existing immutable-snapshot trigger admits only this bounded backend
-- transaction, never a browser GUC or a direct service-role table mutation.
create function finance_private.revision_write_allowed(p_id uuid) returns boolean language sql stable set search_path='' as $$
 select current_user='postgres' and coalesce(auth.role(),'')='service_role' and exists(
  select 1 from finance_private.invoice_revisions r join finance_private.dispatch_leases d on d.account_id=r.account_id and d.token=r.dispatch_token
  where r.id::text=current_setting('finance.invoice_revision_id',true) and r.status='rendering' and d.expires_at>now()
    and (r.account_id=p_id or r.replacement_account_id=p_id));
$$;
create or replace function finance_private.guard_document_snapshot() returns trigger language plpgsql set search_path='' as $$
declare aid uuid;status text;
begin
 if TG_TABLE_NAME='finance_transaction_account_lines' then aid:=OLD.account_id;else select account_id into aid from public.finance_transaction_account_lines where id=OLD.account_line_id;end if;
 select document_status into status from public.finance_transaction_accounts where id=aid;
 if status<>'generating' and not finance_private.revision_write_allowed(aid) then raise exception 'issued_snapshot_is_immutable';end if;
 if TG_OP='DELETE' then return OLD;end if;return NEW;
end $$;
create function finance_private.guard_invoice_revision_header() returns trigger language plpgsql set search_path='' as $$
begin
 if (OLD.document_revision is distinct from NEW.document_revision or OLD.replaces_account_id is distinct from NEW.replaces_account_id or OLD.replaced_by_account_id is distinct from NEW.replaced_by_account_id
  or (OLD.document_status<>'generating' and (OLD.customer_name_snapshot is distinct from NEW.customer_name_snapshot or OLD.customer_email_snapshot is distinct from NEW.customer_email_snapshot or OLD.issue_date is distinct from NEW.issue_date or OLD.payment_due_date is distinct from NEW.payment_due_date
    or OLD.total_amount is distinct from NEW.total_amount or OLD.pdf_sha256 is distinct from NEW.pdf_sha256 or OLD.sharepoint_item_id is distinct from NEW.sharepoint_item_id)))
  and not finance_private.revision_write_allowed(OLD.id) then raise exception 'issued_snapshot_is_immutable';end if;
 return NEW;
end $$;
create trigger finance_invoice_revision_header_guard before update on public.finance_transaction_accounts for each row execute function finance_private.guard_invoice_revision_header();

create or replace function finance_private.capture_outlook_owner() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='INSERT' then
    if coalesce(auth.role(),'')='service_role' and exists(select 1 from finance_private.invoice_revisions r where r.replacement_account_id=NEW.id and r.status='rendering') then
      select a.outlook_owner_id,a.outlook_owner_mailbox into NEW.outlook_owner_id,NEW.outlook_owner_mailbox from finance_private.invoice_revisions r join public.finance_transaction_accounts a on a.id=r.account_id where r.replacement_account_id=NEW.id and r.status='rendering';
    else
      NEW.outlook_owner_id:=auth.uid();
      NEW.outlook_owner_mailbox:=finance_private.issuer_outlook_mailbox(auth.uid());
    end if;
  else
    if NEW.outlook_owner_id is distinct from OLD.outlook_owner_id then
      raise exception 'invoice_mailbox_owner_immutable';
    end if;
    if NEW.outlook_owner_mailbox is distinct from OLD.outlook_owner_mailbox then
      -- A missing address may be repaired for the SAME original issuer, by the
      -- lease-owning resolver after an administrator corrects that user's record.
      if OLD.outlook_owner_mailbox is not null or coalesce(auth.role(),'')<>'service_role'
        or NEW.outlook_owner_mailbox is distinct from finance_private.issuer_outlook_mailbox(OLD.outlook_owner_id)
      then raise exception 'invoice_mailbox_owner_immutable'; end if;
    end if;
  end if;
  return NEW;
end $$;

create function public.begin_finance_invoice_revision(p_id uuid,p_token uuid,p_expected_revision text,p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
  q:=q||jsonb_build_object('id',target.id,'transaction_account_number',target.transaction_account_number);
 else target:=a;
 end if;
 return jsonb_build_object('quote',q||jsonb_build_object('revision_created_at',r.requested_at),'accountId',target.id,'originalAccountId',a.id,'financial',r.financial,
  'originalMailbox',a.outlook_owner_mailbox,'originalMessageId',a.outlook_message_id,'originalOwnerId',a.outlook_owner_id,
  'previousFiles',(select coalesce(jsonb_agg(jsonb_build_object('name',snapshot->>'generated_filename','hash',snapshot->>'pdf_sha256')),'[]') from finance_private.invoice_versions where account_id=a.id));
end $$;

create function public.finish_finance_invoice_revision(p_id uuid,p_token uuid,p_expected_revision text,p_filename text,p_hash text,p_drive text,p_folder text,p_item text,p_url text,p_mail_state text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r finance_private.invoice_revisions;q jsonb;l jsonb;m jsonb;change jsonb;a public.finance_transaction_accounts;target_id uuid;line_id uuid;cap numeric;cumulative numeric;prior numeric;actor uuid;
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
  for change in select value from jsonb_array_elements(q->'revision_price_changes') loop
   update public.activities set price=(change->>'new_price')::bigint where id=(change->>'activity_id')::bigint and price=(change->>'old_price')::numeric;
   if not found then raise exception 'invoice_revision_stale';end if;
   update public.activity_funding_sources set amount=(change->>'new_price')::numeric where activity_id=(change->>'activity_id')::bigint and funding_source_id=(change->>'funder')::uuid;
   if not found then raise exception 'revision_contract_change_requires_finance_review';end if;
  end loop;
  update public.finance_transaction_accounts set document_status='cancelled',cancelled_at=now(),cancelled_by=r.decided_by,
   outlook_status='needs_review',outlook_error='invoice_replaced_by_corrected_account',cancellation_reason='הוחלף בעקבות תיקון כספי מאושר '||r.id::text,replaced_by_account_id=target_id where id=a.id;
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
  update public.finance_transaction_accounts set payment_due_date=(q->>'payment_due_date')::date where id=target_id;
  perform public.acquire_finance_dispatch(target_id,p_token);
  perform public.finalize_finance_billing(target_id,p_token,p_filename,p_hash,p_drive,p_folder,p_item,p_url);
  perform public.release_finance_dispatch(target_id,p_token);
 else
  target_id:=a.id;
  update public.finance_transaction_accounts set customer_name_snapshot=q->>'customer_name_snapshot',customer_email_snapshot=q->>'customer_email_snapshot',issue_date=(q->>'issue_date')::date,payment_due_date=(q->>'payment_due_date')::date,
   expected_collection_date=case when expected_collection_date=payment_due_date then (q->>'payment_due_date')::date else expected_collection_date end,document_revision=document_revision+1,generated_filename=p_filename,pdf_sha256=p_hash,sharepoint_drive_id=p_drive,sharepoint_folder_item_id=p_folder,sharepoint_item_id=p_item,sharepoint_web_url=p_url where id=target_id;
  for l in select value from jsonb_array_elements(q->'finance_transaction_account_lines') loop
   update public.finance_transaction_account_lines set school_name_snapshot=l->>'school_name_snapshot',service_description_snapshot=l->>'service_description_snapshot' where id=(l->>'id')::uuid and account_id=target_id;
  end loop;
 end if;
 -- Reconnection uses the original issuer's existing delegated resume path.
 update public.finance_transaction_accounts set outlook_status=case when p_mail_state='sent' or document_status='sent' or outlook_status='already_sent' then 'already_sent' else 'waiting_connection' end,
  outlook_error=case when p_mail_state='sent' or document_status='sent' or outlook_status='already_sent' then 'document_corrected_requires_send_decision' else 'invoice_revision_draft_update_pending' end where id=target_id;
 insert into finance_private.outlook_jobs(account_id)
  select id from public.finance_transaction_accounts where id=target_id and outlook_status<>'already_sent'
  on conflict(account_id) do update set state='pending',attempts=0,next_retry_at=now(),last_error='invoice_revision_draft_update_pending';
 if r.financial then update finance_private.outlook_jobs set state='blocked',last_error='invoice_replaced_by_corrected_account' where account_id=a.id;end if;
 insert into finance_private.invoice_versions(account_id,version,request_id,snapshot,actor_id,actor_name) select id,document_revision,r.id,finance_private.invoice_snapshot(id),r.applied_by,r.applied_name from public.finance_transaction_accounts where id=target_id;
 update finance_private.invoice_revisions set status='applied',applied_at=now(),result_account_id=target_id where id=r.id;
 insert into public.finance_audit_events(event_type,account_id,actor_id,details) values('invoice_revision_applied',target_id,r.applied_by,jsonb_build_object('revision_id',r.id,'original_account_id',a.id,'financial',r.financial,'approved_by',r.decided_by,'actor',r.applied_by,'actor_name',r.applied_name,'changes',r.changes));
 return jsonb_build_object('accountId',target_id,'originalAccountId',a.id,'applied',true,'financial',r.financial);
end $$;

revoke all on function finance_private.invoice_actor_name(uuid),finance_private.invoice_source_hash(uuid),finance_private.invoice_snapshot(uuid),finance_private.invoice_hash(jsonb),finance_private.assert_revision_access(uuid,boolean),finance_private.assert_financial_correction(uuid),finance_private.revision_quote(uuid),finance_private.revision_write_allowed(uuid),finance_private.guard_invoice_revision_header() from public,anon,authenticated,service_role;
revoke all on function public.finance_invoice_revision_context(uuid),public.finance_request_invoice_revision(uuid,uuid,text,jsonb,boolean),public.finance_decide_invoice_revision(uuid,boolean,text),public.finance_invoice_revision_quote(uuid) from public,anon;
grant execute on function public.finance_invoice_revision_context(uuid),public.finance_request_invoice_revision(uuid,uuid,text,jsonb,boolean),public.finance_decide_invoice_revision(uuid,boolean,text),public.finance_invoice_revision_quote(uuid) to authenticated;
revoke all on function public.begin_finance_invoice_revision(uuid,uuid,text,uuid),public.finish_finance_invoice_revision(uuid,uuid,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.begin_finance_invoice_revision(uuid,uuid,text,uuid),public.finish_finance_invoice_revision(uuid,uuid,text,text,text,text,text,text,text,text) to service_role;

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
  with activity as (
    select distinct a.* from public.activities a
    join public.finance_transaction_account_lines l on l.activity_row_id=a.row_id where l.account_id=p_account_id
  ), contacts as (
    select distinct c.* from public.contacts_schools c where
      lower(btrim(coalesce(c.active,''))) not in ('לא פעיל','inactive','false','0','no') and (
      (account.payer_key_snapshot like 'school:%' and exists(select 1 from activity a where c.school_id=a.school_id
        or (c.school_id is null and c.id=a.school_contact_id)))
      or (account.payer_key_snapshot like 'authority:%' and c.client_type='authority'
        and c.authority_id=account.authority_id_snapshot)
      or (account.payer_key_snapshot like 'funding:%' and c.client_type='other'
        and btrim(c.client_name)=(select name from public.funding_sources where id=account.funding_source_id_snapshot))
    )
  ), raw_addresses as (
    select c.id contact_id,c.email value from contacts c
    union all select e.contact_id,e.email from public.contact_emails e join contacts c on c.id=e.contact_id where e.active
    union all select r.contact_id,r.recipient_email from public.finance_school_invoice_recipients r
      where account.payer_key_snapshot like 'school:%' and exists(select 1 from activity a where a.school_id=r.school_id)
        and (r.contact_id is null or exists(select 1 from contacts c where c.id=r.contact_id))
    -- Explicitly edited payer emails remain an additional source for sponsor invoices.
    -- School snapshots are deliberately not used: they can contain stale contact emails.
    union all select null::bigint,account.customer_email_snapshot where account.payer_key_snapshot not like 'school:%' and account.manual_draft is not null
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
create function public.finance_invoice_pdf_versions(p_account_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('name',snapshot->>'generated_filename','hash',snapshot->>'pdf_sha256')),'[]') from finance_private.invoice_versions where account_id=p_account_id or account_id=(select replaces_account_id from public.finance_transaction_accounts where id=p_account_id));
end $$;
revoke all on function public.finance_invoice_pdf_versions(uuid) from public,anon,authenticated;
grant execute on function public.finance_invoice_pdf_versions(uuid) to service_role;

create function public.finance_withdraw_invoice_revision(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r finance_private.invoice_revisions;
begin
 if not coalesce(public.finance_transaction_can_issue(),false) then raise exception 'finance_transactions_permission_denied' using errcode='42501';end if;
 select * into r from finance_private.invoice_revisions where id=p_id for update;
 if r.requested_by is distinct from auth.uid() and public.app_current_role() is distinct from 'admin' then raise exception 'revision_owner_required' using errcode='42501';end if;
 if r.status not in ('pending_admin','approved','rendering','finance_review_required') or exists(select 1 from finance_private.dispatch_leases where account_id=r.account_id and expires_at>now()) then raise exception 'revision_in_progress';end if;
 update finance_private.invoice_revisions set status='rejected',decision_reason=coalesce(decision_reason,'')||' · בוטל לבקשת המשתמש' where id=p_id;
 if r.replacement_account_id is not null then update public.finance_transaction_accounts set document_status='cancelled',cancellation_reason='בקשת תיקון בוטלה' where id=r.replacement_account_id and document_status='generating' and not exists(select 1 from public.finance_transaction_account_lines where account_id=r.replacement_account_id);end if;
 insert into public.finance_audit_events(event_type,account_id,details) values('invoice_revision_withdrawn',r.account_id,jsonb_build_object('revision_id',r.id,'actor',auth.uid(),'actor_name',finance_private.invoice_actor_name(auth.uid())));
end $$;
revoke all on function public.finance_withdraw_invoice_revision(uuid) from public,anon;
grant execute on function public.finance_withdraw_invoice_revision(uuid) to authenticated;

create function public.finance_revision_require_review(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare r finance_private.invoice_revisions;
begin
 if not coalesce(public.finance_transaction_can_issue(),false) then raise exception 'finance_transactions_permission_denied' using errcode='42501';end if;
 select * into r from finance_private.invoice_revisions where id=p_id for update;
 if not r.financial or r.status not in ('approved','rendering') then return false;end if;
 begin
  perform finance_private.assert_financial_correction(r.account_id);return false;
 exception when raise_exception then
  if SQLERRM not like 'finance_decision_required%' then raise;end if;
 end;
 update finance_private.invoice_revisions set status='finance_review_required' where id=p_id;
 return true;
end $$;
create function public.mark_finance_revision_sent(p_id uuid,p_token uuid) returns void language plpgsql security definer set search_path='' as $$
declare r finance_private.invoice_revisions;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'backend_only' using errcode='42501';end if;
 select * into r from finance_private.invoice_revisions where id=p_id for update;
 if not r.financial or r.status<>'rendering' or r.dispatch_token is distinct from p_token or not exists(select 1 from finance_private.dispatch_leases where account_id=r.account_id and token=p_token and expires_at>now()) then raise exception 'dispatch_lease_expired';end if;
 update finance_private.invoice_revisions set status='finance_review_required' where id=p_id;
 update public.finance_transaction_accounts set outlook_status='already_sent',outlook_error='finance_decision_required' where id=r.account_id;
end $$;
revoke all on function public.finance_revision_require_review(uuid) from public,anon;
grant execute on function public.finance_revision_require_review(uuid) to authenticated;
revoke all on function public.mark_finance_revision_sent(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mark_finance_revision_sent(uuid,uuid) to service_role;

create function finance_private.guard_invoice_versions() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'invoice_versions_are_immutable';end $$;
create trigger invoice_versions_immutable before update or delete on finance_private.invoice_versions for each row execute function finance_private.guard_invoice_versions();
revoke all on function finance_private.guard_invoice_versions() from public,anon,authenticated,service_role;
