-- Expand the active GEFEN proposal opening to a fixed 4x3 skills grid.
-- The item order is column-first from right to left and must remain unchanged.

update public.proposal_template_sections
set section_body = E'תעשיידע היא עמותה חינוכית-טכנולוגית מיסודה של התאחדות התעשיינים בישראל, הפועלת לקידום החינוך המדעי והטכנולוגי (STEM) ולחיבור בין מערכת החינוך לעולמות התעשייה.\n\n אוריינות דיגיטלית\n חינוך פיננסי\n חיבור לתעשייה\n חוסן אישי\n תחושת מסוגלות\n עבודת צוות\n חשיבה ביקורתית\n חשיבה יזמית\n חשיבה יצירתית\n למידה התנסותית\n למידת חקר\n פתרון בעיות',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'intro';
