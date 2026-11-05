create or replace function public.can_manage_instructor_observations()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $function$
 select exists(
  select 1 from public.users u
  where u.auth_user_id=auth.uid() and u.is_active=true
  and (
   (u.role in ('admin','activities_manager','operation_manager')
    and (u.role='admin' or public.app_has_permission('view_instructors')))
   or (
    public.app_has_permission('view_manager_board')
    and public.app_has_permission('view_manager_tracking')
    and public.app_has_permission('manage_instructor_observations')
   )
  )
 );
$function$;

insert into public.permission_matrix_audit(migration,user_id,permissions_before)
select 'israa-instructor-observations-20261105-v1',user_id,permissions from public.users
where email='esraas@think.org.il' and role='business_development_manager' and is_active=true
and not exists(select 1 from public.permission_matrix_audit a
 where a.migration='israa-instructor-observations-20261105-v1' and a.user_id=users.user_id);

update public.users set
 permissions=coalesce(permissions,'{}'::jsonb)||'{"manage_instructor_observations":"yes"}'::jsonb,
 updated_at=now()
where email='esraas@think.org.il' and role='business_development_manager' and is_active=true;
