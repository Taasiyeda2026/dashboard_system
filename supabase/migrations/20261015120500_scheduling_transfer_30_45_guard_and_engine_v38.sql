-- Adopt the owner-confirmed 30/45 km policy for transfers BETWEEN schools
-- on the same day. Home-to-school matching retains its separate 40/60 km policy.
-- Every transition must have a verified route, enough travel time and the safety buffer.
-- 0..30 km: ordinary assignment; (30..45] km: admin-approved manual draft only;
-- >45 km: non-overridable hard failure.
-- SQL guards intentionally require the exact verified v37 source fragment.

do $policy$
declare
  fn regprocedure;
  src text;
  replacement text;
  old_guard text := 'if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 20 then';
  forbidden_guard text := 'if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 45 then' || E'\n' ||
    '        if not (''scheduling_transition_distance_forbidden'' = any(violations)) then' || E'\n' ||
    '          violations := array_append(violations, ''scheduling_transition_distance_forbidden'');' || E'\n' ||
    '        end if;' || E'\n' ||
    '      end if;' || E'\n' ||
    '      if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 30 then';
begin
  -- Manual flow: >45 cannot be removed via the legacy exception-approval queue.
  fn := 'public.scheduling_manual_assignment_hard_violations(text,bigint)'::regprocedure;
  src := pg_get_functiondef(fn);
  if (length(src)-length(replace(src,old_guard,'')))/length(old_guard) <> 2
  then raise exception 'manual transition guard changed; abort migration'; end if;
  execute replace(src,old_guard,forbidden_guard);

  -- Direct/regular assignment: only <=30 permitted. 30-45 must use the
  -- existing approved-manual-draft flow; >45 remains impossible.
  fn := 'public.scheduling_course_instructor_violations(text,bigint,boolean,date[])'::regprocedure;
  src := pg_get_functiondef(fn);
  if (length(src)-length(replace(src,'required_km > 20','')))/length('required_km > 20') <> 2
  then raise exception 'course instructor transition guard changed; abort migration'; end if;
  execute replace(src,'required_km > 20','required_km > 30');

  -- The requested policy is between *same-day* activities; an unusually long
  -- gap does not permit a >45-km transfer as an ordinary assignment.
  create or replace function public.scheduling_transition_distance_cap_applies(p_gap_minutes integer)
  returns boolean language sql immutable set search_path=public as $fn$
    select p_gap_minutes is not null and p_gap_minutes >= 0;
  $fn$;

  -- Maintain the factual explanation shown in approval requests.
  fn := 'public.submit_course_assignment_manager_approval(text)'::regprocedure;
  src := pg_get_functiondef(fn);
  if position('מרחק.*20' in src)=0 or position('גדול מ־20 ק' in src)=0
  then raise exception 'manager submission template changed; abort migration'; end if;
  execute replace(replace(src,'מרחק.*20','מרחק.*30'),'גדול מ־20 ק','גדול מ־30 ק');

  -- Reject an older v37 planner from overwriting already validated v38 plans.
  for fn in select x.oid from pg_proc x where x.pronamespace='public'::regnamespace
    and x.proname in ('save_scheduling_planning_snapshot','save_scheduling_planning_incremental_snapshot')
  loop
    src:=pg_get_functiondef(fn);
    if position('if previous_version like ''planning-v37-%'' and p_engine_version is distinct from previous_version' in src)=0
      or position('if p_engine_version like ''planning-v37-%'' then perform' in src)=0
    then raise exception 'validated workspace save source changed for %', fn; end if;
    src:=replace(src,
      'if previous_version like ''planning-v37-%'' and p_engine_version is distinct from previous_version',
      'if ((previous_version like ''planning-v37-%'' and p_engine_version not like ''planning-v38-%'' and p_engine_version is distinct from previous_version) or (previous_version like ''planning-v38-%'' and p_engine_version is distinct from previous_version))');
    src:=replace(src,
      'if p_engine_version like ''planning-v37-%'' then perform',
      'if p_engine_version like ''planning-v37-%'' or p_engine_version like ''planning-v38-%'' then perform');
    execute src;
  end loop;

  -- Trust-version handshake used by the dashboard before full or incremental save.
  fn := 'public.get_scheduling_planning_engine_capabilities()'::regprocedure;
  src := pg_get_functiondef(fn);
  if position('planning-v37-20261010-constraint-block-planner' in src)=0
  then raise exception 'engine capabilities version source changed'; end if;
  execute replace(src,'planning-v37-20261010-constraint-block-planner',
                     'planning-v38-20261015-transition-30-45');

  fn := 'public.scheduling_v37_workspace_validation(uuid,jsonb)'::regprocedure;
  src := pg_get_functiondef(fn);
  if position('if workspace.engine_version is distinct from ''planning-v37-20261010-constraint-block-planner'' then' in src)=0
  then raise exception 'workspace validator version guard source changed'; end if;
  execute replace(src,
   'if workspace.engine_version is distinct from ''planning-v37-20261010-constraint-block-planner'' then',
   'if workspace.engine_version not in (''planning-v37-20261010-constraint-block-planner'', ''planning-v38-20261015-transition-30-45'') then');
end
$policy$;
