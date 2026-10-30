-- Disposable PostgreSQL fixture. No production connection or production rows.
create schema auth;
create schema extensions;
do $$ begin
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
end $$;
create function auth.uid() returns uuid language sql stable as $$
  select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
$$;
create table users (emp_id bigint, auth_user_id uuid, is_active boolean, role text);
insert into users values (1, auth.uid(), true, 'instructor');
create table attendance_records (
  id uuid primary key default gen_random_uuid(), emp_id bigint, report_date date,
  start_time time, end_time time, total_hours numeric, activity_type text,
  activity_name_snapshot text, program_name text, authority_id bigint,
  authority_name_snapshot text, school_id bigint, school_name_snapshot text,
  semel_mosad bigint, roundtrip_km numeric default 0, public_transport boolean default false,
  public_transport_cost numeric default 0, expenses numeric default 0, expense_details text,
  notes text, generation_kind text, source_attendance_record_id uuid,
  destination_address_snapshot text, training_mode text, training_schedule_id uuid,
  operation_meeting_mode text, cancellation_before_minutes integer,
  cancellation_after_minutes integer, updated_at timestamptz default now()
);
create unique index one_generated on attendance_records(source_attendance_record_id)
  where generation_kind='travel_time_cancellation';
create table attendance_travel_compensations (
  source_attendance_record_id uuid primary key, emp_id bigint,
  calculation_status text default 'pending', route_context_fingerprint text,
  origin_entity_key text, destination_entity_key text,
  outbound_travel_minutes integer, return_travel_minutes integer,
  calculated_cancellation_minutes integer, final_cancellation_minutes integer,
  manually_overridden boolean default false, override_by uuid, override_at timestamptz,
  generated_attendance_record_id uuid, failure_code text, calculated_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  reported_outbound_minutes integer, reported_return_minutes integer,
  reported_at timestamptz, reported_by uuid, system_distance_km numeric,
  review_status text default 'none', approved_cancellation_minutes integer,
  review_by uuid, review_at timestamptz, review_note text,
  constraint attendance_travel_resolved_shape check (
    calculation_status <> 'resolved' or (outbound_travel_minutes is not null
      and return_travel_minutes is not null and calculated_cancellation_minutes is not null
      and final_cancellation_minutes is not null)
  )
);
create table attendance_travel_compensation_events (
  source_attendance_record_id uuid, emp_id bigint, event_type text,
  actor_user_id uuid, actor_role text, before_json jsonb, after_json jsonb, note text
);
create table instructor_training_schedule (
  id uuid, emp_id bigint, is_active boolean, training_date date, participant_scope text,
  is_online boolean, location_name text, location_address text
);
create table attendance_operation_options (label text, address text);
create table contacts_instructors (emp_id bigint, address text);
create table schools (id bigint, institution_address text, mailing_address text);
create table contacts_schools (school_id bigint, address text);
insert into contacts_instructors values (1, 'home');
insert into schools values (10, 'school', null);

-- Authorization/context boundaries are isolated here; the changed prepare,
-- reconcile, review calculations and payable sync are loaded from real SQL.
create function av2_attendance_travel_context(p_source_id uuid,p_actor_id uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('eligible',true,'source_id',id,'emp_id',emp_id,
    'origin_entity_key','instructor:1','destination_entity_key','school_id:10',
    'fingerprint',coalesce(nullif(current_setting('test.fingerprint',true),''),'fp'))
  from attendance_records where id=p_source_id
$$;
create function get_payroll_attendance_records(bigint[],date,date) returns table(record_id uuid)
language sql stable as $$
  select id from attendance_records
  where ($1 is null or emp_id=any($1)) and ($2 is null or report_date >= $2)
    and ($3 is null or report_date <= $3)
$$;
