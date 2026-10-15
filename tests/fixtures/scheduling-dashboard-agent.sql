-- Synthetic domain dependencies only. Not production data or v38 certification.
do $$begin
 if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
end$$;
create schema auth;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table users(auth_user_id uuid,is_active boolean,role text,allowed boolean);
create function app_has_permission(text) returns boolean language sql as $$select coalesce((select allowed from users where auth_user_id=auth.uid()),false)$$;
create table activities(row_id text primary key,emp_id bigint,updated_at timestamptz,draft_emp_id text);
create table scheduling_planning_workspaces(id uuid,period_key text,district text,revision bigint,validated_source_revision bigint,engine_version text);
create table scheduling_planning_rows(workspace_id uuid,activity_id text,row_data jsonb,needs_recalc boolean);
create table scheduling_planning_source_state(singleton boolean,revision bigint);
create table contacts_instructors(emp_id bigint,full_name text,active text);
create table edit_requests(id bigint,source_row_id text,request_type text,status text,active text,requested_payload jsonb,created_at timestamptz);
create table instructor_assignment_audit(id bigint,activity_id text,decision_type text,reason text,created_at timestamptz);
create table fixture_guard(code text);insert into fixture_guard values(null);
create table fixture_calls(name text);
create function scheduling_lock_instructor_for_write(bigint) returns void language sql as $$select$$;
create function scheduling_course_instructor_violations(text,bigint,boolean) returns text[] language sql as $$select case when code is null then '{}'::text[] else array[code] end from fixture_guard$$;
create function scheduling_assert_proposed_eligibility(text,bigint,jsonb) returns void language plpgsql as $$declare c text;begin select code into c from fixture_guard;if c is not null then raise exception '%',c;end if;end$$;
create function fixture_apply(n text,aid text,emp bigint) returns activities language plpgsql as $$declare a activities; c text;begin
 select code into c from fixture_guard;
 if c is not null then raise exception '%',c;end if;
 insert into fixture_calls values(n);
 update activities set emp_id=coalesce(emp,emp_id),updated_at=clock_timestamp() where row_id=aid returning * into a;return a;
end$$;
create function save_course_assignment_draft(p_activity_id text,p_emp_id bigint,p_instructor_name text,p_top_emp_id bigint,p_selected_score integer,p_top_score integer) returns activities language sql as $$select fixture_apply('save_course_assignment_draft',p_activity_id,p_emp_id)$$;
create function save_course_assignment_draft_with_dates(p_activity_id text,p_emp_id bigint,p_instructor_name text,p_proposed_meetings jsonb,p_top_emp_id bigint,p_selected_score integer,p_top_score integer) returns activities language sql as $$select fixture_apply('save_course_assignment_draft_with_dates',p_activity_id,p_emp_id)$$;
create function save_course_assignment_manual_draft(p_activity_id text,p_emp_id bigint,p_instructor_name text,p_top_emp_id bigint,p_selected_score integer,p_top_score integer,p_reason text) returns activities language sql as $$select fixture_apply('save_course_assignment_manual_draft',p_activity_id,p_emp_id)$$;
create function assign_activity_instructor(p_activity_id text,p_emp_id bigint,p_instructor_name text,p_top_emp_id bigint,p_selected_score integer,p_top_score integer,p_decision_type text,p_reason text) returns activities language sql as $$select fixture_apply('assign_activity_instructor',p_activity_id,p_emp_id)$$;
create function assign_activity_instructor_with_dates(p_activity_id text,p_emp_id bigint,p_instructor_name text,p_proposed_meetings jsonb,p_top_emp_id bigint,p_selected_score integer,p_top_score integer,p_decision_type text,p_reason text) returns activities language sql as $$select fixture_apply('assign_activity_instructor_with_dates',p_activity_id,p_emp_id)$$;
create function reassign_locked_course_instructor(p_activity_id text,p_new_emp_id bigint,p_new_instructor_name text,p_top_emp_id bigint,p_selected_score integer,p_top_score integer,p_decision_type text,p_reason text) returns activities language sql as $$select fixture_apply('reassign_locked_course_instructor',p_activity_id,p_new_emp_id)$$;
create function replace_locked_course_instructor(p_activity_id text,p_new_emp_id bigint,p_new_instructor_name text,p_effective_from date,p_reason text) returns activities language sql as $$select fixture_apply('replace_locked_course_instructor',p_activity_id,p_new_emp_id)$$;
create function cancel_course_assignment_draft(p_activity_id text) returns activities language sql as $$select fixture_apply('cancel_course_assignment_draft',p_activity_id,null)$$;
create function cancel_confirmed_course_assignment(p_activity_id text,p_reason text) returns activities language sql as $$select fixture_apply('cancel_confirmed_course_assignment',p_activity_id,null)$$;
