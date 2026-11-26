-- Audit log for entry-code resets (self-recovery and admin). Never stores codes.
create table if not exists public.entry_code_reset_audit (
  id uuid primary key default gen_random_uuid(),
  target_user_id text not null,
  actor_user_id text null,
  channel text not null,
  outcome text not null,
  error_code text null,
  created_at timestamptz not null default now(),
  constraint entry_code_reset_audit_channel_check
    check (channel in ('self_recovery', 'admin_reset')),
  constraint entry_code_reset_audit_outcome_check
    check (outcome in ('success', 'failure'))
);

create index if not exists idx_entry_code_reset_audit_target_created
  on public.entry_code_reset_audit (target_user_id, created_at desc);

create index if not exists idx_entry_code_reset_audit_actor_created
  on public.entry_code_reset_audit (actor_user_id, created_at desc)
  where actor_user_id is not null;

alter table public.entry_code_reset_audit enable row level security;
revoke all on table public.entry_code_reset_audit from public, anon, authenticated;
grant all on table public.entry_code_reset_audit to service_role;

comment on table public.entry_code_reset_audit is
  'Server-only audit of entry-code resets. Codes are never stored. No anon/authenticated policies.';
