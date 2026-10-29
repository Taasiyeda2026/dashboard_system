do $$ begin
if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role',true),''),'authenticated') $$;
create function public.app_current_role() returns text language sql stable as $$ select current_setting('test.app_role',true) $$;
create function public.app_has_permission(text) returns boolean language sql stable as $$ select coalesce(current_setting('test.permission',true),'false')::boolean $$;
create function public.app_can_access_finance() returns boolean language sql stable as $$ select coalesce(public.app_current_role()='admin' or public.app_has_permission('finance_access'),false) $$;
create table public.authorities(id bigint primary key,authority_name text);
create table public.schools(id bigint primary key,semel_mosad text);
create table public.course_meeting_cancellations(activity_id text,meeting_date date);
create table public.funding_sources(id uuid primary key,name text);
create table public.activities(id bigint primary key,row_id text unique,school_id bigint,authority_id bigint,school text,authority text,contact_email text,funding text,price bigint,sessions text,end_time time,activity_name text,activity_no text,status text,date_1 date,date_2 date,date_3 date,date_4 date,date_5 date,date_6 date,date_7 date,date_8 date,date_9 date,date_10 date,date_11 date,date_12 date,date_13 date,date_14 date,date_15 date,date_16 date,date_17 date,date_18 date,date_19 date,date_20 date,date_21 date,date_22 date,date_23 date,date_24 date,date_25 date,date_26 date,date_27 date,date_28 date,date_29 date,date_30 date,date_31 date,date_32 date,date_33 date,date_34 date,date_35 date);
create table public.activity_funding_sources(activity_id bigint references public.activities(id),funding_source_id uuid references public.funding_sources(id),amount numeric,primary key(activity_id,funding_source_id));
grant usage on schema public,auth to authenticated,anon,service_role;
