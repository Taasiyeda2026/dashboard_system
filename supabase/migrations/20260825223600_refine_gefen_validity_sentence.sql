-- Refine GEFEN proposal validity wording while preserving the dynamic validity date.

update public.proposal_template_sections
set
  section_body = 'הצעה זו בתוקף עד ליום {{valid_until}}. שריון צוותי ההדרכה למועדי הפעילות יבוצע על פי סדר השלמת ההזמנות במערכת גפ״ן.',
  updated_at = now()
where template_key = 'gefen'
  and section_key = 'validity';
