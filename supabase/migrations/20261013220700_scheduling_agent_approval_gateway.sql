-- Staged gateway. Intentionally disabled; installation alone cannot assign a course.
-- No existing scheduling rule, assignment, profile, date or planning row is changed.
create table public.scheduling_agent_control (
 singleton boolean primary key default true check (singleton),
 enabled boolean not null default false,
 approver_id uuid,
 spreadsheet_id text,
 folder_id text,
 google_sub text
);
insert into public.scheduling_agent_control(singleton) values(true);
alter table public.scheduling_agent_control enable row level security;
revoke all on public.scheduling_agent_control from public, anon, authenticated;

create table public.scheduling_agent_requests (
 id uuid primary key default gen_random_uuid(),
 requested_by uuid not null,
 idempotency_key uuid not null,
 preview jsonb not null,
 preview_hash text not null,
 state text not null default 'pending' check (state in ('pending','approved','committed')),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '30 minutes'),
 approved_by uuid,
 approved_at timestamptz,
 committed_at timestamptz,
 result jsonb,
 unique(requested_by,idempotency_key)
);
alter table public.scheduling_agent_requests enable row level security;
revoke all on public.scheduling_agent_requests from public, anon, authenticated;

create or replace function public.scheduling_agent_assert_owner()
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null
 or auth.uid() is distinct from (select approver_id from public.scheduling_agent_control where singleton)
 or not coalesce(public.app_has_permission('view_operations_scheduling'),false)
 or not exists(select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active)
 then raise exception 'scheduling_agent_permission_denied' using errcode='42501'; end if;
end $$;
revoke all on function public.scheduling_agent_assert_owner() from public,anon,authenticated;

-- Stable, non-locking read: neither get_workspace_page nor a planner/save RPC runs here.
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
    'sessions',a.sessions,'activityUpdatedAt',a.updated_at,'assignmentLocked',a.instructor_assignment_locked,
    'needsRecalc',r.needs_recalc,'planning',r.row_data,'lockedOption',r.locked_option
  ) order by a.row_id),'[]'::jsonb)
  from public.activities a
  left join public.scheduling_planning_workspaces w on w.period_key='year' and w.district=''
  left join public.scheduling_planning_rows r on r.workspace_id=w.id and r.activity_id=a.row_id
  where a.activity_season='school_2027' and a.status='פתוח' and a.activity_type='course'
    and a.activity_no is distinct from '13990' and coalesce(a.activity_name,'') not like '%התנסות בתעשייה%')
 );
end $$;

create or replace function public.scheduling_agent_preview(
 p_activity_id text,p_option_index integer,p_workspace_revision bigint,p_source_revision bigint,p_sheet_hash text
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare w public.scheduling_planning_workspaces; r public.scheduling_planning_rows;
 a public.activities; o jsonb; preview jsonb;
begin
 perform public.scheduling_agent_assert_owner();
 if p_sheet_hash is null or p_sheet_hash !~ '^[0-9a-f]{64}$' or p_option_index is null or p_option_index<0 or p_option_index>50 then
  raise exception 'scheduling_agent_invalid_request'; end if;
 select * into w from public.scheduling_planning_workspaces where period_key='year' and district='';
 if not found or w.revision is distinct from p_workspace_revision
 or p_source_revision is distinct from (select revision from public.scheduling_planning_source_state where singleton)
 then raise exception 'scheduling_agent_revision_conflict' using errcode='PT409'; end if;
 select * into a from public.activities where row_id=p_activity_id;
 if not found then raise exception 'activity_not_found'; end if;
 if a.activity_season is distinct from 'school_2027' or a.status is distinct from 'פתוח' or a.activity_type is distinct from 'course' or a.activity_no='13990'
 or coalesce(a.activity_name,'') like '%התנסות בתעשייה%' then raise exception 'scheduling_agent_course_only'; end if;
 if a.emp_id is not null or nullif(a.emp_id_2,'') is not null or a.instructor_assignment_locked
 or nullif(btrim(coalesce(a.draft_emp_id,'')),'') is not null then raise exception 'scheduling_agent_protected_assignment'; end if;
 select * into r from public.scheduling_planning_rows where workspace_id=w.id and activity_id=p_activity_id;
 if not found or r.needs_recalc or r.activity_updated_at is distinct from a.updated_at
 then raise exception 'scheduling_agent_stale_planning'; end if;
 o:=r.row_data->'options'->p_option_index;
 if o is null or coalesce(o->>'instructorEmpId','') !~ '^[0-9]+$'
 or coalesce(o->>'eligible','false')<>'true' or coalesce(o->>'routeVerified','false')<>'true'
 or jsonb_typeof(o->'meetings') is distinct from 'array' or jsonb_array_length(o->'meetings')=0
 then raise exception 'scheduling_agent_invalid_option'; end if;
 if r.locked_option is not null and r.locked_option is distinct from o then raise exception 'scheduling_agent_existing_lock'; end if;
 -- The rolling lead time is rechecked at preview AND commit. No fixed date moves.
 if a.start_date is null and not exists(select 1 from generate_series(1,35) n where nullif(to_jsonb(a)->>('date_'||n),'') is not null)
 and (o->'meetings'->0->>'date')::date < (clock_timestamp() at time zone 'Asia/Jerusalem')::date+7
 then raise exception 'scheduling_agent_start_too_soon'; end if;
 preview:=jsonb_build_object('operation','confirm_planning','activityId',a.row_id,
 'school',a.school,'authority',a.authority,'program',a.activity_name,'before',jsonb_build_object('instructorId',a.emp_id,'startDate',a.start_date),
 'optionIndex',p_option_index,'option',o,'activityUpdatedAt',a.updated_at,
 'workspaceRevision',w.revision::text,'sourceRevision',p_source_revision::text,'sheetHash',p_sheet_hash);
 return preview;
end $$;

create or replace function public.scheduling_agent_request_approval(
 p_activity_id text,p_option_index integer,p_workspace_revision bigint,p_source_revision bigint,p_sheet_hash text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb; h text; r public.scheduling_agent_requests;
begin
 perform public.scheduling_agent_assert_owner();
 if p_idempotency_key is null then raise exception 'scheduling_agent_idempotency_required'; end if;
 p:=public.scheduling_agent_preview(p_activity_id,p_option_index,p_workspace_revision,p_source_revision,p_sheet_hash);
 h:=encode(sha256(convert_to(p::text,'UTF8')),'hex');
 insert into public.scheduling_agent_requests(requested_by,idempotency_key,preview,preview_hash)
 values(auth.uid(),p_idempotency_key,p,h) on conflict(requested_by,idempotency_key) do nothing;
 select * into r from public.scheduling_agent_requests where requested_by=auth.uid() and idempotency_key=p_idempotency_key;
 if r.preview_hash<>h then raise exception 'scheduling_agent_idempotency_conflict' using errcode='PT409'; end if;
 return jsonb_build_object('requestId',r.id,'preview',r.preview,'previewHash',r.preview_hash,'state',r.state,'expiresAt',r.expires_at);
end $$;

-- OPERATOR ONLY. Never expose as an MCP tool or accept approval prose as this call.
-- Requires a separate human UI with verified owner identity before activation.
create or replace function public.scheduling_agent_approve(p_request_id uuid,p_preview_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.scheduling_agent_requests;
begin
 perform public.scheduling_agent_assert_owner();
 if public.app_current_role() is distinct from 'admin' then raise exception 'scheduling_agent_permission_denied' using errcode='42501'; end if;
 select * into r from public.scheduling_agent_requests where id=p_request_id for update;
 if not found or r.requested_by<>auth.uid() then raise exception 'scheduling_agent_request_missing'; end if;
 if r.state<>'pending' or r.preview_hash is distinct from p_preview_hash or r.expires_at<=clock_timestamp()
 then raise exception 'scheduling_agent_approval_invalid'; end if;
 update public.scheduling_agent_requests set state='approved',approved_by=auth.uid(),approved_at=clock_timestamp(),
 expires_at=least(expires_at,clock_timestamp()+interval '10 minutes') where id=r.id;
 return jsonb_build_object('requestId',r.id,'state','approved');
end $$;

create or replace function public.scheduling_agent_commit_approved(p_request_id uuid,p_sheet_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.scheduling_agent_requests; fresh jsonb; w public.scheduling_planning_workspaces; a public.activities; receipt jsonb;
begin
 perform public.scheduling_agent_assert_owner();
 if not coalesce((select enabled from public.scheduling_agent_control where singleton),false) then raise exception 'scheduling_agent_writes_disabled'; end if;
 select * into r from public.scheduling_agent_requests where id=p_request_id for update;
 if not found or r.requested_by<>auth.uid() then raise exception 'scheduling_agent_request_missing'; end if;
 if r.state='committed' then return r.result; end if;
 if r.state<>'approved' or r.approved_by is distinct from auth.uid() or r.expires_at<=clock_timestamp()
 then raise exception 'scheduling_agent_approval_required'; end if;
 if p_sheet_hash is distinct from r.preview->>'sheetHash' then raise exception 'scheduling_agent_sheet_changed' using errcode='PT409'; end if;
 -- Serialize context changes with source-state invalidation, then protect the workspace.
 perform 1 from public.scheduling_planning_source_state where singleton for update;
 select * into w from public.scheduling_planning_workspaces where period_key='year' and district='' for update;
 fresh:=public.scheduling_agent_preview(r.preview->>'activityId',(r.preview->>'optionIndex')::integer,
 (r.preview->>'workspaceRevision')::bigint,(r.preview->>'sourceRevision')::bigint,p_sheet_hash);
 if fresh is distinct from r.preview then raise exception 'scheduling_agent_preview_changed' using errcode='PT409'; end if;
 -- Reuse the existing lock validator and existing atomic confirmation/constraint gates.
 perform public.set_scheduling_planning_lock('year','',r.preview->>'activityId',r.preview->'option',w.revision);
 select * into w from public.scheduling_planning_workspaces where period_key='year' and district='';
 a:=public.confirm_scheduling_planning_draft('year','',r.preview->>'activityId',w.revision);
 receipt:=jsonb_build_object('requestId',r.id,'state','committed','activityId',a.row_id,
 'instructorId',a.emp_id,'instructorName',a.instructor_name,'startDate',a.start_date,'endDate',a.end_date,
 'updatedAt',a.updated_at,'sheetState','pending_separate_approved_projection');
 update public.scheduling_agent_requests set state='committed',committed_at=clock_timestamp(),result=receipt where id=r.id;
 return receipt;
 -- Any error rolls back the lock, assignment, approval consumption AND existing audit.
end $$;

create or replace function public.scheduling_agent_verify_commit(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.scheduling_agent_requests; a public.activities;
begin
 perform public.scheduling_agent_assert_owner();
 select * into r from public.scheduling_agent_requests where id=p_request_id and requested_by=auth.uid();
 if not found then raise exception 'scheduling_agent_request_missing'; end if;
 select * into a from public.activities where row_id=r.preview->>'activityId';
 return jsonb_build_object('requestId',r.id,'state',r.state,'receipt',r.result,
 'matchesCommittedVersion',r.state='committed' and a.updated_at=(r.result->>'updatedAt')::timestamptz);
end $$;

revoke all on function public.scheduling_agent_read_snapshot() from public,anon;
revoke all on function public.scheduling_agent_preview(text,integer,bigint,bigint,text) from public,anon;
revoke all on function public.scheduling_agent_request_approval(text,integer,bigint,bigint,text,uuid) from public,anon;
revoke all on function public.scheduling_agent_approve(uuid,text) from public,anon;
revoke all on function public.scheduling_agent_commit_approved(uuid,text) from public,anon;
revoke all on function public.scheduling_agent_verify_commit(uuid) from public,anon;
grant execute on function public.scheduling_agent_read_snapshot(),public.scheduling_agent_preview(text,integer,bigint,bigint,text),
public.scheduling_agent_request_approval(text,integer,bigint,bigint,text,uuid),public.scheduling_agent_approve(uuid,text),
public.scheduling_agent_commit_approved(uuid,text),public.scheduling_agent_verify_commit(uuid) to authenticated;
