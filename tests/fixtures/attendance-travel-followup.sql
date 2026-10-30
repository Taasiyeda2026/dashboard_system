-- Complements attendance-travel-2523.sql in a disposable database only.
create schema attendance_private;
create extension pgcrypto with schema extensions;
create or replace function auth.uid() returns uuid language sql stable as $$
  select case when current_setting('test.actor',true)='none' then null
    else 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid end
$$;
alter table users alter column emp_id type text using emp_id::text;
alter table users add full_name text default 'Manager',add name text,add username text;
update users set role='admin';
alter table contacts_instructors add full_name text,add direct_manager text default 'Manager',
  add active text default 'yes',add employment_type text;
alter table schools add school_name text,add route_verified_address text,add city text,
  add authority_id bigint,add authority text,add semel_mosad bigint,add district text,add active text;
alter table attendance_records add activity_row_id text,add course_business_identity jsonb,
  add course_dashboard_sources jsonb;
create table activities (
 row_id text primary key,id bigint,emp_id bigint,emp_id_2 text,school_id bigint,
 activity_no text,activity_name text,activity_type text default 'course',activity_season text,
 program_name text,start_time time,end_time time,start_date date,end_date date,
 grade text,class_group text,authority_id bigint
);
do $$ begin
  for i in 1..35 loop execute format('alter table activities add date_%s date',i); end loop;
end $$;
create view activities_directory_view as select a.*,
 s.school_name single_school_name,a.school_id single_school_id,s.semel_mosad single_semel_mosad,
 'single_school'::text school_link_status,null::jsonb linked_schools_json,'Authority'::text authority_name
 from activities a left join schools s on s.id=a.school_id;
create table course_meeting_cancellations(activity_id text,meeting_date date);
create table course_meeting_instructor_history(activity_id text,meeting_date date,emp_id text);
create table activity_schools(activity_id text,school_id bigint);
create table scheduling_travel_cache (
 origin_key text,destination_key text,origin_address text,destination_address text,
 distance_km numeric,duration_minutes integer,location_suspect boolean default false,
 origin_school_id bigint,destination_school_id bigint,origin_instructor_emp_id bigint,
 origin_entity_key text,destination_entity_key text,calculated_at timestamptz default now(),
 primary key(origin_key,destination_key)
);
drop function get_payroll_attendance_records(bigint[],date,date);
create function get_payroll_attendance_records(bigint[],date,date)
returns table(record_id uuid,attendance_date date,start_time time) language plpgsql stable as $$
begin
 if auth.uid() is null then raise exception 'payroll_attendance_auth_required' using errcode='42501'; end if;
 return query select a.id,a.report_date,a.start_time from attendance_records a
 join contacts_instructors c on c.emp_id=a.emp_id
 where ($1 is null or a.emp_id=any($1)) and ($2 is null or a.report_date >= $2)
   and ($3 is null or a.report_date <= $3)
   and (exists(select from users u where u.auth_user_id=auth.uid() and u.is_active and u.role='admin')
     or c.direct_manager='Manager');
end $$;
create function get_payroll_attendance_travel_compensations(bigint[],date,date)
returns setof attendance_travel_compensations language sql stable as $$
 select c.* from attendance_travel_compensations c
 join get_payroll_attendance_records($1,$2,$3) r on r.record_id=c.source_attendance_record_id
$$;
create table personal_reports(id uuid,employee_id uuid);
create table expense_entries(id uuid,report_id uuid,employee_id uuid,expense_date date,
 amount numeric,description text,notes text);
alter table instructor_training_schedule add start_time time,add course_name text;
create table payroll_control_approvals(employee_id text,month_key text,status text,approved_at timestamptz);
create function get_payroll_attendance_month_statuses(text,text[])
returns table(employee_id text) language sql stable as $$ select unnest($2) $$;
create table authorities(id bigint,authority_name text,authority_code text,authority_type text,
 long_name text,district text,active text);
create table proposal_group_aliases(alias_name text,group_key text,is_active boolean);
