-- UI integration only: no data updates, scheduling rules, grants to anon, or planner changes.
-- Generated with CLI; sequenced after the already existing 20261015 migrations.
create function public.get_scheduling_dashboard_candidates(p_activity_id text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a public.activities; w public.scheduling_planning_workspaces;
 r public.scheduling_planning_rows; source_revision bigint; instructors jsonb; approval jsonb; audit_reason text; activity_payload jsonb;
begin
 if auth.uid() is null or not public.app_has_permission('view_operations_scheduling')
   or not exists(select 1 from public.users where auth_user_id=auth.uid() and is_active)
 then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
 select * into a from public.activities where row_id=p_activity_id;
 if not found then raise exception 'activity_not_found'; end if;
 select * into w from public.scheduling_planning_workspaces where period_key='year' and district='';
 select * into r from public.scheduling_planning_rows where workspace_id=w.id and activity_id=p_activity_id;
 select revision into source_revision from public.scheduling_planning_source_state where singleton;
 select coalesce(jsonb_agg(jsonb_build_object('emp_id',emp_id,'full_name',full_name,'active',active) order by full_name),'[]')
   into instructors from public.contacts_instructors
   where lower(coalesce(active::text,'yes')) not in ('no','false','0','לא פעיל');
 select jsonb_build_object('id',id,'status',status) into approval from public.edit_requests
   where source_row_id=a.row_id and request_type='course_assignment_exception' and status='approved'
     and coalesce(active,'yes')<>'no' and requested_payload->>'draft_emp_id'=a.emp_id::text
   order by created_at desc limit 1;
 select reason into audit_reason from public.instructor_assignment_audit
   where activity_id=a.row_id and decision_type='revalidated' order by created_at desc,id desc limit 1;
 select jsonb_object_agg(key,value) into activity_payload from jsonb_each(to_jsonb(a))
   where key=any(array['row_id','updated_at','school','school_id','authority','authority_id','activity_no','activity_name','activity_manager','instruction_language','required_instructor_gender','activity_type','activity_season','status','emp_id','emp_id_2','instructor_name','instructor_name_2','instructor_assignment_locked','instructor_assignment_status','draft_emp_id','draft_instructor_name','draft_created_at','draft_created_by','draft_proposed_meetings','start_date','end_date','start_time','end_time','date_1','date_2','date_3','date_4','date_5','date_6','date_7','date_8','date_9','date_10','date_11','date_12','date_13','date_14','date_15','date_16','date_17','date_18','date_19','date_20','date_21','date_22','date_23','date_24','date_25','date_26','date_27','date_28','date_29','date_30','date_31','date_32','date_33','date_34','date_35']);
 return jsonb_build_object('activity',activity_payload,'row',r.row_data,'instructors',instructors,
   'sourceRevision',source_revision,'workspaceRevision',w.revision,
   'planFresh',coalesce(not r.needs_recalc and w.validated_source_revision=source_revision
     and w.engine_version='planning-v38-20261015-transition-30-45',false),
   'approvedException',approval,'reviewReason',audit_reason);
end $$;
revoke all on function public.get_scheduling_dashboard_candidates(text) from public,anon;
grant execute on function public.get_scheduling_dashboard_candidates(text) to authenticated;

-- Keep each existing write RPC and its validation/approval semantics; fence the UI's
-- activity version before delegating, then return the committed authoritative row.
create function public.scheduling_dashboard_assignment(
 p_rpc text,p_args jsonb,p_expected_updated_at timestamptz,
 p_expected_source_revision bigint default null,p_expected_workspace_revision bigint default null
) returns public.activities language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.activities; result public.activities; v_emp bigint; violations text[];
begin
 if auth.uid() is null or not public.app_has_permission('view_operations_scheduling')
   or not exists(select 1 from public.users where auth_user_id=auth.uid() and is_active)
 then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
 if jsonb_typeof(p_args) is distinct from 'object' then raise exception 'scheduling_invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
 select * into a from public.activities where row_id=p_args->>'p_activity_id' for update;
 if not found then raise exception 'activity_not_found'; end if;
 if p_expected_updated_at is null or a.updated_at is distinct from p_expected_updated_at
 then raise exception 'scheduling_activity_revision_conflict' using errcode='PT409'; end if;
 if p_expected_source_revision is not null and not exists(select 1 from public.scheduling_planning_source_state where singleton and revision=p_expected_source_revision)
 then raise exception 'planning_source_revision_conflict' using errcode='PT409'; end if;
 if p_expected_workspace_revision is not null and not exists(select 1 from public.scheduling_planning_workspaces where period_key='year' and district='' and revision=p_expected_workspace_revision)
 then raise exception 'planning_revision_conflict' using errcode='PT409'; end if;
 -- Draft paths historically differed in strength. A regular choice must pass the
 -- existing ordinary server validator too; manual drafts retain their separate
 -- hard constraints + explicit manager-approval flow for permitted exceptions.
 if p_rpc in ('save_course_assignment_draft','save_course_assignment_draft_with_dates') then
   v_emp:=(p_args->>'p_emp_id')::bigint;
   perform public.scheduling_lock_instructor_for_write(v_emp);
   if p_args->'p_proposed_meetings' is not null and p_args->'p_proposed_meetings'<>'null'::jsonb then
     perform public.scheduling_assert_proposed_eligibility(a.row_id,v_emp,p_args->'p_proposed_meetings');
   else
     violations:=public.scheduling_course_instructor_violations(a.row_id,v_emp,true);
     if coalesce(array_length(violations,1),0)>0 then raise exception '%',violations[1]; end if;
   end if;
 end if;
 if p_rpc='save_course_assignment_draft' then
  result:=public.save_course_assignment_draft(p_activity_id:=(p_args->>'p_activity_id')::text,p_emp_id:=(p_args->>'p_emp_id')::bigint,p_instructor_name:=(p_args->>'p_instructor_name')::text,p_top_emp_id:=(p_args->>'p_top_emp_id')::bigint,p_selected_score:=(p_args->>'p_selected_score')::integer,p_top_score:=(p_args->>'p_top_score')::integer);
 elsif p_rpc='save_course_assignment_draft_with_dates' then
  result:=public.save_course_assignment_draft_with_dates(p_activity_id:=(p_args->>'p_activity_id')::text,p_emp_id:=(p_args->>'p_emp_id')::bigint,p_instructor_name:=(p_args->>'p_instructor_name')::text,p_proposed_meetings:=p_args->'p_proposed_meetings',p_top_emp_id:=(p_args->>'p_top_emp_id')::bigint,p_selected_score:=(p_args->>'p_selected_score')::integer,p_top_score:=(p_args->>'p_top_score')::integer);
 elsif p_rpc='save_course_assignment_manual_draft' then
  result:=public.save_course_assignment_manual_draft(p_activity_id:=(p_args->>'p_activity_id')::text,p_emp_id:=(p_args->>'p_emp_id')::bigint,p_instructor_name:=(p_args->>'p_instructor_name')::text,p_top_emp_id:=(p_args->>'p_top_emp_id')::bigint,p_selected_score:=(p_args->>'p_selected_score')::integer,p_top_score:=(p_args->>'p_top_score')::integer,p_reason:=(p_args->>'p_reason')::text);
 elsif p_rpc='assign_activity_instructor' then
  result:=public.assign_activity_instructor(p_activity_id:=(p_args->>'p_activity_id')::text,p_emp_id:=(p_args->>'p_emp_id')::bigint,p_instructor_name:=(p_args->>'p_instructor_name')::text,p_top_emp_id:=(p_args->>'p_top_emp_id')::bigint,p_selected_score:=(p_args->>'p_selected_score')::integer,p_top_score:=(p_args->>'p_top_score')::integer,p_decision_type:=(p_args->>'p_decision_type')::text,p_reason:=(p_args->>'p_reason')::text);
 elsif p_rpc='assign_activity_instructor_with_dates' then
  result:=public.assign_activity_instructor_with_dates(p_activity_id:=(p_args->>'p_activity_id')::text,p_emp_id:=(p_args->>'p_emp_id')::bigint,p_instructor_name:=(p_args->>'p_instructor_name')::text,p_proposed_meetings:=p_args->'p_proposed_meetings',p_top_emp_id:=(p_args->>'p_top_emp_id')::bigint,p_selected_score:=(p_args->>'p_selected_score')::integer,p_top_score:=(p_args->>'p_top_score')::integer,p_decision_type:=(p_args->>'p_decision_type')::text,p_reason:=(p_args->>'p_reason')::text);
 elsif p_rpc='reassign_locked_course_instructor' then
  result:=public.reassign_locked_course_instructor(p_activity_id:=(p_args->>'p_activity_id')::text,p_new_emp_id:=(p_args->>'p_new_emp_id')::bigint,p_new_instructor_name:=(p_args->>'p_new_instructor_name')::text,p_top_emp_id:=(p_args->>'p_top_emp_id')::bigint,p_selected_score:=(p_args->>'p_selected_score')::integer,p_top_score:=(p_args->>'p_top_score')::integer,p_decision_type:=(p_args->>'p_decision_type')::text,p_reason:=(p_args->>'p_reason')::text);
 elsif p_rpc='replace_locked_course_instructor' then
  result:=public.replace_locked_course_instructor(p_activity_id:=(p_args->>'p_activity_id')::text,p_new_emp_id:=(p_args->>'p_new_emp_id')::bigint,p_new_instructor_name:=(p_args->>'p_new_instructor_name')::text,p_effective_from:=(p_args->>'p_effective_from')::date,p_reason:=(p_args->>'p_reason')::text);
 elsif p_rpc='cancel_course_assignment_draft' then
  result:=public.cancel_course_assignment_draft(p_activity_id:=(p_args->>'p_activity_id')::text);
 elsif p_rpc='cancel_confirmed_course_assignment' then
  result:=public.cancel_confirmed_course_assignment(p_activity_id:=(p_args->>'p_activity_id')::text,p_reason:=(p_args->>'p_reason')::text);
 else raise exception 'scheduling_action_not_allowed' using errcode='42501'; end if;
 return result;
end $$;
revoke all on function public.scheduling_dashboard_assignment(text,jsonb,timestamptz,bigint,bigint) from public,anon;
grant execute on function public.scheduling_dashboard_assignment(text,jsonb,timestamptz,bigint,bigint) to authenticated;
