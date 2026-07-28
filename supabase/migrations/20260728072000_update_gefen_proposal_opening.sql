-- Update the active GEFEN proposal opening and program-selection heading.

update public.proposal_template_sections
set section_body = E'תעשיידע היא עמותה חינוכית-טכנולוגית מיסודה של התאחדות התעשיינים בישראל, הפועלת לקידום החינוך המדעי והטכנולוגי (STEM) ולחיבור בין מערכת החינוך לעולמות התעשייה.\n\n למידה התנסותית\n למידת חקר\n פתרון בעיות\n חשיבה יזמית\n חשיבה יצירתית\n עבודת צוות\n אוריינות דיגיטלית\n חינוך פיננסי\n חיבור לתעשייה',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'intro';

update public.proposal_template_sections
set section_title = 'בחירת התוכנית',
    section_body = 'הצעה זו נועדה לבחירת תוכנית ולפתיחת הזמנה במערכת גפ״ן בלבד. ההתקשרות תיכנס לתוקף לאחר אישור הזמנת העבודה הדיגיטלית והשלמת האישורים הנדרשים ואינה מהווה חוזה או הזמנת שירותים עצמאית.',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'activity_intro';
