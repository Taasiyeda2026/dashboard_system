-- Guard a submitted route against later scheduling changes.
create or replace function public.av2_daily_travel_route_matches(
  p_emp_id bigint,p_date date,p_legs jsonb
) returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_ids text[];v_n integer;v_i integer;v_leg jsonb;
begin
  if p_legs is null or jsonb_typeof(p_legs)<>'array' then return false; end if;
  select array_agg(a.id::text order by a.start_time,a.id) into v_ids
  from public.attendance_records a
  where a.emp_id=p_emp_id and a.report_date=p_date and a.generation_kind is null
    and a.activity_type not in ('זום','ביטול זמן')
    and coalesce(a.training_mode::text,'physical')<>'online'
    and coalesce(a.operation_meeting_mode,'physical')<>'online';
  v_n:=coalesce(cardinality(v_ids),0);
  if v_n=0 or jsonb_array_length(p_legs)<>v_n+1 then return false; end if;
  for v_i in 0..v_n loop
    v_leg:=p_legs->v_i;
    if v_i=0 then
      if v_leg->>'kind'<>'outbound' or v_leg->>'toRecordId' is distinct from v_ids[1]
        or v_leg->>'fromRecordId' is not null then return false; end if;
    elsif v_i=v_n then
      if v_leg->>'kind'<>'return' or v_leg->>'fromRecordId' is distinct from v_ids[v_n]
        or v_leg->>'toRecordId' is not null then return false; end if;
    else
      if v_leg->>'kind'<>'between'
        or v_leg->>'fromRecordId' is distinct from v_ids[v_i]
        or v_leg->>'toRecordId' is distinct from v_ids[v_i+1] then return false; end if;
    end if;
  end loop;
  return true;
end $$;
revoke all on function public.av2_daily_travel_route_matches(bigint,date,jsonb) from public,anon,authenticated;

create table if not exists public.attendance_daily_travel_audit (
  id bigint generated always as identity primary key,
  emp_id bigint not null,
  travel_date date not null,
  previous_status text not null,
  previous_approved_km numeric,
  previous_approved_cancellation_minutes integer,
  reason text not null,
  actor uuid,
  changed_at timestamptz not null default now()
);
alter table public.attendance_daily_travel_audit enable row level security;
revoke all on public.attendance_daily_travel_audit from anon,authenticated;
grant all on public.attendance_daily_travel_audit to service_role;

create or replace function public.av2_invalidate_daily_travel_after_activity_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_emp bigint;v_date date;v_old public.attendance_daily_travel_reports%rowtype;
begin
  if tg_op='UPDATE' and old.generation_kind is null and new.generation_kind is null
    and old.report_date is not distinct from new.report_date
    and old.start_time is not distinct from new.start_time
    and old.end_time is not distinct from new.end_time
    and old.activity_type is not distinct from new.activity_type
    and old.school_id is not distinct from new.school_id
    and old.school_name_snapshot is not distinct from new.school_name_snapshot
    and old.destination_address_snapshot is not distinct from new.destination_address_snapshot
    and old.training_mode is not distinct from new.training_mode
    and old.operation_meeting_mode is not distinct from new.operation_meeting_mode
  then return new; end if;
  if tg_op='INSERT' and new.generation_kind is not null then return new; end if;
  if tg_op='DELETE' and old.generation_kind is not null then return old; end if;
  if tg_op='UPDATE' and (old.generation_kind is not null or new.generation_kind is not null)
    then return new; end if;

  for v_emp,v_date in
    select distinct x.emp,x.travel_day from (
      select case when tg_op<>'INSERT' then old.emp_id else null end emp,
             case when tg_op<>'INSERT' then old.report_date else null end travel_day
      union all
      select case when tg_op<>'DELETE' then new.emp_id else null end,
             case when tg_op<>'DELETE' then new.report_date else null end
    ) x where x.emp is not null and x.travel_day >= date '2026-11-04'
  loop
    select * into v_old from public.attendance_daily_travel_reports
      where emp_id=v_emp and travel_date=v_date
        and review_status in ('approved','corrected')
      for update;
    if found then
      insert into public.attendance_daily_travel_audit(
        emp_id,travel_date,previous_status,previous_approved_km,
        previous_approved_cancellation_minutes,reason,actor)
      values(v_emp,v_date,v_old.review_status,v_old.approved_km,
        v_old.approved_cancellation_minutes,'activity_changed',auth.uid());
      update public.attendance_daily_travel_reports
      set review_status='pending_review',approved_km=null,
        approved_cancellation_minutes=null,review_by=null,review_at=null,updated_at=now()
      where id=v_old.id;
      perform set_config('app.av2_compensation_write','1',true);
      delete from public.attendance_records
      where emp_id=v_emp and report_date=v_date
        and generation_kind='daily_travel_cancellation';
    end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists av2_invalidate_daily_travel_after_activity_change on public.attendance_records;
create trigger av2_invalidate_daily_travel_after_activity_change
after insert or update or delete on public.attendance_records
for each row execute function public.av2_invalidate_daily_travel_after_activity_change();
