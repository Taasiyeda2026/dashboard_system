-- Staff survey opening: complete the pre-activation recovery added in
-- 20261014224000 (prepare) and 20261014235500 (claim).
--
-- Before this patch a legitimate pre-activation PRE outbox passed prepare/claim,
-- but the final check just before Microsoft Graph still rejected it.
-- Change the activation check ONLY for PRE; FINAL retains the cutoff.
-- Keep every other safeguard: enabled, 08:00 Israel, latest eligibility,
-- snapshot, selected contact + email, active campaign, pending recipient,
-- token, and Graph-started/no-double-send fence.
do $patch$
declare
  definition text;
  before_guard constant text := 'or c.eligibility_at<ctl.activation_at';
  after_guard constant text := 'or (c.eligibility_at<ctl.activation_at and o.stage<>''pre'')';
  matches integer;
begin
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='feedback_staff_auto_begin_send'
    and pg_get_function_arguments(p.oid) like 'p_id uuid, p_claim uuid, p_token text%';
  if definition is null then
    raise exception 'feedback_staff_begin_send_missing';
  end if;

  -- Do not patch a different version of the send gate blindly.
  if position(after_guard in definition)=0 then
    matches := (length(definition)-length(replace(definition,before_guard,'')))/length(before_guard);
    if matches<>1 then
      raise exception 'feedback_staff_begin_send_unexpected_activation_guard: %',matches;
    end if;
    if position('or c.status<>''eligible''' in definition)=0
       or position('private.feedback_staff_auto_snapshot(to_jsonb(c))<>o.snapshot' in definition)=0
       or position('o.graph_started_at is not null' in definition)=0
       or position('fc.status=''active''' in definition)=0
       or position('r.status=''pending''' in definition)=0 then
      raise exception 'feedback_staff_begin_send_safety_check_changed';
    end if;
    definition := replace(definition,before_guard,after_guard);
    execute definition;
  end if;

  -- The two earlier gates must already permit PRE retroactive recovery.
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='feedback_staff_auto_claim';
  if position('(c.eligibility_at<ctl.activation_at and o.stage<>''pre'')' in coalesce(definition,''))=0 then
    raise exception 'feedback_staff_claim_pre_backfill_guard_missing';
  end if;

  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='feedback_staff_auto_prepare';
  if position('eligibility_at>=ctl.activation_at or stage=''pre''' in coalesce(definition,''))=0 then
    raise exception 'feedback_staff_prepare_pre_backfill_guard_missing';
  end if;
end
$patch$;

-- No outbox status reset, no manual email send, no backdating activation,
-- no change to accepted/unknown/sending deliveries, no duplicate attempt.
