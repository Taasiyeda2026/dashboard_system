-- Stabilize Supabase Auth login reads for Preview and production branches.
-- Idempotent: safe to run on branches that already have partial schema.

alter table public.users add column if not exists username text;
alter table public.users add column if not exists display_role text;
alter table public.users add column if not exists auth_user_id uuid;

create unique index if not exists users_auth_user_id_idx on public.users(auth_user_id);

-- Login maps username input (e.g. idann) to public.users.username.
update public.users
set username = lower(
  coalesce(
    nullif(trim(username), ''),
    nullif(trim(user_id), ''),
    nullif(split_part(lower(trim(coalesce(email, ''))), '@', 1), '')
  )
)
where coalesce(trim(username), '') = '';

-- Keep browser reads explicit. entry_code stays excluded from column grants.
do $$
declare
  users_select_columns text;
begin
  if to_regclass('public.users') is null then
    raise notice 'Table public.users does not exist — skipped login column grants';
  else
    revoke all on public.users from anon, authenticated;

    select string_agg(quote_ident(column_name), ', ' order by array_position(
      array[
        'user_id', 'username', 'email', 'name', 'role', 'display_role',
        'emp_id', 'is_active', 'permissions', 'auth_user_id', 'created_at', 'updated_at'
      ],
      column_name
    ))
    into users_select_columns
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = any (
        array[
          'user_id', 'username', 'email', 'name', 'role', 'display_role',
          'emp_id', 'is_active', 'permissions', 'auth_user_id', 'created_at', 'updated_at'
        ]
      );

    if users_select_columns is null then
      raise notice 'No compatible public.users columns found — skipped login column grants';
    else
      execute format('grant select (%s) on public.users to anon, authenticated', users_select_columns);
      raise notice 'Granted SELECT on public.users columns: %', users_select_columns;
    end if;
  end if;
end $$;
