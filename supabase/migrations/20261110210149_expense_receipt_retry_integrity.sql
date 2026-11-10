-- Preserve the existing signature and access checks. A receipt retry must not
-- create another row or force the client to delete an already committed file.
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
 on conflict(storage_path) do nothing returning id into v_att;
 if v_att is null then
   select id into v_att from public.attendance_expense_attachments
   where expense_id=p_expense_id and emp_id=v_emp and storage_path=p_storage_path
     and file_name=btrim(p_file_name) and file_type is not distinct from p_file_type
     and file_size is not distinct from p_file_size;
   if v_att is null then raise exception 'expense_attachment_conflict' using errcode='42501';end if;
 end if;
 return jsonb_build_object('id',v_att,'expense_id',p_expense_id);
end $$;
revoke all on function public.av2_expense_attachment_add(uuid,text,text,text,bigint) from public,anon;
grant execute on function public.av2_expense_attachment_add(uuid,text,text,text,bigint) to authenticated;
