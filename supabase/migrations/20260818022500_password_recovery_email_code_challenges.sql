create table if not exists public.password_recovery_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  auth_user_id uuid not null,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint password_recovery_challenges_attempts_check check (attempts between 0 and 10)
);

create index if not exists idx_password_recovery_challenges_email_created_at
  on public.password_recovery_challenges (lower(email), created_at desc);

create index if not exists idx_password_recovery_challenges_expiry
  on public.password_recovery_challenges (expires_at);

alter table public.password_recovery_challenges enable row level security;
revoke all on table public.password_recovery_challenges from anon, authenticated;
grant all on table public.password_recovery_challenges to service_role;

comment on table public.password_recovery_challenges is
  'Server-only short-lived email-code challenges for dashboard password recovery. No anon/authenticated policies.';
