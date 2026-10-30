-- 2026-10-30: Unscheduled school_2027 proposals start no earlier than
-- FOURTEEN Israeli calendar days after calculation / server validation.
-- This is a targeted change to two existing v38-compatible functions.
-- No activity, draft, intended instructor, protected row or saved option is altered.
-- We retain the original validator's unchanged-proposal grandfathering.
do $guard$
declare
  v_preflight text;
  v_validation text;
  v_old text := '(clock_timestamp() at time zone ''Asia/Jerusalem'')::date + 7';
  v_new text := '(clock_timestamp() at time zone ''Asia/Jerusalem'')::date + 14';
begin
  select pg_get_functiondef('public.get_scheduling_planning_preflight(text,text)'::regprocedure)
    into v_preflight;
  select pg_get_functiondef('public.scheduling_v37_workspace_validation(uuid,jsonb)'::regprocedure)
    into v_validation;

  -- Refuse to override a future server body or an unexpected migration state.
  if v_preflight is null or v_validation is null
    or (length(v_preflight) - length(replace(v_preflight, v_old, ''))) / length(v_old) <> 1
    or (length(v_validation) - length(replace(v_validation, v_old, ''))) / length(v_old) <> 1
    or position('planning_server_undated_start_too_soon' in v_validation) = 0
    or position('r.needs_recalc' in v_preflight) = 0
  then
    raise exception 'scheduling_undated_lead_function_shape_changed';
  end if;

  execute replace(v_preflight, v_old, v_new);
  execute replace(v_validation, v_old, v_new);
end
$guard$;
