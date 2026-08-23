create table if not exists public.gefen_start_reminder_acknowledgements (
  activity_id bigint not null references public.activities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);

comment on table public.gefen_start_reminder_acknowledgements is
  'Per-user acknowledgement of the 2027 Gefen-only activity start reminder.';

alter table public.gefen_start_reminder_acknowledgements enable row level security;

revoke all on table public.gefen_start_reminder_acknowledgements from anon;
revoke all on table public.gefen_start_reminder_acknowledgements from authenticated;
grant select, insert on table public.gefen_start_reminder_acknowledgements to authenticated;

create index if not exists gefen_start_reminder_ack_user_activity_idx
  on public.gefen_start_reminder_acknowledgements (user_id, activity_id);

drop policy if exists "read own gefen reminder acknowledgements" on public.gefen_start_reminder_acknowledgements;
create policy "read own gefen reminder acknowledgements"
  on public.gefen_start_reminder_acknowledgements
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "ack own gefen reminder" on public.gefen_start_reminder_acknowledgements;
create policy "ack own gefen reminder"
  on public.gefen_start_reminder_acknowledgements
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
