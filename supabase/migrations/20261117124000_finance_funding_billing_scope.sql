-- Preserve original funding allocations; record external settlement and approved performance scope separately.
create table finance_private.activity_funding_billing_scope (
  activity_id bigint not null,
  funding_source_id uuid not null,
  mode text not null check(mode in ('external_paid','gefen_performance_limit')),
  amount numeric(14,2) not null check(amount>0),
  meeting_count integer,
  confirmation_note text not null check(length(btrim(confirmation_note))>0),
  confirmed_at timestamptz not null default now(),
  primary key(activity_id,funding_source_id),
  foreign key(activity_id,funding_source_id) references public.activity_funding_sources(activity_id,funding_source_id) on delete restrict,
  check((mode='external_paid' and meeting_count is null) or (mode='gefen_performance_limit' and meeting_count between 1 and 35))
);
alter table finance_private.activity_funding_billing_scope enable row level security;
revoke all on finance_private.activity_funding_billing_scope from public, anon, authenticated;
do $migration$
declare d text := pg_get_functiondef('finance_private.billing_rows(public.activities,uuid,timestamp with time zone)'::regprocedure);
begin
  if strpos(d,$old0$  f record; period date;$old0$)=0 then raise exception 'billing scope migration anchor 0 missing'; end if;
  d:=replace(d,$old0$  f record; period date;$old0$,$new0$  billing_scope finance_private.activity_funding_billing_scope%rowtype;
  scope_valid boolean;
  f record; period date;$new0$);
  if strpos(d,$old1$    school_funding := monthly or finance_private.is_school_direct_funding(f.name);$old1$)=0 then raise exception 'billing scope migration anchor 1 missing'; end if;
  d:=replace(d,$old1$    school_funding := monthly or finance_private.is_school_direct_funding(f.name);$old1$,$new1$    -- Explicit scope is per allocation, never per school or program.
    select * into billing_scope from finance_private.activity_funding_billing_scope s
      where s.activity_id=p_activity.id and s.funding_source_id=f.funding_source_id;
    scope_valid := coalesce(billing_scope.amount=f.amount and
      ((billing_scope.mode='external_paid' and not monthly) or
       (billing_scope.mode='gefen_performance_limit' and monthly and lower(btrim(coalesce(p_activity.activity_type,'')))='course'
        and billing_scope.meeting_count<=planned
        and (approved.hourly_rate is null or abs(approved.hourly_rate-billing_scope.amount/(billing_scope.meeting_count*1.5))<0.00000001))),false);
    if scope_valid and billing_scope.mode='external_paid' then continue; end if;
    if scope_valid and billing_scope.mode='gefen_performance_limit' then
      explicit_gefen_rate := billing_scope.amount/(billing_scope.meeting_count*1.5);
    end if;
    school_funding := monthly or finance_private.is_school_direct_funding(f.name);$new1$);
  if strpos(d,$old2$    source_reason := reason;$old2$)=0 then raise exception 'billing scope migration anchor 2 missing'; end if;
  d:=replace(d,$old2$    source_reason := reason;$old2$,$new2$    source_reason := reason;
    if billing_scope.activity_id is not null and not scope_valid then
      source_reason := 'הגדרת מימון חיצוני או היקף חיוב השתנתה — נדרשת בדיקת כספים';
    end if;$new2$);
  if strpos(d,$old3$else 1.5*remaining/nullif(coalesce(explicit_gefen_rate*1.5,gross_amount),0) end)$old3$)=0 then raise exception 'billing scope migration anchor 3 missing'; end if;
  d:=replace(d,$old3$else 1.5*remaining/nullif(coalesce(explicit_gefen_rate*1.5,gross_amount),0) end)$old3$,$new3$when scope_valid and billing_scope.mode='gefen_performance_limit' then 1.5*remaining/nullif(gross_amount,0) else 1.5*remaining/nullif(coalesce(explicit_gefen_rate*1.5,gross_amount),0) end)$new3$);
  if strpos(d,$old4$'fullFundingBlockedReason',case when source_reason not in$old4$)=0 then raise exception 'billing scope migration anchor 4 missing'; end if;
  d:=replace(d,$old4$'fullFundingBlockedReason',case when source_reason not in$old4$,$new4$'fullFundingBlockedReason',case when scope_valid and billing_scope.mode='gefen_performance_limit' then 'חיוב גפ״ן מוגבל למפגשים שבוצעו לפי היקף המימון המאושר' when source_reason not in$new4$);
  execute d;
end
$migration$;
