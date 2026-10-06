-- Allow a narrowly-scoped per-user activity deletion permission in addition
-- to the existing admin/operation_manager role gate.
create or replace function public.app_can_delete_activity()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(
    public.app_current_role() in ('admin', 'operation_manager')
    or public.app_has_permission('can_delete_activity'),
    false
  )
$function$;

-- Grant only Israa the explicit delete permission. Keep all of her other
-- dashboard permissions and role unchanged.
do $block$
declare
  v_target_count integer;
begin
  select count(*)
    into v_target_count
  from public.users
  where emp_id = '3030'
    and username = 'esraaa'
    and is_active = true;

  if v_target_count <> 1 then
    raise exception 'Expected exactly one active Israa user (emp_id 3030, username esraaa), found %', v_target_count;
  end if;

  update public.users
  set permissions = jsonb_set(
        coalesce(permissions, '{}'::jsonb),
        '{can_delete_activity}',
        '"yes"'::jsonb,
        true
      ),
      updated_at = now()
  where emp_id = '3030'
    and username = 'esraaa'
    and is_active = true;
end
$block$;
