-- Official activity schedules are read-only to scheduling clients. No business data backfill.

create or replace function scheduling_manual_private.draft_matches_official(a public.activities)
returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare official jsonb; draft jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('date',x->>'date','start_time',a.start_time,'end_time',a.end_time) order by ord),'[]'::jsonb)
    into official from jsonb_array_elements(public.scheduling_activity_official_meetings(a)) with ordinality e(x,ord);
  select coalesce(jsonb_agg(jsonb_build_object('date',(x->>'date')::date,
    'start_time',coalesce(nullif(x->>'start_time','')::time,a.start_time),
    'end_time',coalesce(nullif(x->>'end_time','')::time,a.end_time)) order by ord),'[]'::jsonb)
    into draft from jsonb_array_elements(a.draft_proposed_meetings) with ordinality e(x,ord);
  return draft = official;
exception when others then return false;
end $$;

create or replace function public.scheduling_set_activity_meetings(p_activity_id text,p_meetings jsonb)
returns public.activities language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.activities; incoming jsonb;
begin
  select * into a from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if jsonb_typeof(p_meetings) is distinct from 'array' then raise exception 'scheduling_official_schedule_read_only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('date',x->>'date') order by ord),'[]'::jsonb)
    into incoming from jsonb_array_elements(p_meetings) with ordinality e(x,ord);
  if incoming is distinct from public.scheduling_activity_official_meetings(a) or incoming='[]'::jsonb
    or exists(select 1 from jsonb_array_elements(p_meetings) e where
      (e ? 'start_time' and (e->>'start_time')::time is distinct from a.start_time)
      or (e ? 'end_time' and (e->>'end_time')::time is distinct from a.end_time)) then
    raise exception 'scheduling_official_schedule_read_only'; end if;
  return a;
end $$;

create or replace function public.scheduling_manual_capabilities()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform scheduling_manual_private.assert_operator();
  return jsonb_build_object('apiVersion','manual-operations-v1','enabled',true,'officialScheduleReadOnly',true);
end $$;

create or replace function scheduling_manual_private.prepare(
  p_activity_id text,p_emp_id bigint,p_meetings jsonb,p_start_time time,p_end_time time,
  p_action text,p_effective_from date,p_expected_updated_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.activities; proposed public.activities; i public.contacts_instructors;
  canonical jsonb:='[]'; patch jsonb:='{}'; m jsonb; d date; prior date;
  today date:=(current_timestamp at time zone 'Asia/Jerusalem')::date;
  sector text; required_count integer; old_date date; protected boolean; n integer; effective_end time;
  result jsonb; secondary jsonb; effective date; intent jsonb; policy_warnings jsonb:='[]'; shortened time; pending_history jsonb; pending jsonb;
begin
  perform scheduling_manual_private.assert_operator();
  select * into a from public.activities where row_id=p_activity_id;
  if not found then raise exception 'activity_not_found'; end if;
  if p_expected_updated_at is null or a.updated_at is distinct from p_expected_updated_at then
    raise exception 'scheduling_activity_revision_conflict' using errcode='PT409'; end if;
  if a.activity_season is distinct from 'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(a.status,''))) not in ('open','פתוח') then
    policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','scheduling_activity_not_open')); end if;
  if lower(btrim(coalesce(a.activity_type,''))) not in
    ('course','program','קורס','קורסים','תוכנית','תכנית','workshop','סדנה','סדנא','סדנאות','tour','סיור','סיורים')
    then raise exception 'scheduling_activity_not_course'; end if;
  if p_action not in ('draft','confirm') or p_action is null then raise exception 'scheduling_action_not_allowed'; end if;
  if p_action='draft' and (a.emp_id is not null or nullif(a.emp_id_2,'') is not null or a.instructor_assignment_locked)
    then raise exception 'scheduling_assignment_locked'; end if;
  select * into i from scheduling_manual_private.resolve_instructor(p_emp_id);
  if i.emp_id is null then raise exception 'instructor_not_found'; end if;
  if p_emp_id::text=nullif(a.emp_id_2,'') then raise exception 'scheduling_duplicate_instructor'; end if;
  select jsonb_build_object('empId',x.emp_id,'version',x.version,'reason',x.reason) into intent
    from public.scheduling_instructor_intents x where x.activity_id=a.row_id and x.status='active';
  -- Legacy arguments are accepted only when they exactly match official data.
  if (p_start_time is not null and p_start_time is distinct from a.start_time)
    or (p_end_time is not null and p_end_time is distinct from a.end_time)
    or (p_meetings is not null and p_meetings is distinct from 'null'::jsonb and (
      jsonb_typeof(p_meetings) is distinct from 'array' or
      p_meetings is distinct from (select coalesce(jsonb_agg(jsonb_build_object('date',x->>'date') order by ord),'[]'::jsonb)
        from jsonb_array_elements(public.scheduling_activity_official_meetings(a)) with ordinality e(x,ord))
      and p_meetings is distinct from public.scheduling_activity_official_meetings(a)))
    then raise exception 'scheduling_official_schedule_read_only'; end if;
  p_meetings:=public.scheduling_activity_official_meetings(a);
  p_start_time:=a.start_time; p_end_time:=a.end_time;
  if a.draft_emp_id is not null and a.draft_proposed_meetings is not null
    and not scheduling_manual_private.draft_matches_official(a) then
    policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','manual_draft_schedule_changed'));
  end if;
  if p_start_time is null or p_end_time is null or p_start_time>=p_end_time then raise exception 'scheduling_activity_hours_missing'; end if;
  if jsonb_typeof(p_meetings) is distinct from 'array' or jsonb_array_length(p_meetings) not between 1 and 35
    then raise exception 'scheduling_proposed_dates_invalid'; end if;
  if btrim(coalesce(a.sessions,'')) !~ '^[0-9]{1,2}$' then raise exception 'scheduling_activity_sessions_invalid'; end if;
  required_count:=a.sessions::integer;
  if required_count not between 1 and 35 or jsonb_array_length(p_meetings)<>required_count
    then raise exception 'scheduling_proposed_meeting_count_mismatch'; end if;
  sector:=public.school_calendar_sector_for_school_id(a.school_id);
  if nullif(sector,'') is null then
    policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','scheduling_school_sector_missing')); end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.meeting_date),'[]'::jsonb) into pending_history
    from public.course_meeting_instructor_history h where h.activity_id=a.row_id and h.assignment_kind='availability_blocked_pending';
  for pending in select value from jsonb_array_elements(pending_history) loop
    policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','manual_unstaffed_pending',
      'date',pending->>'meeting_date','previousEmpId',pending->>'previous_emp_id')); end loop;
  n:=0;
  for m in select value from jsonb_array_elements(p_meetings) loop
    n:=n+1;
    if coalesce(m->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'scheduling_proposed_dates_invalid'; end if;
    begin d:=(m->>'date')::date; exception when others then raise exception 'scheduling_proposed_dates_invalid'; end;
    if d<date '2026-09-01' or d>date '2027-08-31' or (prior is not null and d<=prior)
      then raise exception 'scheduling_proposed_dates_invalid'; end if;
    old_date:=nullif(to_jsonb(a)->>('date_'||n),'')::date;
    if d is distinct from old_date then raise exception 'scheduling_existing_official_meeting_count_conflict'; end if;
    protected:=old_date<today or exists(select 1 from public.course_meeting_instructor_history h
      where h.activity_id=a.row_id and h.meeting_date=old_date)
      or exists(select 1 from public.activity_completion_approval_uploads u where u.status='approved'
        and u.activity_date=old_date and
        (u.activity_row_id=a.row_id or (','||u.activity_row_id||',') like ('%,'||a.row_id||',%')))
      or exists(select 1 from public.course_meeting_cancellations c where c.activity_id=a.row_id and c.meeting_date=old_date);
    if protected and (d is distinct from old_date or p_start_time is distinct from a.start_time
      or p_end_time is distinct from a.end_time) then raise exception 'scheduling_historical_meetings_protected'; end if;
    if d<today and d is distinct from old_date then
      policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','scheduling_new_past_date_forbidden','date',d)); end if;
    if extract(dow from d)=6 and coalesce(sector,'') not in ('arab','druze') then
      policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','scheduling_saturday_blocked','date',d)); end if;
    if not public.school_calendar_activity_exception_exists(a.row_id,d) and exists(
      select 1 from public.school_calendar c where c.is_active and c.blocks_scheduling and c.start_date is not null
      and public.school_calendar_event_applies(c.calendar_sector,sector)
      and d between c.start_date and coalesce(c.end_date,c.start_date))
      then policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','scheduling_school_calendar_blocked','date',d)); end if;
    select min(c.school_day_end_time) into shortened from public.school_calendar c
      where c.is_active and c.enforce_end_time and c.school_day_end_time is not null and c.start_date is not null
        and public.school_calendar_event_applies(c.calendar_sector,sector)
        and d between c.start_date and coalesce(c.end_date,c.start_date);
    if shortened is not null and p_end_time>shortened then
      policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','manual_short_school_day',
        'date',d,'schoolEndTime',shortened,'endTime',p_end_time)); end if;
    effective_end:=p_end_time;
    if effective_end is null or effective_end<=p_start_time then raise exception 'scheduling_activity_hours_missing'; end if;
    canonical:=canonical||jsonb_build_array(jsonb_build_object('date',d,'start_time',p_start_time,'end_time',effective_end));
    patch:=patch||jsonb_build_object('date_'||n,d);
    prior:=d;
  end loop;
  -- Never drop a protected date through shortening the list.
  for n in (required_count+1)..35 loop
    if nullif(to_jsonb(a)->>('date_'||n),'') is not null then raise exception 'scheduling_existing_official_meeting_count_conflict'; end if;
    patch:=patch||jsonb_build_object('date_'||n,null);
  end loop;
  if a.emp_id is not null and a.emp_id<>p_emp_id then
    effective:=coalesce(p_effective_from,today);
    if effective<today then raise exception 'scheduling_effective_date_required'; end if;
    if not exists(select 1 from jsonb_array_elements(canonical) x where (x->>'date')::date>=effective)
      then raise exception 'scheduling_no_future_meetings'; end if;
    -- Meetings before the replacement date keep their original position, date and time.
    for n in 1..required_count loop
      old_date:=nullif(to_jsonb(a)->>('date_'||n),'')::date;
      if old_date<effective and ((canonical->(n-1)->>'date')::date is distinct from old_date
        or p_start_time is distinct from a.start_time or p_end_time is distinct from a.end_time)
        then raise exception 'scheduling_historical_meetings_protected'; end if;
    end loop;
  end if;
  proposed:=jsonb_populate_record(a,patch||jsonb_build_object('emp_id',p_emp_id,'instructor_name',i.full_name,
    'draft_emp_id',null,'draft_instructor_name',null,'draft_created_at',null,'draft_created_by',null,
    'draft_proposed_meetings',null,'start_time',p_start_time,'end_time',p_end_time,
    'start_date',canonical->0->>'date','end_date',canonical->(required_count-1)->>'date',
    'instructor_assignment_locked',true,'instructor_assignment_status','שובץ'));
  if public.scheduling_activity_is_full_day_tour(proposed) and (p_start_time<>time '09:00' or p_end_time<>time '14:00')
    then policy_warnings:=policy_warnings||jsonb_build_array(jsonb_build_object('code','scheduling_tour_operational_hours_required')); end if;
  result:=scheduling_manual_private.checks(proposed,p_emp_id,canonical,effective);
  result:=jsonb_set(result,'{warnings}',policy_warnings||(result->'warnings'));
  if nullif(a.emp_id_2,'') is not null then
    secondary:=scheduling_manual_private.checks(proposed,a.emp_id_2::bigint,canonical,null);
    result:=jsonb_build_object('blockers',(result->'blockers')||(secondary->'blockers'),
      'warnings',(result->'warnings')||(secondary->'warnings'));
  end if;
  if intent is not null and (intent->>'empId')::bigint<>p_emp_id then
    result:=jsonb_set(result,'{warnings}',(result->'warnings')||jsonb_build_array(jsonb_build_object(
      'code','manual_intended_instructor_changed','previousEmpId',intent->>'empId','empId',p_emp_id)));
  end if;
  -- A manager may be staged by operations but can only be finally approved by an active admin.
  if p_action='confirm' and scheduling_manual_private.is_management_employee(p_emp_id)
    and not exists(select 1 from public.users u where u.auth_user_id=auth.uid()
      and u.is_active and u.role='admin')
  then result:=jsonb_set(result,'{blockers}',(result->'blockers')||
    jsonb_build_array('scheduling_manager_instructor_admin_approval_required')); end if;
  select jsonb_set(result,'{warnings}',coalesce(jsonb_agg(w order by w),'[]'::jsonb)) into result
    from (select distinct value w from jsonb_array_elements(result->'warnings')) unique_warnings;
  return result||jsonb_build_object('pendingHistory',pending_history,'intent',intent,'activity',to_jsonb(proposed),'meetings',canonical,'patch',patch,
    'expectedUpdatedAt',a.updated_at,'previousEmpId',a.emp_id,'previousInstructorName',a.instructor_name,
    'instructorName',i.full_name,'effectiveFrom',effective,'action',p_action,
    'managementInstructor',scheduling_manual_private.is_management_employee(p_emp_id),
    'managerApprovalRequired',scheduling_manual_private.is_management_employee(p_emp_id) and p_action='draft',
    'reasonRequired',scheduling_manual_private.is_management_employee(p_emp_id)
      or jsonb_array_length(result->'warnings')>0 or a.emp_id is not null);
end $$;

create or replace function public.commit_scheduling_manual_assignment(
  p_activity_id text,p_emp_id bigint,p_meetings jsonb,p_start_time time,p_end_time time,
  p_action text,p_effective_from date,p_expected_updated_at timestamptz,p_preview_hash text,
  p_acknowledge_warnings boolean default false,p_reason text default null)
returns public.activities language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.activities; proposed public.activities; result public.activities;
  preview jsonb; set_clause text; audit_context jsonb; decision_id uuid; old_dates date[]; released_locks jsonb;
begin
  perform scheduling_manual_private.assert_operator();
  -- Same serialization order as source changes and the existing assignment gateway.
  perform pg_advisory_xact_lock(hashtext('scheduling_planning_run'),hashtext('year|'));
  perform public.scheduling_lock_instructor_for_write(p_emp_id);
  select * into a from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if a.emp_id is not null and a.emp_id<>p_emp_id then
    perform public.scheduling_lock_instructor_for_write(a.emp_id); end if;
  preview:=scheduling_manual_private.prepare(p_activity_id,p_emp_id,p_meetings,p_start_time,p_end_time,
    p_action,p_effective_from,p_expected_updated_at);
  if jsonb_array_length(preview->'blockers')>0 then raise exception '%',preview->'blockers'->>0; end if;
  if p_preview_hash is null or md5(preview::text) is distinct from p_preview_hash then
    raise exception 'scheduling_manual_preview_changed' using errcode='PT409'; end if;
  if jsonb_array_length(preview->'warnings')>0 and p_acknowledge_warnings is distinct from true then
    raise exception 'scheduling_manual_acknowledgement_required'; end if;
  if (preview->>'reasonRequired')::boolean and nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'scheduling_reason_required'; end if;
  proposed:=jsonb_populate_record(null::public.activities,preview->'activity');
  -- Replacing a saved intention is an explicit acknowledged warning in this
  -- same preview. It is released transactionally and retained in the audit.
  if preview->'intent' is not null and preview->'intent'<>'null'::jsonb then
    update public.scheduling_instructor_intents set status='released',version=version+1,
      updated_at=clock_timestamp(),updated_by=auth.uid()
      where activity_id=a.row_id and status='active';
  end if;
  if p_action='draft' then
    proposed:=jsonb_populate_record(a,jsonb_build_object('draft_emp_id',p_emp_id::text,
      'draft_instructor_name',preview->>'instructorName','draft_proposed_meetings',preview->'meetings'));
    insert into scheduling_manual_private.decisions(activity_id,emp_id,scope,warnings,actor_id,reason)
      values(a.row_id,p_emp_id,scheduling_manual_private.scope(proposed),preview->'warnings',auth.uid(),p_reason)
      returning id into decision_id;
    update public.activities set draft_emp_id=p_emp_id::text,draft_instructor_name=preview->>'instructorName',
      draft_created_at=clock_timestamp(),draft_created_by=auth.uid(),draft_proposed_meetings=preview->'meetings'
      where row_id=p_activity_id returning * into result;
  else
    -- Pending empty reservations in the confirmed scope become explicit meeting
    -- attributions; the complete previous records are retained in the audit.
    update public.course_meeting_instructor_history set emp_id=p_emp_id::text,instructor_name=preview->>'instructorName',
      assignment_kind='single_meeting_substitution',reason=coalesce(p_reason,'שיבוץ ידני תפעולי'),
      recorded_by=auth.uid(),recorded_at=clock_timestamp(),availability_approval_id=null
      where activity_id=a.row_id and assignment_kind='availability_blocked_pending'
        and meeting_date>=coalesce((preview->>'effectiveFrom')::date,date '2026-09-01');
    -- Attribution is preserved before changing the permanent instructor.
    if a.emp_id is not null and a.emp_id<>p_emp_id then
      insert into public.course_meeting_instructor_history(activity_id,meeting_date,emp_id,instructor_name)
        select a.row_id,nullif(to_jsonb(a)->>('date_'||n),'')::date,a.emp_id::text,a.instructor_name
        from generate_series(1,35) n where nullif(to_jsonb(a)->>('date_'||n),'')::date<(preview->>'effectiveFrom')::date
        on conflict(activity_id,meeting_date) do nothing;
    end if;
    insert into scheduling_manual_private.decisions(activity_id,emp_id,scope,warnings,actor_id,reason)
      values(a.row_id,p_emp_id,scheduling_manual_private.scope(proposed),preview->'warnings',auth.uid(),p_reason)
      returning id into decision_id;
    -- Assignment owns instructor fields only. Official schedule is never written here.
    update public.activities set emp_id=proposed.emp_id,instructor_name=proposed.instructor_name,
      instructor_assignment_locked=true,instructor_assignment_status='שובץ',
      draft_emp_id=null,draft_instructor_name=null,draft_created_at=null,draft_created_by=null,draft_proposed_meetings=null
      where row_id=p_activity_id returning * into result;
  end if;
  -- The operational record supersedes any old proposal lock for this activity.
  -- Release that derived choice only; never recalculate or touch other activities.
  select coalesce(jsonb_agg(jsonb_build_object('workspaceId',r.workspace_id,'lockedOption',r.locked_option)),'[]'::jsonb)
    into released_locks from public.scheduling_planning_rows r where r.activity_id=a.row_id and r.locked_option is not null;
  with released as (
    update public.scheduling_planning_rows set locked_option=null,needs_recalc=true,updated_at=clock_timestamp()
      where activity_id=a.row_id and locked_option is not null returning workspace_id)
  update public.scheduling_planning_workspaces w set revision=w.revision+1,updated_at=clock_timestamp()
    where w.id in (select workspace_id from released);
  audit_context:=jsonb_build_object('releasedPlanningLocks',released_locks,'manualOperatorPolicy','manual-operations-v1','decisionId',decision_id,
    'previousDraft',a.draft_proposed_meetings,'previousPendingHistory',preview->'pendingHistory','previousIntent',preview->'intent','warnings',preview->'warnings','acknowledged',p_acknowledge_warnings,'meetings',preview->'meetings',
    'previousSchedule',scheduling_manual_private.scope(a),'newSchedule',scheduling_manual_private.scope(result));
  insert into public.instructor_assignment_audit(activity_id,selected_emp_id,selected_instructor_name,
    decision_type,reason,selected_by,previous_status,new_status,previous_emp_id,previous_instructor_name,
    meetings_completed_at_decision,effective_from,decision_context)
    values(a.row_id,p_emp_id::text,preview->>'instructorName',
      case when p_action='draft' then 'draft' when a.emp_id is not null and a.emp_id<>p_emp_id
        then 'operational_replacement' else 'approved' end,
      coalesce(nullif(btrim(p_reason),''),'שיבוץ ידני תפעולי'),auth.uid(),
      a.instructor_assignment_status,result.instructor_assignment_status,a.emp_id::text,a.instructor_name,
      public.scheduling_course_meetings_completed(a.row_id),(preview->>'effectiveFrom')::date,audit_context);
  return result;
end $$;

CREATE OR REPLACE FUNCTION public.scheduling_effective_meetings(p_activity activities, p_emp_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(item order by item->>'date'),'[]'::jsonb)
  from (
    select jsonb_build_object(
      'date',(value->>'date')::date,
      'start_time',p_activity.start_time,
      'end_time',public.scheduling_effective_end_time(p_activity.row_id,(value->>'date')::date,p_activity.end_time)
    ) item
    from jsonb_array_elements(public.scheduling_activity_official_meetings(p_activity)) proposed(value)
    where nullif(value->>'date','') is not null
      and not exists(select 1 from public.course_meeting_cancellations c
        where c.activity_id=p_activity.row_id and c.meeting_date=(value->>'date')::date)
      and not exists(select 1 from public.course_meeting_instructor_history h
        where h.activity_id=p_activity.row_id
          and h.meeting_date=(value->>'date')::date
          and h.assignment_kind='availability_blocked_pending'
          and h.emp_id='' and h.previous_emp_id=p_emp_id::text)
  ) effective
$function$;

revoke all on function scheduling_manual_private.draft_matches_official(public.activities) from public,anon,authenticated;

revoke all on function public.scheduling_set_activity_meetings(text,jsonb) from public,anon,authenticated;
