-- Update GEFEN proposal wording only.
-- Preserve section order, the 12 intro skill items, and the existing document layout.

update public.proposal_template_sections
set section_body = E'תעשיידע היא עמותה חינוכית-טכנולוגית מיסודה של התאחדות התעשיינים בישראל, הפועלת לקידום החינוך המדעי והטכנולוגי (STEM) ולחיבור בין מערכת החינוך לעולמות התעשייה. במסגרת התוכניות התלמידים מפתחים מיומנויות וכלים מעשיים לעולם המשתנה:\n\n אוריינות דיגיטלית\n חינוך פיננסי\n חיבור לתעשייה\n חוסן אישי\n תחושת מסוגלות\n עבודת צוות\n חשיבה ביקורתית\n חשיבה יזמית\n חשיבה יצירתית\n למידה התנסותית\n למידת חקר\n פתרון בעיות',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'intro';

update public.proposal_template_sections
set section_body = 'הצעה זו נועדה לבחירת תוכנית ולפתיחת הזמנה במערכת גפ״ן. ההתקשרות תיכנס לתוקף עם אישור הזמנת העבודה והשלמת האישורים הנדרשים. במקרה של סתירה, יגברו הוראות גפ״ן והזמנת העבודה המאושרת.',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'activity_intro';

update public.proposal_template_sections
set section_body = 'ההצעה בתוקף עד {{valid_until}}. שריון צוותי ההדרכה, המועדים והיקף הפעילות יבוצע בהתאם לזמינות ולסדר אישור ההזמנות במערכת גפ״ן ואינו מובטח עד לאישור ההזמנה.',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'validity';

update public.proposal_template_sections
set section_body = E' מינוי איש קשר לתיאום שוטף מול תעשיידע.\n נוכחות איש צוות חינוכי בכל מפגשי התוכנית.\n העמדת כיתה מתאימה והציוד הנדרש לפעילות.\n עדכון מראש על שינוי במועדי הפעילות או בשעותיה.',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'school_responsibility';

update public.proposal_template_sections
set section_body = E' הפעלת התוכנית בהתאם לסילבוס ולהזמנה המאושרת.\n צוותי הדרכה מקצועיים, חומרי פעילות וליווי מקצועי.\n תיאום ודיווח על המפגשים במערכת גפ״ן.',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'taasiyeda_responsibility';

update public.proposal_template_sections
set section_body = 'תעשיידע היא מלכ״ר הפטור ממע״מ והמחירים בהצעה סופיים. חשבונית תונפק עבור מפגשים שבוצעו בפועל ודווחו במערכת גפ״ן. התשלום יבוצע בהתאם לכללים החלים על הבעלות או הרשות ולהוראות חוק מוסר תשלומים לספקים.',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'payment_terms';

update public.proposal_template_sections
set section_body = E' שינוי או דחייה - יש לעדכן מוקדם ככל האפשר, ורצוי לפחות 3 ימי עבודה מראש.\n שינוי או ביטול בפחות מ-48 שעות - יחייבו אישור בכתב של מנהל/ת בית הספר ותיאום בין הצדדים.\n הפסקת תוכנית - תיעשה בהודעה בכתב לפחות 30 יום מראש. בתקופה זו ישולם עבור פעילויות שבוצעו או תוכננו, בהתאם להזמנה ולהוראות גפ״ן.\n מצב חירום - יתואם מתווה חלופי בהתאם להוראות גפ״ן, לרבות מעבר לפעילות מקוונת בהפחתה של 10% ככל שנדרש.',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'cancellation_terms';
