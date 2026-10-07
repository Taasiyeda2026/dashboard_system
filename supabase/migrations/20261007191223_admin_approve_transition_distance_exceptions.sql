-- A verified transition >20 km is an admin-reviewable exception.
-- Drafting/submitting the exception is allowed; final assignment still requires
-- an approved request tied to the same instructor and draft timestamp.
-- Actual overlaps, availability, unknown routes and insufficient travel time
-- continue to be hard blockers. Automatic assignment keeps the 20 km cap.

do $migration$
declare
  def text;
  old_fragment text;
  new_fragment text;
  fn regprocedure;
begin
  fn := 'public.scheduling_manual_assignment_hard_violations(text,bigint)'::regprocedure;
  def := pg_get_functiondef(fn);
  old_fragment := 'if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 20 then raise exception ''scheduling_transition_distance_exceeded''; end if;';
  new_fragment := 'if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 20 then' || E'\n' ||
    '        if not (''scheduling_transition_distance_exceeded'' = any(violations)) then' || E'\n' ||
    '          violations := array_append(violations, ''scheduling_transition_distance_exceeded'');' || E'\n' ||
    '        end if;' || E'\n' ||
    '      end if;';
  if (length(def) - length(replace(def, old_fragment, ''))) / length(old_fragment) <> 2 then
    raise exception 'manual_transition_distance_patch_anchor_missing';
  end if;
  execute replace(def, old_fragment, new_fragment);

  -- Ignore only the reviewable distance cap at these preparatory/review stages.
  -- The review RPC retains its active-admin authorization before this call.
  foreach fn in array array[
    'public.save_course_assignment_manual_draft(text,bigint,text,bigint,integer,integer,text)'::regprocedure,
    'public.submit_course_assignment_manager_approval(text)'::regprocedure,
    'public.review_course_assignment_manager_approval(text,text)'::regprocedure
  ] loop
    def := pg_get_functiondef(fn);
    if position('save_course_assignment_manual_draft(' in def) > 0 then
      old_fragment := 'hard_violations := public.scheduling_manual_assignment_hard_violations(p_activity_id, p_emp_id);';
      new_fragment := 'hard_violations := array_remove(public.scheduling_manual_assignment_hard_violations(p_activity_id, p_emp_id), ''scheduling_transition_distance_exceeded'');';
    else
      old_fragment := 'hard_violations := public.scheduling_manual_assignment_hard_violations(target.row_id, target.draft_emp_id::bigint);';
      new_fragment := 'hard_violations := array_remove(public.scheduling_manual_assignment_hard_violations(target.row_id, target.draft_emp_id::bigint), ''scheduling_transition_distance_exceeded'');';
    end if;
    if position(old_fragment in def) = 0 then
      raise exception 'manual_transition_review_patch_anchor_missing:%', fn;
    end if;
    execute replace(def, old_fragment, new_fragment);
  end loop;

  -- Derive the need for review from server data even if a client supplies a
  -- generic "manual selection" reason or omits the transition warning.
  fn := 'public.scheduling_manual_draft_requires_manager_approval(text,bigint,text)'::regprocedure;
  def := pg_get_functiondef(fn);
  old_fragment := '  if btrim(coalesce(p_manual_reason, '''')) = ''בחירה ידנית'' then return false; end if;';
  new_fragment := '  if ''scheduling_transition_distance_exceeded'' = any(public.scheduling_manual_assignment_hard_violations(p_activity_id, p_emp_id)) then' || E'\n' ||
    '    return true;' || E'\n' ||
    '  end if;' || E'\n\n' || old_fragment;
  if position(old_fragment in def) = 0 then
    raise exception 'manual_transition_approval_required_patch_anchor_missing';
  end if;
  execute replace(def, old_fragment, new_fragment);

  -- The final write may waive the distance cap only after the admin approved
  -- this exact draft. A caller-supplied decision type/reason never suffices.
  fn := 'public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text)'::regprocedure;
  def := pg_get_functiondef(fn);
  old_fragment := '  is_verified_manual_draft boolean := false;';
  if position(old_fragment in def) = 0 then
    raise exception 'manual_transition_finalize_declaration_missing';
  end if;
  def := replace(def, old_fragment, old_fragment || E'\n  transition_distance_exception boolean := false;');
  old_fragment := '    violations := public.scheduling_manual_assignment_hard_violations(p_activity_id, p_emp_id);';
  new_fragment := old_fragment || E'\n' ||
    '    transition_distance_exception := ''scheduling_transition_distance_exceeded'' = any(violations);' || E'\n' ||
    '    if transition_distance_exception then' || E'\n' ||
    '      if not exists (' || E'\n' ||
    '        select 1 from public.edit_requests er' || E'\n' ||
    '        where er.request_type = ''course_assignment_exception''' || E'\n' ||
    '          and er.source_row_id = result.row_id' || E'\n' ||
    '          and er.status = ''approved''' || E'\n' ||
    '          and coalesce(er.active, ''yes'') <> ''no''' || E'\n' ||
    '          and er.requested_payload->>''draft_emp_id'' = result.draft_emp_id' || E'\n' ||
    '          and nullif(er.requested_payload->>''draft_created_at'', '''')::timestamptz = result.draft_created_at' || E'\n' ||
    '      ) then' || E'\n' ||
    '        raise exception ''scheduling_manager_approval_required'';' || E'\n' ||
    '      end if;' || E'\n' ||
    '      violations := array_remove(violations, ''scheduling_transition_distance_exceeded'');' || E'\n' ||
    '    end if;';
  if position(old_fragment in def) = 0 then
    raise exception 'manual_transition_finalize_gate_missing';
  end if;
  def := replace(def, old_fragment, new_fragment);
  old_fragment := 'case when is_verified_manual_draft then array[''manual_selection_soft_warnings'']::text[] else ''{}''::text[] end';
  new_fragment := 'case when transition_distance_exception then array[''manual_selection_soft_warnings'', ''scheduling_transition_distance_exceeded'']::text[] ' ||
    'when is_verified_manual_draft then array[''manual_selection_soft_warnings'']::text[] else ''{}''::text[] end';
  if position(old_fragment in def) = 0 then
    raise exception 'manual_transition_finalize_audit_missing';
  end if;
  execute replace(def, old_fragment, new_fragment);

  -- A server-detected exception needs a clear reason on the approval card even
  -- when an older client submitted only the generic manual-selection wording.
  fn := 'public.submit_course_assignment_manager_approval(text)'::regprocedure;
  def := pg_get_functiondef(fn);
  old_fragment := '  select er.* into existing_request';
  new_fragment := '  if ''scheduling_transition_distance_exceeded'' = any(public.scheduling_manual_assignment_hard_violations(target.row_id, target.draft_emp_id::bigint))' || E'\n' ||
    '    and manual_reason !~ ''מרחק.*20''' || E'\n' ||
    '  then' || E'\n' ||
    '    manual_reason := manual_reason || '' · המרחק בין הפעילויות גדול מ־20 ק״מ'';' || E'\n' ||
    '  end if;' || E'\n\n' || old_fragment;
  if position(old_fragment in def) = 0 then
    raise exception 'manual_transition_request_reason_missing';
  end if;
  execute replace(def, old_fragment, new_fragment);
end
$migration$;

comment on function public.save_course_assignment_manual_draft(text,bigint,text,bigint,integer,integer,text) is
  'Saves a feasible manual draft; verified transition distance >20km is allowed as an exception requiring explicit admin approval before final assignment.';
