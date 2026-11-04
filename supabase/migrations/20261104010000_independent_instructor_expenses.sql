-- Independent instructor expenses. Not tied to an attendance record or a specific activity.
-- Existing attendance expenses and attachments remain intact for historic months.
create table if not exists public.attendance_expense_reports (
 id uuid primary key default gen_random_uuid(),
 emp_id bigint not null,
 expense_date date not null,
 amount numeric(12,2) not null check(amount > 0 and amount <= 100000),
 details text not null check(length(btrim(details)) between 2 and 2000),
 review_status text not null default 'pending_review'
    check(review_status in ('pending_review','approved','rejected')),
 approved_amount numeric(12,2) check(approved_amount is null or approved_amount between 0 and 100000),
 reviewed_by uuid,
 reviewed_at timestamptz,
 created_by uuid not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists attendance_expenses_month_by_employee
  on public.attendance_expense_reports(emp_id,expense_date);
alter table public.attendance_expense_reports enable row level security;
revoke all on public.attendance_expense_reports from anon,authenticated;
grant all on public.attendance_expense_reports to service_role;

create table if not exists public.attendance_expense_attachments (
 id uuid primary key default gen_random_uuid(),
 expense_id uuid not null references public.attendance_expense_reports(id) on delete cascade,
 emp_id bigint not null,
 storage_path text not null unique,
 file_name text not null,
 file_type text,
 file_size bigint check(file_size is null or file_size between 0 and 10485760),
 created_at timestamptz not null default now()
);
create index if not exists attendance_expense_attachments_report_id on public.attendance_expense_attachments(expense_id);
alter table public.attendance_expense_attachments enable row level security;
revoke all on public.attendance_expense_attachments from anon,authenticated;
grant all on public.attendance_expense_attachments to service_role;

create or replace function public.av2_expense_instructor_id() returns bigint
language sql stable security definer set search_path=public as $$
  select u.emp_id::bigint from public.users u
  where u.auth_user_id=auth.uid() and u.is_active=true and u.role='instructor'
  limit 1
$$;
revoke all on function public.av2_expense_instructor_id() from public,anon,authenticated;

create or replace function public.av2_save_expense(
 p_expense_date date,p_amount numeric,p_details text,p_expense_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_emp bigint;v_row public.attendance_expense_reports%rowtype;
begin
 v_emp:=public.av2_expense_instructor_id();
 if v_emp is null then raise exception 'expense_instructor_required' using errcode='42501';end if;
 if p_expense_date is null or p_expense_date < date '2026-11-04'
    or not public.av2_can_write_month(p_expense_date) then
    raise exception 'expense_month_locked' using errcode='42501';end if;
 if p_amount is null or p_amount<=0 or p_amount>100000
    or length(btrim(coalesce(p_details,''))) not between 2 and 2000 then
    raise exception 'expense_invalid' using errcode='22023';end if;
 if p_expense_id is null then
   insert into public.attendance_expense_reports(emp_id,expense_date,amount,details,created_by)
   values(v_emp,p_expense_date,p_amount,btrim(p_details),auth.uid()) returning * into v_row;
 else
   update public.attendance_expense_reports
     set expense_date=p_expense_date,amount=p_amount,details=btrim(p_details),
     updated_at=now()
   where id=p_expense_id and emp_id=v_emp and review_status in ('pending_review','rejected')
   returning * into v_row;
   if not found then raise exception 'expense_not_editable' using errcode='42501';end if;
   update public.attendance_expense_reports set review_status='pending_review',
      approved_amount=null,reviewed_by=null,reviewed_at=null where id=v_row.id;
 end if;
 return jsonb_build_object('id',v_row.id,'expense_date',v_row.expense_date,
   'amount',v_row.amount,'details',v_row.details,'review_status','pending_review');
end $$;
revoke all on function public.av2_save_expense(date,numeric,text,uuid) from public,anon;
grant execute on function public.av2_save_expense(date,numeric,text,uuid) to authenticated;

create or replace function public.av2_list_expenses(p_from date,p_to date,p_emp_ids bigint[] default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_role text;v_emp bigint;v_name text;v_json jsonb;
begin
 select lower(coalesce(u.role,'')),u.emp_id::bigint,
   coalesce(nullif(trim(u.full_name),''),nullif(trim(u.name),''),nullif(trim(u.username),''),'')
   into v_role,v_emp,v_name from public.users u
   where u.auth_user_id=auth.uid() and u.is_active=true limit 1;
 if v_role is null then raise exception 'expense_access_denied' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to>p_from+interval '93 days'
 then raise exception 'expense_date_range_invalid' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',e.id,'emp_id',e.emp_id,'expense_date',e.expense_date,
   'amount',e.amount,'details',e.details,
   'review_status',e.review_status,'approved_amount',e.approved_amount,
   'attachments',coalesce((select jsonb_agg(jsonb_build_object(
     'id',att.id,'file_name',att.file_name,'storage_path',att.storage_path,
     'file_type',att.file_type,'file_size',att.file_size)
     order by att.file_name) from public.attendance_expense_attachments att
     where att.expense_id=e.id),'[]'::jsonb))
   order by e.expense_date desc,e.created_at desc),'[]'::jsonb)
 into v_json from public.attendance_expense_reports e
 left join public.contacts_instructors ci on ci.emp_id=e.emp_id
 where e.expense_date between p_from and p_to
   and (p_emp_ids is null or e.emp_id=any(p_emp_ids))
   and ( (v_role='instructor' and e.emp_id=v_emp)
    or v_role in ('admin','operation_manager','finance')
    or (v_role in ('manager','instructor_manager','activities_manager')
      and lower(trim(coalesce(ci.direct_manager,'')))=lower(trim(v_name))) );
 return v_json;
end $$;
revoke all on function public.av2_list_expenses(date,date,bigint[]) from public,anon;
grant execute on function public.av2_list_expenses(date,date,bigint[]) to authenticated;

create or replace function public.av2_expense_attachment_add(
 p_expense_id uuid,p_storage_path text,p_file_name text,
 p_file_type text default null,p_file_size bigint default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_emp bigint;v_row public.attendance_expense_reports%rowtype;v_att uuid;
begin
 v_emp:=public.av2_expense_instructor_id();
 select * into v_row from public.attendance_expense_reports
 where id=p_expense_id and emp_id=v_emp;
 if not found or v_row.review_status not in ('pending_review','rejected')
    or not public.av2_can_write_month(v_row.expense_date) then
    raise exception 'expense_attachment_not_editable' using errcode='42501';end if;
 if p_storage_path is null or p_storage_path not like v_emp::text||'/'||p_expense_id::text||'/%'
   or length(p_storage_path)>400 or btrim(coalesce(p_file_name,''))=''
   or p_file_size<0 or p_file_size>10485760 then
    raise exception 'expense_attachment_invalid' using errcode='22023';end if;
 insert into public.attendance_expense_attachments(
  expense_id,emp_id,storage_path,file_name,file_type,file_size)
 values(p_expense_id,v_emp,p_storage_path,btrim(p_file_name),p_file_type,p_file_size)
 returning id into v_att;
 return jsonb_build_object('id',v_att,'expense_id',p_expense_id);
end $$;
revoke all on function public.av2_expense_attachment_add(uuid,text,text,text,bigint) from public,anon;
grant execute on function public.av2_expense_attachment_add(uuid,text,text,text,bigint) to authenticated;

create or replace function public.av2_review_expense(
 p_expense_id uuid,p_decision text,p_amount numeric default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role text;v_name text;v_manager text;v_row public.attendance_expense_reports%rowtype;
begin
 select lower(coalesce(role,'')),coalesce(nullif(trim(full_name),''),nullif(trim(name),''),nullif(trim(username),''),'')
 into v_role,v_name from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
 if v_role not in ('admin','operation_manager','finance','manager','instructor_manager','activities_manager')
 then raise exception 'expense_review_denied' using errcode='42501';end if;
 if p_decision not in ('approve','reject','correct')
   or (p_decision='correct' and (p_amount is null or p_amount<0 or p_amount>100000)) then
   raise exception 'expense_review_invalid' using errcode='22023';end if;
 select * into v_row from public.attendance_expense_reports
 where id=p_expense_id for update;
 if not found or v_row.review_status<>'pending_review' then
   raise exception 'expense_not_pending' using errcode='42501';end if;
 if v_role in ('manager','instructor_manager','activities_manager') then
   select direct_manager into v_manager from public.contacts_instructors where emp_id=v_row.emp_id limit 1;
   if lower(trim(coalesce(v_manager,'')))<>lower(trim(v_name)) then
     raise exception 'expense_review_denied' using errcode='42501';end if;
 end if;
 update public.attendance_expense_reports set
   review_status=case when p_decision='reject' then 'rejected' else 'approved' end,
   approved_amount=case p_decision when 'approve' then amount when 'correct' then p_amount else null end,
   reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
 where id=p_expense_id returning * into v_row;
 return jsonb_build_object('id',v_row.id,'review_status',v_row.review_status,
   'approved_amount',v_row.approved_amount);
end $$;
revoke all on function public.av2_review_expense(uuid,text,numeric) from public,anon;
grant execute on function public.av2_review_expense(uuid,text,numeric) to authenticated;
