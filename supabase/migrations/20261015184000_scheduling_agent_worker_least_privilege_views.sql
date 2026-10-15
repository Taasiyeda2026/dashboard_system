-- Narrow, machine-only scheduling views. Never grant source table SELECT
-- or expose payroll, financials, contact details or staff permissions.
CREATE OR REPLACE VIEW public.scheduling_agent_worker_workspaces WITH (security_barrier=true) AS
 SELECT id,period_key,district,revision,engine_version,validated_source_revision
 FROM public.scheduling_planning_workspaces;
CREATE OR REPLACE VIEW public.scheduling_agent_worker_rows WITH (security_barrier=true) AS
 SELECT workspace_id,activity_id,row_data,activity_updated_at,locked_option,needs_recalc
 FROM public.scheduling_planning_rows;
CREATE OR REPLACE VIEW public.scheduling_agent_worker_profiles WITH (security_barrier=true) AS
 SELECT emp_id,default_start_time,default_end_time,friday_allowed,gender,
 instruction_languages,education_levels,course_restriction_mode,course_ids,
 blocked_authorities,blocked_schools,matching_note,weekly_target_hours,weekly_max_hours,
 preferred_work_days,max_fixed_courses FROM public.instructor_scheduling_profiles;
CREATE OR REPLACE VIEW public.scheduling_agent_worker_rules WITH (security_barrier=true) AS
 SELECT emp_id,weekday,available,start_time,end_time,notes FROM public.instructor_availability_rules;
CREATE OR REPLACE VIEW public.scheduling_agent_worker_exceptions WITH (security_barrier=true) AS
 SELECT emp_id,exception_date,available,start_time,end_time,notes FROM public.instructor_availability_exceptions;
CREATE OR REPLACE VIEW public.scheduling_agent_worker_calendar WITH (security_barrier=true) AS
 SELECT external_key,title,category,calendar_sector,start_date,end_date,resume_date,
 day_status,school_day_end_time,blocks_scheduling,enforce_end_time,
 show_on_main_calendar,is_active FROM public.school_calendar
 WHERE is_active=true AND show_on_main_calendar=true;
CREATE OR REPLACE VIEW public.scheduling_agent_worker_catalog WITH (security_barrier=true) AS
 SELECT activity_name,activity_no,gefen_number,pricing_key,program_name,name,title,
 meetings_count,hours_count,unit_duration,is_active_for_proposals
 FROM public.proposal_activity_pricing;
CREATE OR REPLACE VIEW public.scheduling_agent_worker_history WITH (security_barrier=true) AS
 SELECT activity_id,meeting_date,emp_id FROM public.course_meeting_instructor_history
 WHERE meeting_date BETWEEN DATE '2026-09-01' AND DATE '2027-06-30';

DO $permissions$
DECLARE v_name text;
BEGIN
 FOREACH v_name IN ARRAY ARRAY[
   'scheduling_agent_worker_workspaces','scheduling_agent_worker_rows',
   'scheduling_agent_worker_profiles','scheduling_agent_worker_rules',
   'scheduling_agent_worker_exceptions','scheduling_agent_worker_calendar',
   'scheduling_agent_worker_catalog','scheduling_agent_worker_history'
 ] LOOP
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',v_name);
   EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role',v_name);
 END LOOP;
END $permissions$;
NOTIFY pgrst,'reload schema';
