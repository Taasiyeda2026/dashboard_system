create table if not exists public.staff_messages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  schedule_type text not null default 'once',
  scheduled_date date,
  monthly_day smallint,
  scheduled_time time without time zone not null default '09:00',
  importance text not null default 'normal',
  audience text not null default 'all_non_instructors',
  active_from date not null default current_date,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_messages_title_length check (char_length(btrim(title)) between 1 and 120),
  constraint staff_messages_body_length check (char_length(btrim(body)) between 1 and 3000),
  constraint staff_messages_schedule_type check (schedule_type in ('once', 'monthly')),
  constraint staff_messages_importance check (importance in ('normal', 'important', 'critical')),
  constraint staff_messages_audience check (audience = 'all_non_instructors'),
  constraint staff_messages_monthly_day check (monthly_day is null or monthly_day between 1 and 31),
  constraint staff_messages_schedule_fields check (
    (schedule_type = 'once' and scheduled_date is not null and monthly_day is null)
    or
    (schedule_type = 'monthly' and scheduled_date is null and monthly_day is not null)
  )
);

create table if not exists public.staff_message_acknowledgements (
  message_id uuid not null references public.staff_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_date date not null,
  acknowledged_at timestamptz not null default now(),
  primary key (message_id, user_id, occurrence_date)
);

create index if not exists staff_messages_active_schedule_idx
  on public.staff_messages (is_active, schedule_type, scheduled_date, monthly_day);

create index if not exists staff_message_ack_user_idx
  on public.staff_message_acknowledgements (user_id, occurrence_date, message_id);

alter table public.staff_messages enable row level security;
alter table public.staff_message_acknowledgements enable row level security;

revoke all on table public.staff_messages from anon;
revoke all on table public.staff_messages from authenticated;
grant select, insert, update, delete on table public.staff_messages to authenticated;

revoke all on table public.staff_message_acknowledgements from anon;
revoke all on table public.staff_message_acknowledgements from authenticated;
grant select, insert on table public.staff_message_acknowledgements to authenticated;

drop policy if exists "staff messages read" on public.staff_messages;
create policy "staff messages read"
  on public.staff_messages
  for select
  to authenticated
  using (
    (select public.app_current_role()) = 'admin'
    or (
      is_active = true
      and audience = 'all_non_instructors'
      and coalesce((select public.app_current_role()), '') not in ('', 'instructor')
    )
  );

drop policy if exists "staff messages admin insert" on public.staff_messages;
create policy "staff messages admin insert"
  on public.staff_messages
  for insert
  to authenticated
  with check ((select public.app_current_role()) = 'admin');

drop policy if exists "staff messages admin update" on public.staff_messages;
create policy "staff messages admin update"
  on public.staff_messages
  for update
  to authenticated
  using ((select public.app_current_role()) = 'admin')
  with check ((select public.app_current_role()) = 'admin');

drop policy if exists "staff messages admin delete" on public.staff_messages;
create policy "staff messages admin delete"
  on public.staff_messages
  for delete
  to authenticated
  using ((select public.app_current_role()) = 'admin');

drop policy if exists "staff message acknowledgements read own or admin" on public.staff_message_acknowledgements;
create policy "staff message acknowledgements read own or admin"
  on public.staff_message_acknowledgements
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.app_current_role()) = 'admin'
  );

drop policy if exists "staff message acknowledgements insert own" on public.staff_message_acknowledgements;
create policy "staff message acknowledgements insert own"
  on public.staff_message_acknowledgements
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce((select public.app_current_role()), '') not in ('', 'instructor')
  );

comment on table public.staff_messages is
  'Admin-managed dashboard messages for non-instructor staff.';

comment on table public.staff_message_acknowledgements is
  'Per-user acknowledgement for each one-time or monthly staff message occurrence.';
