-- Attendance V2 managed operation options and server-trusted travel compensation.
-- Non-destructive: existing attendance rows keep their values and ordinary rows
-- continue to require real clock times.

create extension if not exists pgcrypto;

create table if not exists public.attendance_operation_options (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  is_other boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_operation_options_label_present check (btrim(label) <> '')
);
create unique index if not exists attendance_operation_options_label_unique
  on public.attendance_operation_options (lower(btrim(label)));
create unique index if not exists attendance_operation_options_one_other
  on public.attendance_operation_options (is_other) where is_other;
alter table public.attendance_operation_options enable row level security;
grant select on public.attendance_operation_options to authenticated;

drop policy if exists attendance_operation_options_read on public.attendance_operation_options;
create policy attendance_operation_options_read on public.attendance_operation_options for select to authenticated
using (
  active or exists (
    select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active = true
      and lower(btrim(coalesce(u.role, ''))) in ('admin','operation_manager','activities_manager','finance','manager','instructor_manager')
  )
);

insert into public.attendance_operation_options(label, active, sort_order, is_other)
values ('הרמת כוסית', true, 10, false), ('אחר', true, 999999, true)
on conflict (lower(btrim(label))) do update
set active = excluded.active, sort_order = excluded.sort_order, is_other = excluded.is_other, updated_at = now();

alter table public.attendance_records
  add column if not exists source_attendance_record_id uuid references public.attendance_records(id) on delete cascade,
  add column if not exists generation_kind text;

alter table public.attendance_records drop constraint if exists attendance_records_generation_kind_check;
alter table public.attendance_records add constraint attendance_records_generation_kind_check
  check (generation_kind is null or generation_kind = 'travel_time_cancellation');
alter table public.attendance_records drop constraint if exists attendance_records_generated_shape_check;
alter table public.attendance_records add constraint attendance_records_generated_shape_check check (
  (generation_kind is null and source_attendance_record_id is null and start_time is not null and end_time is not null)
  or
  (generation_kind = 'travel_time_cancellation' and source_attendance_record_id is not null
    and activity_type = 'ביטול זמן' and start_time is null and end_time is null
    and coalesce(roundtrip_km, 0) = 0 and coalesce(expenses, 0) = 0
    and coalesce(public_transport, false) = false and coalesce(public_transport_cost, 0) = 0)
);
create unique index if not exists attendance_records_one_travel_cancellation_per_source
  on public.attendance_records(source_attendance_record_id)
  where generation_kind = 'travel_time_cancellation';
alter table public.attendance_records alter column start_time drop not null;
alter table public.attendance_records alter column end_time drop not null;

create table if not exists public.attendance_travel_compensations (
  source_attendance_record_id uuid primary key references public.attendance_records(id) on delete cascade,
  emp_id bigint not null,
  calculation_status text not null default 'pending',
  route_context_fingerprint text not null,
  origin_entity_key text,
  destination_entity_key text,
  outbound_travel_minutes integer,
  return_travel_minutes integer,
  calculated_cancellation_minutes integer,
  final_cancellation_minutes integer,
  manually_overridden boolean not null default false,
  override_by uuid references auth.users(id),
  override_at timestamptz,
  generated_attendance_record_id uuid unique references public.attendance_records(id) on delete set null,
  failure_code text,
  calculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_travel_status_check check (calculation_status in ('pending','resolved','unavailable')),
  constraint attendance_travel_minutes_nonnegative check (
    coalesce(outbound_travel_minutes,0) >= 0 and coalesce(return_travel_minutes,0) >= 0
    and coalesce(calculated_cancellation_minutes,0) >= 0 and coalesce(final_cancellation_minutes,0) >= 0
  ),
  constraint attendance_travel_resolved_shape check (
    calculation_status <> 'resolved' or
    (outbound_travel_minutes is not null and return_travel_minutes is not null
      and calculated_cancellation_minutes is not null and final_cancellation_minutes is not null)
  ),
  constraint attendance_travel_override_shape check (
    (manually_overridden and override_by is not null and override_at is not null)
    or
    (not manually_overridden and override_by is null and override_at is null
      and (calculation_status <> 'resolved' or final_cancellation_minutes = calculated_cancellation_minutes))
  )
);
alter table public.attendance_travel_compensations enable row level security;
grant select on public.attendance_travel_compensations to authenticated;
drop policy if exists attendance_travel_compensations_read on public.attendance_travel_compensations;
create policy attendance_travel_compensations_read on public.attendance_travel_compensations for select to authenticated
using (
  emp_id = (select u.emp_id::bigint from public.users u where u.auth_user_id = auth.uid() limit 1)
  or exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active = true
    and lower(btrim(coalesce(u.role,''))) in ('admin','operation_manager','finance'))
  or exists (
    select 1 from public.users u join public.contacts_instructors ci on ci.emp_id=attendance_travel_compensations.emp_id
    where u.auth_user_id=auth.uid() and u.is_active=true
      and lower(btrim(coalesce(u.role,''))) in ('activities_manager','manager','instructor_manager')
      and lower(btrim(coalesce(ci.direct_manager,'')))=lower(btrim(coalesce(u.full_name,u.name,u.username,'')))
  )
);

-- Resolve the current route context exclusively from canonical server data.
create or replace function public.av2_attendance_travel_context(p_source_id uuid, p_actor_id uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.attendance_records%rowtype; a public.activities%rowtype; v_emp bigint;
  instructor_address text; destination_address text; school_name text; valid_school boolean := false;
  fingerprint text; excluded_type text;
begin
  select u.emp_id::bigint into v_emp from public.users u where u.auth_user_id = p_actor_id and u.is_active = true limit 1;
  if v_emp is null then raise exception 'attendance_auth_required' using errcode='42501'; end if;
  select * into s from public.attendance_records where id=p_source_id and emp_id=v_emp and generation_kind is null;
  if not found then raise exception 'attendance_source_not_found' using errcode='22023'; end if;
  excluded_type := regexp_replace(lower(btrim(coalesce(s.activity_type,''))), '\s+', '', 'g');
  if excluded_type in ('זום','תפעול','הכשרה','ביטולזמן') or s.activity_row_id is null or s.school_id is null then
    return jsonb_build_object('eligible',false,'source_id',s.id);
  end if;
  select * into a from public.activities where row_id=s.activity_row_id limit 1;
  if not found or not (a.emp_id::text=v_emp::text or a.emp_id_2::text=v_emp::text) then
    return jsonb_build_object('eligible',false,'source_id',s.id);
  end if;
  valid_school := a.school_id = s.school_id or exists (
    select 1 from public.activity_schools x where x.activity_id::text=a.row_id::text and x.school_id=s.school_id
  );
  if not valid_school then raise exception 'attendance_destination_invalid' using errcode='42501'; end if;
  select nullif(btrim(ci.address),'') into instructor_address from public.contacts_instructors ci where ci.emp_id=v_emp limit 1;
  select coalesce(nullif(btrim(cs.address),''), nullif(btrim(sc.institution_address),''), nullif(btrim(sc.mailing_address),'')), sc.school_name
    into destination_address, school_name
  from public.schools sc left join public.contacts_schools cs on cs.school_id=sc.id where sc.id=s.school_id limit 1;
  fingerprint := encode(digest(concat_ws('|',v_emp,lower(regexp_replace(instructor_address,'\s+',' ','g')),
    a.row_id,s.school_id,lower(regexp_replace(destination_address,'\s+',' ','g')),'DRIVE'),'sha256'),'hex');
  return jsonb_build_object('eligible',true,'source_id',s.id,'emp_id',v_emp,'activity_row_id',a.row_id,
    'school_id',s.school_id,'school_name',coalesce(school_name,s.school_name_snapshot,''),
    'origin_address',instructor_address,'destination_address',destination_address,
    'origin_entity_key','instructor:'||v_emp,'destination_entity_key','school_id:'||s.school_id,
    'fingerprint',fingerprint,'report_date',s.report_date,
    'context_error',case when instructor_address is null then 'instructor_address_missing'
      when destination_address is null then 'destination_address_missing' else null end);
end $$;
revoke all on function public.av2_attendance_travel_context(uuid,uuid) from public, anon, authenticated;
grant execute on function public.av2_attendance_travel_context(uuid,uuid) to service_role;

create or replace function public.av2_prepare_attendance_travel(p_source_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ctx jsonb; old public.attendance_travel_compensations%rowtype; changed boolean;
begin
  ctx := public.av2_attendance_travel_context(p_source_id,p_actor_id);
  if not coalesce((ctx->>'eligible')::boolean,false) then
    delete from public.attendance_travel_compensations where source_attendance_record_id=p_source_id;
    return ctx;
  end if;
  select * into old from public.attendance_travel_compensations where source_attendance_record_id=p_source_id for update;
  changed := not found or old.route_context_fingerprint is distinct from ctx->>'fingerprint';
  if changed then
    if old.generated_attendance_record_id is not null then delete from public.attendance_records where id=old.generated_attendance_record_id; end if;
    insert into public.attendance_travel_compensations(source_attendance_record_id,emp_id,calculation_status,route_context_fingerprint,
      origin_entity_key,destination_entity_key,manually_overridden,override_by,override_at,generated_attendance_record_id,failure_code,updated_at)
    values(p_source_id,(ctx->>'emp_id')::bigint,'pending',ctx->>'fingerprint',ctx->>'origin_entity_key',ctx->>'destination_entity_key',false,null,null,null,null,now())
    on conflict(source_attendance_record_id) do update set calculation_status='pending',route_context_fingerprint=excluded.route_context_fingerprint,
      origin_entity_key=excluded.origin_entity_key,destination_entity_key=excluded.destination_entity_key,
      outbound_travel_minutes=null,return_travel_minutes=null,calculated_cancellation_minutes=null,final_cancellation_minutes=null,
      manually_overridden=false,override_by=null,override_at=null,generated_attendance_record_id=null,failure_code=null,updated_at=now();
  end if;
  if changed then
    return ctx || jsonb_build_object('context_changed',true,'calculation_status','pending');
  end if;
  return ctx || (to_jsonb(old) - 'source_attendance_record_id' - 'emp_id') || jsonb_build_object('context_changed',false);
end $$;
revoke all on function public.av2_prepare_attendance_travel(uuid,uuid) from public, anon, authenticated;
grant execute on function public.av2_prepare_attendance_travel(uuid,uuid) to service_role;

create or replace function public.av2_mark_attendance_travel_pending(p_source_id uuid)
returns jsonb language sql security definer set search_path=public as $$
  select public.av2_prepare_attendance_travel(p_source_id,auth.uid()) - 'origin_address' - 'destination_address'
$$;
revoke all on function public.av2_mark_attendance_travel_pending(uuid) from public, anon;
grant execute on function public.av2_mark_attendance_travel_pending(uuid) to authenticated;

create or replace function public.av2_mark_source_travel_pending_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
declare actor_emp bigint;
begin
  if new.generation_kind is not null then return new; end if;
  select emp_id::bigint into actor_emp from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if actor_emp=new.emp_id and (tg_op='INSERT' or old.activity_row_id is distinct from new.activity_row_id
    or old.school_id is distinct from new.school_id or old.activity_type is distinct from new.activity_type) then
    perform public.av2_prepare_attendance_travel(new.id,auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists av2_mark_source_travel_pending on public.attendance_records;
create trigger av2_mark_source_travel_pending after insert or update on public.attendance_records
for each row execute function public.av2_mark_source_travel_pending_trigger();

create or replace function public.av2_reconcile_attendance_travel(p_source_id uuid,p_fingerprint text,p_outbound integer,p_return integer,p_failure_code text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.attendance_travel_compensations%rowtype; s public.attendance_records%rowtype; calculated integer; child uuid;
begin
  perform set_config('app.av2_compensation_write','1',true);
  select * into s from public.attendance_records where id=p_source_id and generation_kind is null for update;
  select * into c from public.attendance_travel_compensations where source_attendance_record_id=p_source_id for update;
  if not found or c.route_context_fingerprint is distinct from p_fingerprint then raise exception 'attendance_travel_context_stale'; end if;
  if p_failure_code is not null then
    if c.generated_attendance_record_id is not null then delete from public.attendance_records where id=c.generated_attendance_record_id; end if;
    update public.attendance_travel_compensations set calculation_status='unavailable',failure_code=left(p_failure_code,80),
      generated_attendance_record_id=null,updated_at=now() where source_attendance_record_id=p_source_id;
    return jsonb_build_object('status','unavailable','failure_code',left(p_failure_code,80));
  end if;
  if p_outbound < 0 or p_return < 0 then raise exception 'attendance_travel_minutes_invalid'; end if;
  calculated := greatest(0,p_outbound-45)+greatest(0,p_return-45);
  if calculated > 0 then
    insert into public.attendance_records(emp_id,report_date,start_time,end_time,total_hours,activity_type,activity_name_snapshot,
      authority_id,authority_name_snapshot,school_id,school_name_snapshot,roundtrip_km,public_transport,public_transport_cost,
      expenses,expense_details,notes,source_attendance_record_id,generation_kind,updated_at)
    values(s.emp_id,s.report_date,null,null,calculated/60.0,'ביטול זמן','ביטול זמן מחושב',s.authority_id,s.authority_name_snapshot,
      s.school_id,s.school_name_snapshot,0,false,0,0,null,null,s.id,'travel_time_cancellation',now())
    on conflict(source_attendance_record_id) where generation_kind='travel_time_cancellation' do update
      set report_date=excluded.report_date,total_hours=excluded.total_hours,school_id=excluded.school_id,
        school_name_snapshot=excluded.school_name_snapshot,authority_id=excluded.authority_id,
        authority_name_snapshot=excluded.authority_name_snapshot,updated_at=now() returning id into child;
  else
    if c.generated_attendance_record_id is not null then delete from public.attendance_records where id=c.generated_attendance_record_id; end if;
    child := null;
  end if;
  update public.attendance_travel_compensations set calculation_status='resolved',outbound_travel_minutes=p_outbound,
    return_travel_minutes=p_return,calculated_cancellation_minutes=calculated,final_cancellation_minutes=calculated,
    manually_overridden=false,override_by=null,override_at=null,generated_attendance_record_id=child,failure_code=null,
    calculated_at=now(),updated_at=now() where source_attendance_record_id=p_source_id returning * into c;
  return to_jsonb(c);
end $$;
revoke all on function public.av2_reconcile_attendance_travel(uuid,text,integer,integer,text) from public, anon, authenticated;
grant execute on function public.av2_reconcile_attendance_travel(uuid,text,integer,integer,text) to service_role;

create or replace function public.av2_override_attendance_time_cancellation(p_source_id uuid,p_final_minutes integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_emp bigint; c public.attendance_travel_compensations%rowtype; s public.attendance_records%rowtype; child uuid;
begin
  perform set_config('app.av2_compensation_write','1',true);
  if p_final_minutes < 0 then raise exception 'attendance_travel_minutes_invalid'; end if;
  select emp_id::bigint into v_emp from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  select * into s from public.attendance_records where id=p_source_id and emp_id=v_emp and generation_kind is null for update;
  if not found or not public.av2_can_write_month(s.report_date) then raise exception 'attendance_month_locked' using errcode='42501'; end if;
  select * into c from public.attendance_travel_compensations where source_attendance_record_id=p_source_id and calculation_status='resolved' for update;
  if not found then raise exception 'attendance_travel_not_resolved'; end if;
  if p_final_minutes > 0 then
    insert into public.attendance_records(emp_id,report_date,start_time,end_time,total_hours,activity_type,activity_name_snapshot,
      authority_id,authority_name_snapshot,school_id,school_name_snapshot,roundtrip_km,public_transport,public_transport_cost,expenses,
      source_attendance_record_id,generation_kind,updated_at)
    values(s.emp_id,s.report_date,null,null,p_final_minutes/60.0,'ביטול זמן','ביטול זמן מחושב',s.authority_id,s.authority_name_snapshot,
      s.school_id,s.school_name_snapshot,0,false,0,0,s.id,'travel_time_cancellation',now())
    on conflict(source_attendance_record_id) where generation_kind='travel_time_cancellation' do update
      set total_hours=excluded.total_hours,report_date=excluded.report_date,school_id=excluded.school_id,
        school_name_snapshot=excluded.school_name_snapshot,updated_at=now() returning id into child;
  else
    if c.generated_attendance_record_id is not null then delete from public.attendance_records where id=c.generated_attendance_record_id; end if;
  end if;
  update public.attendance_travel_compensations set final_cancellation_minutes=p_final_minutes,
    manually_overridden=(p_final_minutes<>calculated_cancellation_minutes),
    override_by=case when p_final_minutes<>calculated_cancellation_minutes then auth.uid() else null end,
    override_at=case when p_final_minutes<>calculated_cancellation_minutes then now() else null end,
    generated_attendance_record_id=child,updated_at=now() where source_attendance_record_id=p_source_id returning * into c;
  return to_jsonb(c);
end $$;
revoke all on function public.av2_override_attendance_time_cancellation(uuid,integer) from public, anon;
grant execute on function public.av2_override_attendance_time_cancellation(uuid,integer) to authenticated;

create or replace function public.av2_attendance_month_travel_issues(p_emp_id bigint,p_month_key text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('source_id',s.id,'date',s.report_date,'activity',coalesce(s.activity_name_snapshot,s.activity_type),
    'reason',case when c.source_attendance_record_id is null then 'missing' when c.calculation_status<>'resolved' then c.calculation_status
      when c.final_cancellation_minutes>0 and (g.id is null or abs(g.total_hours-(c.final_cancellation_minutes/60.0))>0.0001) then 'generated_row_inconsistent'
      when c.final_cancellation_minutes=0 and g.id is not null then 'generated_zero_inconsistent' else 'stale' end)), '[]'::jsonb)
  into result
  from public.attendance_records s
  cross join lateral public.av2_attendance_travel_context(s.id,auth.uid()) ctx
  left join public.attendance_travel_compensations c on c.source_attendance_record_id=s.id
  left join public.attendance_records g on g.id=c.generated_attendance_record_id and g.generation_kind='travel_time_cancellation'
  where s.emp_id=p_emp_id and s.generation_kind is null and to_char(s.report_date,'YYYY-MM')=p_month_key
    and regexp_replace(lower(btrim(coalesce(s.activity_type,''))),'\s+','','g') not in ('זום','תפעול','הכשרה','ביטולזמן')
    and s.activity_row_id is not null and s.school_id is not null and coalesce((ctx->>'eligible')::boolean,false)
    and (c.source_attendance_record_id is null or c.calculation_status<>'resolved'
      or c.route_context_fingerprint is distinct from (ctx->>'fingerprint')
      or (c.final_cancellation_minutes>0 and (g.id is null or abs(g.total_hours-(c.final_cancellation_minutes/60.0))>0.0001))
      or (c.final_cancellation_minutes=0 and g.id is not null));
  return result;
end $$;
revoke all on function public.av2_attendance_month_travel_issues(bigint,text) from public, anon, authenticated;
grant execute on function public.av2_attendance_month_travel_issues(bigint,text) to service_role;

create or replace function public.av2_submit_attendance_month(p_month_key text,p_submitted_by_name text default null)
returns public.attendance_month_approvals language plpgsql security definer set search_path=public as $$
declare v_emp bigint; issues jsonb; saved public.attendance_month_approvals%rowtype;
begin
  if coalesce(p_month_key,'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_month_key'; end if;
  select emp_id::bigint into v_emp from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_emp is null then raise exception 'attendance_auth_required' using errcode='42501'; end if;
  perform 1 from public.attendance_records where emp_id=v_emp and to_char(report_date,'YYYY-MM')=p_month_key for update;
  issues := public.av2_attendance_month_travel_issues(v_emp,p_month_key);
  if jsonb_array_length(issues)>0 then raise exception 'attendance_travel_compensation_unresolved:%',issues using errcode='55000'; end if;
  insert into public.attendance_month_approvals(emp_id,month_key,status,submitted_at,submitted_by_name,updated_at)
  values(v_emp,p_month_key,'submitted',now(),btrim(coalesce(p_submitted_by_name,'')),now())
  on conflict(emp_id,month_key) do update set status='submitted',submitted_at=now(),submitted_by_name=excluded.submitted_by_name,updated_at=now()
  returning * into saved;
  return saved;
end $$;
revoke all on function public.av2_submit_attendance_month(text,text) from public, anon;
grant execute on function public.av2_submit_attendance_month(text,text) to authenticated;

create or replace function public.av2_guard_attendance_submission_travel()
returns trigger language plpgsql security definer set search_path=public as $$
declare actor_emp bigint; issues jsonb;
begin
  if new.status='submitted' and (tg_op='INSERT' or old.status is distinct from 'submitted') then
    select emp_id::bigint into actor_emp from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
    if actor_emp is not null and actor_emp=new.emp_id then
      issues:=public.av2_attendance_month_travel_issues(new.emp_id,new.month_key);
      if jsonb_array_length(issues)>0 then raise exception 'attendance_travel_compensation_unresolved:%',issues using errcode='55000'; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists av2_guard_attendance_submission_travel on public.attendance_month_approvals;
create trigger av2_guard_attendance_submission_travel before insert or update on public.attendance_month_approvals
for each row execute function public.av2_guard_attendance_submission_travel();

-- Generated rows are maintained only by the protected compensation functions.
create or replace function public.av2_guard_generated_attendance_mutation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op in ('INSERT','UPDATE') and new.generation_kind='travel_time_cancellation'
    and current_setting('app.av2_compensation_write',true) is distinct from '1' then
    raise exception 'attendance_generated_record_protected' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists av2_guard_generated_attendance_mutation on public.attendance_records;
create trigger av2_guard_generated_attendance_mutation before insert or update or delete on public.attendance_records
for each row execute function public.av2_guard_generated_attendance_mutation();

drop policy if exists av2_ar_insert on public.attendance_records;
drop policy if exists av2_ar_update on public.attendance_records;
drop policy if exists av2_ar_delete on public.attendance_records;
create policy av2_ar_insert on public.attendance_records for insert with check (
  generation_kind is null and source_attendance_record_id is null
  and emp_id=(select emp_id::bigint from public.users where auth_user_id=auth.uid() limit 1)
  and public.av2_can_write_month(report_date)
);
create policy av2_ar_update on public.attendance_records for update using (
  generation_kind is null and emp_id=(select emp_id::bigint from public.users where auth_user_id=auth.uid() limit 1)
  and public.av2_can_write_month(report_date)
) with check (generation_kind is null and source_attendance_record_id is null
  and emp_id=(select emp_id::bigint from public.users where auth_user_id=auth.uid() limit 1)
  and public.av2_can_write_month(report_date));
create policy av2_ar_delete on public.attendance_records for delete using (
  generation_kind is null and emp_id=(select emp_id::bigint from public.users where auth_user_id=auth.uid() limit 1)
  and public.av2_can_write_month(report_date)
);

create or replace function public.av2_guard_generated_attendance_attachment()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.attendance_records r where r.id=new.record_id and r.generation_kind='travel_time_cancellation') then
    raise exception 'attendance_generated_record_attachments_forbidden' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists av2_guard_generated_attendance_attachment on public.attendance_record_attachments;
create trigger av2_guard_generated_attendance_attachment before insert or update on public.attendance_record_attachments
for each row execute function public.av2_guard_generated_attendance_attachment();

create or replace function public.get_payroll_attendance_travel_compensations(
  p_employee_ids bigint[] default null, p_from_date date default null, p_to_date date default null
) returns table(
  generated_record_id uuid, source_record_id uuid, outbound_travel_minutes integer,
  return_travel_minutes integer, calculated_cancellation_minutes integer,
  final_cancellation_minutes integer, manually_overridden boolean,
  override_by_name text, override_at timestamptz
) language sql stable security definer set search_path=public as $$
  with visible as (
    select record_id from public.get_payroll_attendance_records(p_employee_ids,p_from_date,p_to_date)
  )
  select c.generated_attendance_record_id,c.source_attendance_record_id,c.outbound_travel_minutes,
    c.return_travel_minutes,c.calculated_cancellation_minutes,c.final_cancellation_minutes,c.manually_overridden,
    coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.name),''),nullif(btrim(u.username),''),''),c.override_at
  from public.attendance_travel_compensations c
  join visible v on v.record_id=c.generated_attendance_record_id
  left join public.users u on u.auth_user_id=c.override_by
$$;
revoke all on function public.get_payroll_attendance_travel_compensations(bigint[],date,date) from public,anon;
grant execute on function public.get_payroll_attendance_travel_compensations(bigint[],date,date) to authenticated;
