-- PREPARED ONLY — do not run against production without explicit approval.
-- Production data restoration is required when migration 20260530151253 was already
-- applied as a no-op. Repo migration repair alone will not re-run an already-applied migration.
--
-- Source: stable commit 2c772f835cc19da52fd76528c0b19f667f23de79
--   - supabase/migrations/20260530151253_exact_proposal_templates_multiline.sql
--   - supabase/migrations/20260614_fix_edit_requests_request_only_rls.sql (groups/aliases section)
--
-- Read-only checks before running:
--   select count(*) as count from public.proposal_template_sections;
--   select template_key, count(*) as count from public.proposal_template_sections group by template_key order by template_key;
--   select count(*) as count from public.proposal_activity_groups;
--   select count(*) as count from public.proposal_group_aliases;
--   select count(*) as count from public.proposal_pricing_options;
--   select count(*) as count from public.proposal_agreement_items;

-- Step 1: run the full contents of:
--   supabase/migrations/20260530151253_exact_proposal_templates_multiline.sql

-- Step 2: restore proposal activity groups + aliases if missing
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
