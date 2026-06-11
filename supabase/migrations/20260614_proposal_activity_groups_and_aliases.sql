-- Proposal activity groups + aliases: move proposal-type business data from the frontend into Supabase.
-- The proposals-agreements loader reads these tables and the UI derives proposal types,
-- display names, template keys and legacy-name normalization from them.

create extension if not exists pgcrypto;

-- ─── proposal_activity_groups ────────────────────────────────────────────────
create table if not exists public.proposal_activity_groups (
  id uuid primary key default gen_random_uuid(),
  group_key text not null unique,
  display_name text not null,
  template_key text not null,
  included_group_keys text[] not null default '{}',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposal_activity_groups_group_key_not_blank check (btrim(group_key) <> ''),
  constraint proposal_activity_groups_display_name_not_blank check (btrim(display_name) <> ''),
  constraint proposal_activity_groups_template_key_not_blank check (btrim(template_key) <> '')
);

create index if not exists proposal_activity_groups_sort_idx
  on public.proposal_activity_groups (is_active, sort_order);

create or replace function public.touch_proposal_activity_groups_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_proposal_activity_groups_updated_at on public.proposal_activity_groups;
create trigger trg_touch_proposal_activity_groups_updated_at
before update on public.proposal_activity_groups
for each row
execute function public.touch_proposal_activity_groups_updated_at();

-- ─── proposal_group_aliases ──────────────────────────────────────────────────
create table if not exists public.proposal_group_aliases (
  id uuid primary key default gen_random_uuid(),
  alias_name text not null unique,
  group_key text not null references public.proposal_activity_groups(group_key) on update cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint proposal_group_aliases_alias_name_not_blank check (btrim(alias_name) <> '')
);

create index if not exists proposal_group_aliases_group_key_idx
  on public.proposal_group_aliases (group_key);

-- ─── RLS: readable by proposals-agreements users only ────────────────────────
alter table public.proposal_activity_groups enable row level security;
alter table public.proposal_group_aliases enable row level security;

drop policy if exists proposal_activity_groups_select_allowed_roles on public.proposal_activity_groups;
create policy proposal_activity_groups_select_allowed_roles
on public.proposal_activity_groups
for select
to authenticated
using (public.app_can_use_proposals_agreements());

drop policy if exists proposal_group_aliases_select_allowed_roles on public.proposal_group_aliases;
create policy proposal_group_aliases_select_allowed_roles
on public.proposal_group_aliases
for select
to authenticated
using (public.app_can_use_proposals_agreements());

revoke all on public.proposal_activity_groups from anon;
revoke all on public.proposal_group_aliases from anon;
grant select on public.proposal_activity_groups to authenticated;
grant select on public.proposal_group_aliases to authenticated;

-- ─── Seed: proposal types (logical key, Hebrew display name, template key) ───
insert into public.proposal_activity_groups
  (group_key, display_name, template_key, included_group_keys, sort_order, is_active)
values
  ('summer',    'פעילויות קיץ', 'summer',    '{}',                   1, true),
  ('next_year', 'שנה הבאה',     'next_year', '{}',                   2, true),
  ('combined',  'הצעה משולבת',  'combined',  '{summer,next_year}',   3, true)
on conflict (group_key) do update set
  display_name = excluded.display_name,
  template_key = excluded.template_key,
  included_group_keys = excluded.included_group_keys,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

-- ─── Seed: legacy / alternative names that normalize to a logical group ──────
insert into public.proposal_group_aliases
  (alias_name, group_key, is_active)
values
  ('קיץ תשפ״ו',                       'summer',    true),
  ('שנת הלימודים תשפ״ז',              'next_year', true),
  ('תוכניות תשפ״ז',                   'next_year', true),
  ('קיץ תשפ״ו ושנת הלימודים תשפ״ז',  'combined',  true),
  ('קיץ תשפ״ו + תשפ״ז',               'combined',  true),
  ('קורסים',                          'combined',  true),
  ('סדנאות',                          'combined',  true),
  ('סיור',                            'combined',  true),
  ('תוכניות חינוכיות',                'combined',  true),
  ('STEM ומייקרים',                   'combined',  true),
  ('התנסות בתעשייה',                  'combined',  true)
on conflict (alias_name) do update set
  group_key = excluded.group_key,
  is_active = excluded.is_active;
