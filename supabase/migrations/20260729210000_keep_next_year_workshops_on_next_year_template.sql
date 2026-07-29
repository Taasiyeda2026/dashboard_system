-- The workshop subgroup reuses active summer pricing rows, but its document
-- content must always come from the תשפ״ז template.
update public.proposal_activity_groups
set template_key = 'next_year',
    updated_at = now()
where group_key = 'next_year_workshops'
  and template_key is distinct from 'next_year';
