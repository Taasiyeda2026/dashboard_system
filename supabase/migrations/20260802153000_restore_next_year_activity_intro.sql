update public.proposal_template_sections
set section_body = 'להלן הפעילויות המוצעות לשנת הלימודים תשפ״ז.',
    updated_at = now()
where template_key = 'next_year'
  and section_key = 'activity_intro'
  and is_active = true;
