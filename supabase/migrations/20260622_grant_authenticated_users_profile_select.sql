-- Restore authenticated profile lookup after Supabase Auth login.
-- RLS policies are not enough without table/column SELECT privileges.
-- This migration grants SELECT only on the existing safe profile columns used by the app.

grant usage on schema public to authenticated;

do $$
declare
  allowed_columns text[] := array[
    'user_id',
    'entry_code',
    'name',
    'full_name',
    'role',
    'email',
    'display_role',
    'default_view',
    'is_active',
    'permissions',
    'auth_user_id',
    'auth_email',
    'migrated_to_auth',
    'can_review_requests',
    'username',
    'view_certificates',
    'view_proposals_agreements',
    'manage_proposals_agreements',
    'approve_proposals_agreements',
    'emp_id'
  ];
  existing_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by array_position(allowed_columns, column_name))
    into existing_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'users'
    and column_name = any(allowed_columns);

  if existing_columns is null then
    raise exception 'No allowed public.users columns found for authenticated SELECT grant';
  end if;

  execute format(
    'grant select (%s) on table public.users to authenticated',
    existing_columns
  );
end $$;
