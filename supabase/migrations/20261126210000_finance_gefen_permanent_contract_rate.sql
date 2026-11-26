begin;

-- Prefer an authorized permanent contract rate over the documented approved
-- Gefen order rate when calculating future issuable amounts. Issued snapshots
-- stay untouched; the original order rate remains available for audit.
do $$
declare
  def text;
  old_rate text := $old$explicit_gefen_rate := case when monthly and lower(btrim(coalesce(p_activity.activity_type,'')))='course' then coalesce(approved.hourly_rate,p_activity.course_hourly_rate) end;$old$;
  new_rate text := $new$explicit_gefen_rate := case when monthly and lower(btrim(coalesce(p_activity.activity_type,'')))='course' then case when p_activity.course_hourly_rate_source='finance_contract' and p_activity.course_hourly_rate is not null then p_activity.course_hourly_rate else coalesce(approved.hourly_rate,p_activity.course_hourly_rate) end end;$new$;
  old_order text := $old$if source_reason='' and explicit_gefen_rate is not null and order_matched and matched_order_rate is distinct from explicit_gefen_rate then
      source_reason := 'תעריף שעתי שונה מהזמנת גפ״ן מאומתת — נדרש בירור';
    end if;$old$;
  new_order text := $new$if source_reason='' and explicit_gefen_rate is not null and order_matched and matched_order_rate is distinct from explicit_gefen_rate
      and coalesce(p_activity.course_hourly_rate_source,'') is distinct from 'finance_contract' then
      source_reason := 'תעריף שעתי שונה מהזמנת גפ״ן מאומתת — נדרש בירור';
    end if;$new$;
  old_prior text := 'and l.billing_override_snapshot is null and l.hourly_rate_snapshot is distinct from explicit_gefen_rate';
  new_prior text := 'and coalesce(p_activity.course_hourly_rate_source,'''') is distinct from ''finance_contract'' and l.billing_override_snapshot is null and l.hourly_rate_snapshot is distinct from explicit_gefen_rate';
begin
  def := pg_get_functiondef('finance_private.billing_rows(public.activities,uuid,timestamp with time zone)'::regprocedure);
  if position(old_rate in def)=0 or position(old_order in def)=0 or position(old_prior in def)=0 then
    raise exception 'unexpected_billing_rows_definition_for_contract_rate';
  end if;
  def := replace(def, old_rate, new_rate);
  def := replace(def, old_order, new_order);
  def := replace(def, old_prior, new_prior);
  execute def;
end $$;

-- Allow authorized finance users to persist a permanent hourly rate even when
-- an approved Gefen order rate exists. Prior issued accounts keep their
-- snapshots; the new contract rate applies to current/future eligibility.
CREATE OR REPLACE FUNCTION public.finance_complete_billing_data(p_activity_id text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.activities%rowtype;
  school_row public.schools%rowtype;
  price_value bigint;
  rate_value numeric;
  verified_rate numeric;
  n int;
  funding_total numeric;
  funding_text text;
  fund_count int;
  known_count int;
  has_gefen boolean;
  has_prior boolean;
  school_symbol bigint;
  program_code text;
  email text;
  before_funding jsonb;
  after_funding jsonb;
  before_rate numeric;
  actor_name text;
begin
  if auth.uid() is null or not coalesce(public.app_current_role()='admin' or public.app_has_permission('manage_finance_transactions'),false)
    then raise exception 'finance_permission_denied' using errcode='42501'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_data->'allocations') is distinct from 'array' then raise exception 'invalid_completion_payload'; end if;
  select * into a from public.activities where row_id=p_activity_id and activity_season='school_2027' for update;
  if not found then raise exception 'activity_not_found'; end if;
  if a.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'הפעילות השתנתה — יש לרענן ולנסות שוב'; end if;
  if exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=a.row_id and h.document_status='generating') then raise exception 'הפקה בתהליך — אין לשנות נתונים'; end if;
  select exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=a.row_id and h.document_status<>'cancelled') into has_prior;
  if (p_data->>'price') !~ '^[0-9]+$' or coalesce((p_data->>'price')::numeric,0)<=0 or (p_data->>'price')::numeric>1000000000 then raise exception 'יש להזין מחיר כולל חיובי בשקלים שלמים'; end if;
  price_value := (p_data->>'price')::bigint;
  before_rate := a.course_hourly_rate;
  if a.activity_type='course' then
    if coalesce(p_data->>'sessions','') !~ '^[1-9][0-9]?$' then raise exception 'יש להזין מספר מפגשים תקין'; end if;
    n := (p_data->>'sessions')::int;
    rate_value := nullif(p_data->>'rate','')::numeric;
    if n not between 1 and 35 or (rate_value is not null and (rate_value<=0 or rate_value>1000000)) then raise exception 'מספר מפגשים או תעריף אינם תקינים'; end if;
  end if;
  select count(*),count(distinct (j->>'id')::uuid),sum((j->>'amount')::numeric) into fund_count,known_count,funding_total from jsonb_array_elements(p_data->'allocations') j;
  if fund_count=0 or fund_count<>known_count or funding_total is distinct from price_value::numeric or exists(select 1 from jsonb_array_elements(p_data->'allocations') j where j->>'id' is null or j->>'amount' is null or (j->>'amount')::numeric<=0 or (j->>'amount')::numeric<>round((j->>'amount')::numeric,2)) then raise exception 'חלוקת המימון חייבת לכלול מממנים מזוהים ולהסתכם במחיר הכולל'; end if;
  select count(*),string_agg(f.name,' + ' order by f.name),coalesce(bool_or(public.finance_is_gefen_funding(f.name)),false)
  into known_count,funding_text,has_gefen from jsonb_array_elements(p_data->'allocations') j join public.funding_sources f on f.id=(j->>'id')::uuid where f.is_active or exists(select 1 from public.activity_funding_sources af where af.activity_id=a.id and af.funding_source_id=f.id);
  if known_count<>fund_count then raise exception 'גורם מימון אינו תקין'; end if;
  if a.activity_type='course' and has_gefen then
    select r.hourly_rate into verified_rate from finance_private.gefen_approved_order_rates r where r.activity_row_id=a.row_id and r.activity_school_id=a.school_id and r.activity_no=a.activity_no;
    rate_value := coalesce(rate_value, a.course_hourly_rate, verified_rate);
    if rate_value is null then raise exception 'יש להשלים מחיר שעתי לגפ״ן'; end if;
  elsif a.activity_type='course' then
    rate_value := coalesce(rate_value, a.course_hourly_rate);
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(f.funding_source_id,f.amount) order by f.funding_source_id),'[]') into before_funding from finance_private.resolved_funding_rows(a) f;
  select coalesce(jsonb_agg(jsonb_build_array((j->>'id')::uuid,(j->>'amount')::numeric) order by (j->>'id')::uuid),'[]') into after_funding from jsonb_array_elements(p_data->'allocations') j;
  if has_prior and (a.price is distinct from price_value or before_funding is distinct from after_funding or (a.activity_type='course' and a.sessions is distinct from n::text)) then raise exception 'לא ניתן לשנות מחיר, חלוקת מימון או מספר מפגשים לאחר שהופק חשבון — נדרשת בדיקת כספים'; end if;
  -- Prior Gefen invoices keep their hourly_rate_snapshot. An authorized
  -- finance_contract update may diverge so future accounts use the new rate.
  school_symbol:=nullif(p_data->>'school_symbol','')::bigint;
  if a.school_id is null and school_symbol is not null then
    select * into school_row from public.schools where semel_mosad=school_symbol;
    if not found or (select count(*) from public.schools where semel_mosad=school_symbol)<>1 then raise exception 'סמל המוסד לא נמצא או אינו חד משמעי'; end if;
    if has_prior then raise exception 'לא ניתן לשנות מוסד לאחר הפקת חשבון'; end if;
  end if;
  program_code:=nullif(btrim(p_data->>'program_code'),'');
  if has_gefen and coalesce(case when coalesce(a.activity_no,'') ~ '^[0-9]+$' then a.activity_no else program_code end,'') !~ '^[0-9]+$' then raise exception 'יש להשלים מספר תוכנית גפ״ן תקין'; end if;
  if has_prior and coalesce(a.activity_no,'') !~ '^[0-9]+$' and program_code is not null then raise exception 'לא ניתן לשנות מספר תוכנית לאחר הפקת חשבון'; end if;
  email:=nullif(btrim(p_data->>'contact_email'),'');
  if a.activity_type='course' then
    if (select count(*) from generate_series(1,35) s where nullif(to_jsonb(a)->>('date_'||s),'') is not null)>n then raise exception 'מספר המפגשים קטן ממספר המועדים הקיימים'; end if;
    if exists(select 1 from generate_series(n+1,35) s where nullif(p_data->'dates'->>('date_'||s),'') is not null) then raise exception 'אין להזין מועדים מעבר למספר המפגשים'; end if;
  end if;
  perform set_config('finance.billing_completion','on',true);
  update public.activities set price=price_value,
    sessions=case when a.activity_type='course' then n::text else a.sessions end,
    course_hourly_rate=case when a.activity_type='course' then rate_value else null end,
    course_hourly_rate_source=case when a.activity_type='course' and rate_value is not null then 'finance_contract' else null end,
    funding=case when has_prior then a.funding else funding_text end,is_gefen_funded=case when has_prior then a.is_gefen_funded else has_gefen end,
    school_id=coalesce(a.school_id,school_row.id),
    school=case when a.school_id is null and school_row.id is not null then school_row.school_name else a.school end,
    authority_id=coalesce(a.authority_id,school_row.authority_id),
    authority=case when a.authority_id is null and school_row.authority_id is not null then (select au.authority_name from public.authorities au where au.id=school_row.authority_id) else a.authority end,
    activity_no=case when has_gefen and coalesce(a.activity_no,'') !~ '^[0-9]+$' then program_code else coalesce(nullif(btrim(a.activity_no),''),program_code) end,
    gefen_number=case when has_gefen then coalesce(nullif(btrim(a.gefen_number),''),program_code,a.activity_no) else a.gefen_number end,
    start_time=coalesce(a.start_time,nullif(p_data->>'start_time','')::time),
    end_time=coalesce(a.end_time,nullif(p_data->>'end_time','')::time),
    contact_email=coalesce(nullif(btrim(a.contact_email),''),email),
    date_1=coalesce(a.date_1,nullif(p_data->'dates'->>'date_1','')::date),
    date_2=coalesce(a.date_2,nullif(p_data->'dates'->>'date_2','')::date),
    date_3=coalesce(a.date_3,nullif(p_data->'dates'->>'date_3','')::date),
    date_4=coalesce(a.date_4,nullif(p_data->'dates'->>'date_4','')::date),
    date_5=coalesce(a.date_5,nullif(p_data->'dates'->>'date_5','')::date),
    date_6=coalesce(a.date_6,nullif(p_data->'dates'->>'date_6','')::date),
    date_7=coalesce(a.date_7,nullif(p_data->'dates'->>'date_7','')::date),
    date_8=coalesce(a.date_8,nullif(p_data->'dates'->>'date_8','')::date),
    date_9=coalesce(a.date_9,nullif(p_data->'dates'->>'date_9','')::date),
    date_10=coalesce(a.date_10,nullif(p_data->'dates'->>'date_10','')::date),
    date_11=coalesce(a.date_11,nullif(p_data->'dates'->>'date_11','')::date),
    date_12=coalesce(a.date_12,nullif(p_data->'dates'->>'date_12','')::date),
    date_13=coalesce(a.date_13,nullif(p_data->'dates'->>'date_13','')::date),
    date_14=coalesce(a.date_14,nullif(p_data->'dates'->>'date_14','')::date),
    date_15=coalesce(a.date_15,nullif(p_data->'dates'->>'date_15','')::date),
    date_16=coalesce(a.date_16,nullif(p_data->'dates'->>'date_16','')::date),
    date_17=coalesce(a.date_17,nullif(p_data->'dates'->>'date_17','')::date),
    date_18=coalesce(a.date_18,nullif(p_data->'dates'->>'date_18','')::date),
    date_19=coalesce(a.date_19,nullif(p_data->'dates'->>'date_19','')::date),
    date_20=coalesce(a.date_20,nullif(p_data->'dates'->>'date_20','')::date),
    date_21=coalesce(a.date_21,nullif(p_data->'dates'->>'date_21','')::date),
    date_22=coalesce(a.date_22,nullif(p_data->'dates'->>'date_22','')::date),
    date_23=coalesce(a.date_23,nullif(p_data->'dates'->>'date_23','')::date),
    date_24=coalesce(a.date_24,nullif(p_data->'dates'->>'date_24','')::date),
    date_25=coalesce(a.date_25,nullif(p_data->'dates'->>'date_25','')::date),
    date_26=coalesce(a.date_26,nullif(p_data->'dates'->>'date_26','')::date),
    date_27=coalesce(a.date_27,nullif(p_data->'dates'->>'date_27','')::date),
    date_28=coalesce(a.date_28,nullif(p_data->'dates'->>'date_28','')::date),
    date_29=coalesce(a.date_29,nullif(p_data->'dates'->>'date_29','')::date),
    date_30=coalesce(a.date_30,nullif(p_data->'dates'->>'date_30','')::date),
    date_31=coalesce(a.date_31,nullif(p_data->'dates'->>'date_31','')::date),
    date_32=coalesce(a.date_32,nullif(p_data->'dates'->>'date_32','')::date),
    date_33=coalesce(a.date_33,nullif(p_data->'dates'->>'date_33','')::date),
    date_34=coalesce(a.date_34,nullif(p_data->'dates'->>'date_34','')::date),
    date_35=coalesce(a.date_35,nullif(p_data->'dates'->>'date_35','')::date)
  where id=a.id;
  perform set_config('finance.billing_completion','off',true);
  if not has_prior then
    delete from public.activity_funding_sources where activity_id=a.id and funding_source_id not in (select (j->>'id')::uuid from jsonb_array_elements(p_data->'allocations') j);
    insert into public.activity_funding_sources(activity_id,funding_source_id,amount) select a.id,(j->>'id')::uuid,(j->>'amount')::numeric from jsonb_array_elements(p_data->'allocations') j
    on conflict (activity_id,funding_source_id) do update set amount=excluded.amount;
  end if;
  actor_name := finance_private.invoice_actor_name(auth.uid());
  insert into public.finance_audit_events(event_type,actor_id,details)
  values(
    'billing_completion_saved',
    auth.uid(),
    jsonb_build_object(
      'activity_row_id', a.row_id,
      'actor', auth.uid(),
      'actor_name', actor_name,
      'approved_order_rate', verified_rate,
      'before', jsonb_build_object(
        'price', a.price,
        'sessions', a.sessions,
        'rate', before_rate,
        'rate_source', a.course_hourly_rate_source,
        'funding', before_funding
      ),
      'after', jsonb_build_object(
        'price', price_value,
        'sessions', case when a.activity_type='course' then n::text else a.sessions end,
        'rate', rate_value,
        'rate_source', case when a.activity_type='course' and rate_value is not null then 'finance_contract' else null end,
        'funding', after_funding
      )
    )
  );
  return jsonb_build_object('ok',true,'row_id',a.row_id,'rate',rate_value,'approved_order_rate',verified_rate);
end;
$function$;

CREATE OR REPLACE FUNCTION public.finance_complete_billing_batch(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  item jsonb;
  results jsonb := '[]'::jsonb;
  seen text[] := '{}';
  activity_id text;
begin
  if auth.uid() is null or not coalesce(public.app_current_role()='admin' or public.app_has_permission('manage_finance_transactions'),false)
    then raise exception 'finance_permission_denied' using errcode='42501'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'invalid_completion_batch';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object' then raise exception 'invalid_completion_batch'; end if;
    activity_id := nullif(btrim(item->>'activity_id'),'');
    if activity_id is null or activity_id = any(seen) then raise exception 'invalid_completion_batch'; end if;
    seen := array_append(seen, activity_id);
    results := results || jsonb_build_array(public.finance_complete_billing_data(activity_id, item->'data'));
  end loop;
  return jsonb_build_object('ok', true, 'results', results);
end;
$function$;

CREATE OR REPLACE FUNCTION public.finance_billing_completion_context(p_activity_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.activities%rowtype;
  q public.proposal_agreement_items%rowtype;
  order_rate numeric;
  approved_rate numeric;
  fs jsonb;
  alloc jsonb;
  school_symbol bigint;
  prior boolean;
begin
  if auth.uid() is null or not coalesce(public.app_current_role()='admin' or public.app_has_permission('manage_finance_transactions'),false)
    then raise exception 'finance_permission_denied' using errcode='42501'; end if;
  select * into a from public.activities where row_id=p_activity_id and activity_season='school_2027';
  if not found then raise exception 'activity_not_found'; end if;
  select * into q from public.proposal_agreement_items where id=coalesce(a.proposal_item_id,a.israa_source_item_id);
  select r.hourly_rate into approved_rate from finance_private.gefen_approved_order_rates r where r.activity_row_id=a.row_id and r.activity_school_id=a.school_id and r.activity_no=a.activity_no;
  select coalesce(
    approved_rate,
    (select m.order_hourly_rate from finance_private.gefen_order_billing_matches m where m.activity_row_id=a.row_id limit 1)) into order_rate;
  select s.semel_mosad into school_symbol from public.schools s where s.id=a.school_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) order by f.sort_order nulls last,f.name),'[]') into fs from public.funding_sources f where f.is_active or exists(select 1 from public.activity_funding_sources af where af.activity_id=a.id and af.funding_source_id=f.id);
  select coalesce(jsonb_agg(jsonb_build_object('id',f.funding_source_id,'amount',f.amount,'name',f.name)) filter(where f.funding_source_id is not null),'[]') into alloc from finance_private.resolved_funding_rows(a) f;
  select exists(select 1 from public.finance_transaction_account_lines l join public.finance_transaction_accounts h on h.id=l.account_id where l.activity_row_id=a.row_id and h.document_status<>'cancelled') into prior;
  return jsonb_build_object(
    'row_id',a.row_id,
    'name',a.activity_name,
    'school',a.school,
    'authority',a.authority,
    'grade',a.grade,
    'class_group',a.class_group,
    'school_symbol',school_symbol,
    'activity_type',a.activity_type,
    'activity_no',a.activity_no,
    'gefen_number',a.gefen_number,
    'program_name',a.program_name,
    'catalog_slug',a.catalog_slug,
    'sessions',a.sessions,
    'price',a.price,
    'rate',a.course_hourly_rate,
    'rate_source',a.course_hourly_rate_source,
    'proposal_rate',q.hourly_price,
    'order_rate',order_rate,
    'approved_order_rate',approved_rate,
    'proposal_hours',q.hours_count,
    'funding',a.funding,
    'funding_options',fs,
    'allocations',alloc,
    'has_prior',prior,
    'updated_at',a.updated_at,
    'start_time',a.start_time,
    'end_time',a.end_time,
    'contact_email',a.contact_email,
    'dates',(select jsonb_object_agg('date_'||n,to_jsonb(a)->('date_'||n)) from generate_series(1,35) n)
  );
end;
$function$;

revoke all on function public.finance_complete_billing_batch(jsonb) from public,anon;
grant execute on function public.finance_complete_billing_batch(jsonb) to authenticated;
revoke all on function public.finance_complete_billing_data(text,jsonb), public.finance_billing_completion_context(text) from public,anon;
grant execute on function public.finance_complete_billing_data(text,jsonb), public.finance_billing_completion_context(text) to authenticated;

commit;
