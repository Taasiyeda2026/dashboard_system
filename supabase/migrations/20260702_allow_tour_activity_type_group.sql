ALTER TABLE public.proposals_agreements
  DROP CONSTRAINT IF EXISTS proposals_agreements_activity_type_group_check;

ALTER TABLE public.proposals_agreements
  ADD CONSTRAINT proposals_agreements_activity_type_group_check
  CHECK (
    activity_type_group IS NULL
    OR btrim(activity_type_group) = ''
    OR activity_type_group = ANY (ARRAY[
      'summer',
      'next_year',
      'combined',
      'tour',
      'פעילויות קיץ',
      'קיץ תשפ״ו',
      'שנה הבאה',
      'שנת הלימודים תשפ״ז',
      'תוכניות תשפ״ז',
      'הצעה משולבת',
      'קיץ תשפ״ו + תשפ״ז',
      'קיץ תשפ״ו ושנת הלימודים תשפ״ז',
      'קורסים',
      'סדנאות',
      'סיור',
      'סיורים',
      'סיור בתעשייה',
      'תוכניות חינוכיות',
      'STEM ומייקרים',
      'התנסות בתעשייה',
      'התנסות בתעשייה – סיור לימודי חווייתי'
    ])
  ) NOT VALID;

INSERT INTO public.proposal_activity_groups
  (group_key, display_name, template_key, included_group_keys, sort_order, is_active)
VALUES
  ('tour', 'סיור', 'tour', '{}', 4, true)
ON CONFLICT (group_key) DO UPDATE SET
  display_name = excluded.display_name,
  template_key = excluded.template_key,
  included_group_keys = excluded.included_group_keys,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

INSERT INTO public.proposal_group_aliases
  (alias_name, group_key, is_active)
VALUES
  ('סיור', 'tour', true),
  ('סיורים', 'tour', true),
  ('סיור בתעשייה', 'tour', true),
  ('התנסות בתעשייה', 'tour', true),
  ('התנסות בתעשייה – סיור לימודי חווייתי', 'tour', true)
ON CONFLICT (alias_name) DO UPDATE SET
  group_key = excluded.group_key,
  is_active = excluded.is_active;
