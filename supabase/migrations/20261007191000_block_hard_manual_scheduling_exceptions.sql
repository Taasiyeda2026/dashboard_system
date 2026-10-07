-- Prevent hard scheduling feasibility violations from being persisted as
-- "manual" drafts that later produce impossible manager-approval requests.
--
-- Manual selection may still bypass recommendation-quality signals such as the
-- automatic 40 km home-distance preference. It may not bypass the authoritative
-- hard-violation helper (overlap, unavailable instructor, blocked authority,
-- unverified/impossible transition, >20 km consecutive transition, etc.).

do $$
declare
  fn regprocedure := 'public.save_course_assignment_manual_draft(text,bigint,text,bigint,integer,integer,text)'::regprocedure;
  def text := pg_get_functiondef(fn);
  old_decl text := '  normalized_reason text;';
  new_decl text := '  normalized_reason text;' || E'\n  hard_violations text[];';
  old_anchor text := '  if public.scheduling_course_conflict_exists(p_activity_id, p_emp_id) then' || E'\n' ||
                     '    raise exception ''scheduling_conflict_detected'';' || E'\n' ||
                     '  end if;' || E'\n\n' ||
                     '  normalized_reason := case';
  new_anchor text := '  if public.scheduling_course_conflict_exists(p_activity_id, p_emp_id) then' || E'\n' ||
                     '    raise exception ''scheduling_conflict_detected'';' || E'\n' ||
                     '  end if;' || E'\n\n' ||
                     '  hard_violations := public.scheduling_manual_assignment_hard_violations(p_activity_id, p_emp_id);' || E'\n' ||
                     '  if coalesce(array_length(hard_violations, 1), 0) > 0 then' || E'\n' ||
                     '    raise exception ''%'', hard_violations[1];' || E'\n' ||
                     '  end if;' || E'\n\n' ||
                     '  normalized_reason := case';
begin
  if position('hard_violations := public.scheduling_manual_assignment_hard_violations' in def) = 0 then
    if position(old_decl in def) = 0 or position(old_anchor in def) = 0 then
      raise exception 'manual_draft_hard_gate_patch_anchor_missing';
    end if;
    def := replace(def, old_decl, new_decl);
    def := replace(def, old_anchor, new_anchor);
    execute def;
  end if;
end
$$;

do $$
declare
  fn regprocedure := 'public.submit_course_assignment_manager_approval(text)'::regprocedure;
  def text := pg_get_functiondef(fn);
  old_decl text := '  inserted_request public.edit_requests;';
  new_decl text := '  inserted_request public.edit_requests;' || E'\n  hard_violations text[];';
  old_anchor text := '  if not found then raise exception ''scheduling_manual_draft_missing''; end if;' || E'\n' ||
                     '  if not public.scheduling_manual_draft_requires_manager_approval(target.row_id, target.draft_emp_id::bigint, manual_reason) then';
  new_anchor text := '  if not found then raise exception ''scheduling_manual_draft_missing''; end if;' || E'\n\n' ||
                     '  hard_violations := public.scheduling_manual_assignment_hard_violations(target.row_id, target.draft_emp_id::bigint);' || E'\n' ||
                     '  if coalesce(array_length(hard_violations, 1), 0) > 0 then' || E'\n' ||
                     '    raise exception ''%'', hard_violations[1];' || E'\n' ||
                     '  end if;' || E'\n\n' ||
                     '  if not public.scheduling_manual_draft_requires_manager_approval(target.row_id, target.draft_emp_id::bigint, manual_reason) then';
begin
  if position('hard_violations := public.scheduling_manual_assignment_hard_violations' in def) = 0 then
    if position(old_decl in def) = 0 or position(old_anchor in def) = 0 then
      raise exception 'manager_approval_submit_hard_gate_patch_anchor_missing';
    end if;
    def := replace(def, old_decl, new_decl);
    def := replace(def, old_anchor, new_anchor);
    execute def;
  end if;
end
$$;

comment on function public.save_course_assignment_manual_draft(text,bigint,text,bigint,integer,integer,text) is
  'Saves a manual scheduling draft only after authoritative hard-feasibility validation; soft recommendation exceptions remain manually selectable.';
