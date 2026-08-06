-- Keep the two internal תשפ״ז sections distinguishable in the editor and preview.
update public.proposal_activity_groups
set display_name = case group_key
      when 'next_year_courses' then 'תשפ״ז (קורסים)'
      when 'next_year_workshops' then 'תשפ״ז (סדנאות)'
      else display_name
    end,
    updated_at = now()
where group_key in ('next_year_courses', 'next_year_workshops');
