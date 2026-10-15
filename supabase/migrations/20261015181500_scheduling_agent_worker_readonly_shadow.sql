-- Bounded read-only shadow access for GitHub-OIDC canary while writes are disabled.
-- This does not allow claims, leases, persistence, or any scheduling mutations.
DO $migration$
DECLARE
  v_fn regprocedure := 'public.scheduling_agent_worker_command(text,jsonb)'::regprocedure;
  src text;
  needle text := '  if v_worker_enabled is distinct from true then';
  patch text := $patch$
  if v_worker_enabled is distinct from true then
    -- worker_shadow_readonly: machine-authenticated source parity testing only.
    if p_action='preflight' then
      return public.get_scheduling_planning_preflight('year','');
    end if;
    if p_action='locations' then
      select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into v_result
      from public.scheduling_authority_school_locations() s;
      return v_result;
    end if;
    if p_action='blockers' then
      return coalesce(public.get_scheduling_planning_external_blockers(),'[]'::jsonb);
    end if;
$patch$;
BEGIN
  src:=pg_get_functiondef(v_fn);
  if position('worker_shadow_readonly' in src)>0 then return; end if;
  if (length(src)-length(replace(src,needle,'')))/length(needle)<>1 then
    raise exception 'unexpected_worker_cutover_gate_source';
  end if;
  EXECUTE replace(src,needle,patch);
END
$migration$;
