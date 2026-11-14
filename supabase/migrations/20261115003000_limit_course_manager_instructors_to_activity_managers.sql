-- Narrow the manager-as-course-instructor exception to the two approved
-- activities managers: Hila Rosen (1500) and Gil Naaman (5000).
-- Do not change ordinary instructors, staff roles, or existing assignments.
-- Other management roles are not eligible through this special exception.

create or replace function scheduling_manual_private.is_management_employee(p_emp_id bigint)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.users u where u.emp_id=p_emp_id::text and
 u.role = 'activities_manager' and u.emp_id in ('1500','5000'))
$$;


create or replace function public.scheduling_management_employee_directory()
returns table(emp_id bigint,full_name text,is_active boolean,role text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not exists(select 1 from public.users actor
     where actor.auth_user_id=auth.uid() and actor.is_active)
 then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
 return query select u.emp_id::bigint,coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.name),'')),u.is_active,u.role
 from public.users u where u.emp_id ~ '^[0-9]+$'
   and coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.name),'')) is not null
   and u.role = 'activities_manager' and u.emp_id in ('1500','5000')
 order by u.full_name,u.emp_id;
end $$;

-- Existing access grants and central approval trigger are preserved.
revoke all on function scheduling_manual_private.is_management_employee(bigint) from public,anon,authenticated;
revoke all on function public.scheduling_management_employee_directory() from public,anon;
grant execute on function public.scheduling_management_employee_directory() to authenticated;
