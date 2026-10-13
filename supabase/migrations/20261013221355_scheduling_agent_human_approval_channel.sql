-- Follow-up is staged only. OAuth client tokens may REQUEST approval, never grant it.
create or replace function public.scheduling_agent_approve(p_request_id uuid,p_preview_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.scheduling_agent_requests;
begin
 perform public.scheduling_agent_assert_owner();
 if public.app_current_role() is distinct from 'admin'
 or nullif(auth.jwt()->>'client_id','') is not null
 then raise exception 'scheduling_agent_human_session_required' using errcode='42501'; end if;
 select * into r from public.scheduling_agent_requests where id=p_request_id for update;
 if not found or r.requested_by<>auth.uid() then raise exception 'scheduling_agent_request_missing'; end if;
 if r.state<>'pending' or r.preview_hash is distinct from p_preview_hash or r.expires_at<=clock_timestamp()
 then raise exception 'scheduling_agent_approval_invalid'; end if;
 update public.scheduling_agent_requests set state='approved',approved_by=auth.uid(),approved_at=clock_timestamp(),
 expires_at=least(expires_at,clock_timestamp()+interval '10 minutes') where id=r.id;
 return jsonb_build_object('requestId',r.id,'state','approved');
end $$;
revoke all on function public.scheduling_agent_approve(uuid,text) from public,anon;
grant execute on function public.scheduling_agent_approve(uuid,text) to authenticated;

create or replace function public.scheduling_agent_list_requests()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.scheduling_agent_assert_owner();
 if nullif(auth.jwt()->>'client_id','') is not null then raise exception 'scheduling_agent_human_session_required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb) from (
  select id,preview,preview_hash,state,created_at,expires_at,approved_at,committed_at,result
  from public.scheduling_agent_requests where requested_by=auth.uid() order by created_at desc limit 50
 ) q);
end $$;
revoke all on function public.scheduling_agent_list_requests() from public,anon;
grant execute on function public.scheduling_agent_list_requests() to authenticated;

create or replace function public.scheduling_agent_read_snapshot()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.scheduling_agent_assert_owner();
 return jsonb_build_object(
  'schemaVersion',1,
  'connector',(select jsonb_build_object('spreadsheetId',spreadsheet_id,'folderId',folder_id,'googleSub',google_sub) from public.scheduling_agent_control where singleton),
  'sourceRevision',(select revision::text from public.scheduling_planning_source_state where singleton),
  'workspace',(select jsonb_build_object('id',id,'revision',revision::text,'engineVersion',engine_version,'validatedSourceRevision',validated_source_revision::text,'calculatedAt',calculated_at) from public.scheduling_planning_workspaces where period_key='year' and district=''),
  'rows',(select coalesce(jsonb_agg(jsonb_build_object(
    'activityId',a.row_id,'schoolId',a.school_id,'school',a.school,'authority',a.authority,'program',a.activity_name,'programId',a.activity_no,
    'instructorId',a.emp_id,'instructorName',a.instructor_name,'startDate',a.start_date,'startTime',a.start_time,'endTime',a.end_time,
    'sessions',a.sessions,'activityManager',a.activity_manager,'instructionLanguage',a.instruction_language,'activityUpdatedAt',a.updated_at,'assignmentLocked',a.instructor_assignment_locked,
    'needsRecalc',r.needs_recalc,'planning',r.row_data,'lockedOption',r.locked_option
  ) order by a.row_id),'[]'::jsonb)
  from public.activities a
  left join public.scheduling_planning_workspaces w on w.period_key='year' and w.district=''
  left join public.scheduling_planning_rows r on r.workspace_id=w.id and r.activity_id=a.row_id
  where a.activity_season='school_2027' and a.status='פתוח' and a.activity_type='course'
    and a.activity_no is distinct from '13990' and coalesce(a.activity_name,'') not like '%התנסות בתעשייה%')
 );
end $$;

revoke all on function public.scheduling_agent_read_snapshot() from public,anon;
grant execute on function public.scheduling_agent_read_snapshot() to authenticated;
